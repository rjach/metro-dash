import { describe, expect, it } from "vitest";
import { extractFeatures, LANDMARK, type Landmark } from "../src/input/camera/BodyFeatures";
import { Calibrator } from "../src/input/camera/Calibrator";
import { GestureRecognizer } from "../src/input/camera/GestureRecognizer";
import type { GameAction } from "../src/game/actions";

interface BodyPose {
  /** Player's own horizontal position (0..1, player perspective). */
  x: number;
  shoulderY: number;
  lean?: number;
  handsUp?: boolean;
  /** Person's own left/right hand lifted to chest height. */
  leftRaise?: boolean;
  rightRaise?: boolean;
  visibility?: number;
}

const SHOULDER_WIDTH = 0.2;
const TORSO = 0.28;

/** Builds a synthetic MediaPipe landmark array for a stylised standing body. */
const landmarksFor = (pose: BodyPose): Landmark[] => {
  const v = pose.visibility ?? 0.95;
  const points: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, z: 0, visibility: 0.2 }));
  // Raw camera space is mirrored relative to the player's view.
  const rawX = 1 - pose.x;
  const lean = pose.lean ?? 0;
  const shoulderRawX = rawX - Math.sin(lean) * TORSO;
  points[LANDMARK.leftShoulder] = { x: shoulderRawX + SHOULDER_WIDTH / 2, y: pose.shoulderY, z: 0, visibility: v };
  points[LANDMARK.rightShoulder] = { x: shoulderRawX - SHOULDER_WIDTH / 2, y: pose.shoulderY, z: 0, visibility: v };
  points[LANDMARK.leftHip] = { x: rawX + 0.08, y: pose.shoulderY + TORSO, z: 0, visibility: v };
  points[LANDMARK.rightHip] = { x: rawX - 0.08, y: pose.shoulderY + TORSO, z: 0, visibility: v };
  points[LANDMARK.nose] = { x: shoulderRawX, y: pose.shoulderY - 0.12, z: 0, visibility: v };
  const wristY = (raised?: boolean) => (pose.handsUp ? pose.shoulderY - 0.25 : raised ? pose.shoulderY + 0.05 : pose.shoulderY + 0.25);
  points[LANDMARK.leftWrist] = { x: shoulderRawX + 0.15, y: wristY(pose.leftRaise), z: 0, visibility: v };
  points[LANDMARK.rightWrist] = { x: shoulderRawX - 0.15, y: wristY(pose.rightRaise), z: 0, visibility: v };
  return points;
};

const NEUTRAL: BodyPose = { x: 0.5, shoulderY: 0.35 };
const FRAME_MS = 33;

const calibrate = (laneMode: "hands" | "lean" = "lean"): GestureRecognizer => {
  const calibrator = new Calibrator();
  let t = 0;
  for (let i = 0; i < 90; i++) {
    const progress = calibrator.update(extractFeatures(landmarksFor(NEUTRAL)), (t += FRAME_MS));
    if (progress.profile) {
      const recognizer = new GestureRecognizer(progress.profile);
      recognizer.setLaneMode(laneMode);
      return recognizer;
    }
  }
  throw new Error("calibration did not complete in 3 s");
};

/** Plays a sequence of poses (each held for `frames`) and collects fired actions. */
const play = (recognizer: GestureRecognizer, script: { pose: BodyPose; frames: number }[], startMs = 10_000): GameAction[] => {
  const actions: GameAction[] = [];
  let t = startMs;
  for (const step of script) {
    for (let i = 0; i < step.frames; i++) {
      t += FRAME_MS;
      actions.push(...recognizer.update(extractFeatures(landmarksFor(step.pose)), t).actions);
    }
  }
  return actions;
};

const warmup = { pose: NEUTRAL, frames: 10 };

describe("feature extraction", () => {
  it("mirrors x so the player's right is positive", () => {
    const features = extractFeatures(landmarksFor({ x: 0.7, shoulderY: 0.35 }))!;
    expect(features.centerX).toBeCloseTo(0.7, 2);
    expect(features.torsoLength).toBeCloseTo(TORSO, 2);
  });

  it("rejects poses with low shoulder visibility", () => {
    expect(extractFeatures(landmarksFor({ ...NEUTRAL, visibility: 0.2 }))).toBeNull();
  });

  it("reports positive tilt when leaning right", () => {
    const features = extractFeatures(landmarksFor({ ...NEUTRAL, lean: 0.35 }))!;
    expect(features.tilt!).toBeGreaterThan(0.25);
  });
});

describe("calibration", () => {
  it("guides framing before capturing", () => {
    const calibrator = new Calibrator();
    expect(calibrator.update(null, 0).status).toBe("no-person");
    expect(calibrator.update(extractFeatures(landmarksFor({ x: 0.15, shoulderY: 0.35 })), 30).status).toBe("off-center-left");
    const progress = calibrator.update(extractFeatures(landmarksFor(NEUTRAL)), 60);
    expect(progress.status).toBe("calibrating");
  });

  it("produces a profile after holding still", () => {
    const recognizer = calibrate();
    expect(recognizer.profile.centerX).toBeCloseTo(0.5, 2);
    expect(recognizer.profile.torsoLength).toBeCloseTo(TORSO, 2);
  });
});

describe("hand-raise lanes (default camera control)", () => {
  const raiseRight = { pose: { ...NEUTRAL, rightRaise: true }, frames: 15 };
  const raiseLeft = { pose: { ...NEUTRAL, leftRaise: true }, frames: 15 };
  const down = { pose: NEUTRAL, frames: 10 };

  it("records relaxed hand heights during calibration", () => {
    const profile = calibrate("hands").profile;
    expect(profile.leftHandRest).toBeCloseTo(0.107, 1);
    expect(profile.rightHandRest).toBeCloseTo(0.107, 1);
  });

  it("raising the right hand to chest moves right exactly once, even if held", () => {
    expect(play(calibrate("hands"), [warmup, { pose: { ...NEUTRAL, rightRaise: true }, frames: 60 }])).toEqual(["right"]);
  });

  it("each raise-and-lower is one lane; left hand moves left", () => {
    expect(play(calibrate("hands"), [warmup, raiseLeft, down, raiseLeft, down, raiseRight, down])).toEqual(["left", "left", "right"]);
  });

  it("ignores body leans and steps in hand mode", () => {
    expect(play(calibrate("hands"), [warmup, { pose: { x: 0.3, shoulderY: 0.35, lean: 0.4 }, frames: 30 }])).toEqual([]);
  });

  it("both hands up is the hoverboard, never a lane change", () => {
    const actions = play(calibrate("hands"), [
      warmup,
      { pose: { ...NEUTRAL, leftRaise: true, rightRaise: true }, frames: 4 },
      { pose: { ...NEUTRAL, handsUp: true }, frames: 30 },
      down,
    ]);
    expect(actions).toEqual(["hoverboard"]);
  });

  it("arms swinging during a jump do not change lanes", () => {
    const actions = play(calibrate("hands"), [
      warmup,
      { pose: { x: 0.5, shoulderY: 0.3, rightRaise: true }, frames: 2 },
      { pose: { x: 0.5, shoulderY: 0.27, rightRaise: true }, frames: 5 },
      { pose: { x: 0.5, shoulderY: 0.35 }, frames: 20 },
    ]);
    expect(actions).toEqual(["jump"]);
  });

  it("survives the pose model swapping left/right wrist labels between frames", () => {
    const recognizer = calibrate("hands");
    const actions: GameAction[] = [];
    let t = 30_000;
    const feed = (points: Landmark[]) => actions.push(...recognizer.update(extractFeatures(points), (t += FRAME_MS)).actions);
    for (let i = 0; i < 10; i++) feed(landmarksFor(NEUTRAL));
    for (let i = 0; i < 30; i++) {
      const points = landmarksFor({ ...NEUTRAL, rightRaise: true });
      if (i % 2 === 1) [points[LANDMARK.leftWrist], points[LANDMARK.rightWrist]] = [points[LANDMARK.rightWrist]!, points[LANDMARK.leftWrist]!];
      feed(points);
    }
    expect(actions).toEqual(["right"]);
  });

  it("a hand that was already raised when tracking starts must come down first", () => {
    const recognizer = calibrate("hands");
    expect(play(recognizer, [{ pose: { ...NEUTRAL, rightRaise: true }, frames: 30 }])).toEqual([]);
    expect(play(recognizer, [down, raiseRight], 20_000)).toEqual(["right"]);
  });
});

describe("gesture recognizer", () => {
  it("fires exactly one left per step, even while holding the pose", () => {
    const actions = play(calibrate(), [warmup, { pose: { x: 0.35, shoulderY: 0.35 }, frames: 45 }]);
    expect(actions).toEqual(["left"]);
  });

  it("requires returning to centre before firing the same direction again", () => {
    const left = { pose: { x: 0.36, shoulderY: 0.35 }, frames: 10 };
    const actions = play(calibrate(), [warmup, left, { pose: NEUTRAL, frames: 10 }, left, { pose: NEUTRAL, frames: 10 }]);
    expect(actions).toEqual(["left", "left"]);
  });

  it("detects right moves and leans", () => {
    expect(play(calibrate(), [warmup, { pose: { x: 0.64, shoulderY: 0.35 }, frames: 10 }])).toEqual(["right"]);
    expect(play(calibrate(), [warmup, { pose: { ...NEUTRAL, lean: -0.4 }, frames: 10 }])).toEqual(["left"]);
  });

  it("ignores small jitter around the centre", () => {
    const recognizer = calibrate();
    const script = Array.from({ length: 120 }, (_, i) => ({
      pose: { x: 0.5 + Math.sin(i * 1.7) * 0.02, shoulderY: 0.35 + Math.cos(i * 2.3) * 0.012 },
      frames: 1,
    }));
    expect(play(recognizer, [warmup, ...script])).toEqual([]);
  });

  it("detects a jump and does not mistake the landing dip for a roll", () => {
    const actions = play(calibrate(), [
      warmup,
      { pose: { x: 0.5, shoulderY: 0.3 }, frames: 2 },
      { pose: { x: 0.5, shoulderY: 0.27 }, frames: 5 },
      { pose: { x: 0.5, shoulderY: 0.35 }, frames: 2 },
      { pose: { x: 0.5, shoulderY: 0.42 }, frames: 5 },
      { pose: NEUTRAL, frames: 20 },
    ]);
    expect(actions).toEqual(["jump"]);
  });

  it("detects a crouch as a roll, and standing up is not a jump", () => {
    const actions = play(calibrate(), [
      warmup,
      { pose: { x: 0.5, shoulderY: 0.45 }, frames: 12 },
      { pose: { x: 0.5, shoulderY: 0.33 }, frames: 4 },
      { pose: NEUTRAL, frames: 20 },
    ]);
    expect(actions).toEqual(["roll"]);
  });

  it("does not treat slowly standing on tiptoes as a jump", () => {
    const recognizer = calibrate();
    const script = Array.from({ length: 60 }, (_, i) => ({ pose: { x: 0.5, shoulderY: 0.35 - (i / 60) * 0.05 }, frames: 1 }));
    expect(play(recognizer, [warmup, ...script])).toEqual([]);
  });

  it("raising both hands activates the hoverboard once", () => {
    const actions = play(calibrate(), [warmup, { pose: { ...NEUTRAL, handsUp: true }, frames: 40 }]);
    expect(actions).toEqual(["hoverboard"]);
  });

  it("drops to lost tracking and needs a centre pass before firing after reacquiring", () => {
    const recognizer = calibrate();
    const actions = play(recognizer, [
      warmup,
      { pose: { ...NEUTRAL, visibility: 0.1 }, frames: 30 },
      // Reappears already standing left: must not fire.
      { pose: { x: 0.35, shoulderY: 0.35 }, frames: 15 },
      { pose: NEUTRAL, frames: 10 },
      { pose: { x: 0.35, shoulderY: 0.35 }, frames: 10 },
    ]);
    expect(actions).toEqual(["left"]);
  });

  it("higher sensitivity triggers on smaller movements", () => {
    const small = { pose: { x: 0.4, shoulderY: 0.35 }, frames: 12 };
    const normal = calibrate();
    expect(play(normal, [warmup, small])).toEqual([]);
    const sensitive = calibrate();
    sensitive.setSensitivity(1.5);
    expect(play(sensitive, [warmup, small])).toEqual(["left"]);
  });

  it("stepping back from the camera triggers nothing; moves still register afterwards", () => {
    const recognizer = calibrate();
    // Scale every landmark about the image centre, as a pinhole camera does when the player walks away.
    const atDistance = (x: number, scale: number) =>
      landmarksFor({ x, shoulderY: 0.35 }).map((p) => ({ ...p, x: 0.5 + (p.x - 0.5) * scale, y: 0.5 + (p.y - 0.5) * scale }));
    const actions: GameAction[] = [];
    let t = 50_000;
    for (let i = 0; i < 20; i++) actions.push(...recognizer.update(extractFeatures(atDistance(0.5, 1)), (t += FRAME_MS)).actions);
    // Walk back over two seconds until the body is 60% of its calibrated size.
    for (let i = 0; i <= 60; i++) actions.push(...recognizer.update(extractFeatures(atDistance(0.5, 1 - 0.4 * (i / 60))), (t += FRAME_MS)).actions);
    for (let i = 0; i < 30; i++) actions.push(...recognizer.update(extractFeatures(atDistance(0.5, 0.6)), (t += FRAME_MS)).actions);
    expect(actions).toEqual([]);
    // The same body-relative step left still fires once the player is further away.
    for (let i = 0; i < 15; i++) actions.push(...recognizer.update(extractFeatures(atDistance(0.35, 0.6)), (t += FRAME_MS)).actions);
    expect(actions).toEqual(["left"]);
  });
});
