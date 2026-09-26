import type { GameAction } from "../../game/actions";
import type { CalibrationProfile, LaneGesture } from "../../persistence/SaveData";
import type { BodyFeatures } from "./BodyFeatures";
import { OneEuroFilter } from "./OneEuroFilter";

export interface GestureTuning {
  /** Horizontal offset from the calibrated centre, in torso lengths, that triggers a lane change. */
  lateralEnter: number;
  /** Offset below which the player counts as back in the centre (re-arms lateral moves). */
  lateralExit: number;
  /** Spine tilt (radians) that triggers a lane change on its own. */
  tiltEnter: number;
  tiltExit: number;
  /** Shoulder rise above baseline, in torso lengths, that counts as a jump. */
  jumpEnter: number;
  jumpExit: number;
  /** Minimum upward speed (torso lengths/s) so slowly standing tall is not a jump. */
  jumpMinVelocity: number;
  /** Shoulder drop below baseline, in torso lengths, that counts as a crouch. */
  crouchEnter: number;
  crouchExit: number;
  /** Consecutive frames a condition must hold before it fires (temporal confirmation). */
  confirmFrames: number;
  lateralCooldownMs: number;
  verticalCooldownMs: number;
  /** After a jump ends, crouches are ignored this long (the landing dip is not a roll). */
  landingSuppressMs: number;
  /** After a crouch ends, jumps are ignored this long (standing back up is not a jump). */
  standUpSuppressMs: number;
  handsHoldMs: number;
  lostAfterMs: number;
  minConfidence: number;
  /** Per-frame blend toward the live pose while idle in the centre (compensates slow drift). */
  baselineAdaptRate: number;
  /** Hand-raise lanes: rise above the relaxed position (torso lengths) that counts as "hand up" (≈ chest height). */
  handRaiseEnter: number;
  /** A raised hand re-arms once it drops back below this. */
  handRaiseExit: number;
  /** The other hand must stay below this for a raise to count (keeps two-handed gestures unambiguous). */
  otherHandDownMax: number;
  /** Lane raises are ignored for this long after a jump or crouch ends (arms swing during those). */
  handSettleMs: number;
}

/**
 * Shoulder width from pose models is noisy (it collapses whenever the chest
 * turns slightly), while shoulder-to-hip distance is stable. Torso length is
 * therefore the body scale; this ratio converts when hips are not visible.
 */
export const TORSO_PER_SHOULDER_WIDTH = 1.35;

export const DEFAULT_TUNING: GestureTuning = {
  lateralEnter: 0.42,
  lateralExit: 0.18,
  tiltEnter: 0.18,
  tiltExit: 0.08,
  jumpEnter: 0.13,
  jumpExit: 0.05,
  jumpMinVelocity: 0.55,
  crouchEnter: 0.22,
  crouchExit: 0.1,
  confirmFrames: 2,
  lateralCooldownMs: 160,
  verticalCooldownMs: 300,
  landingSuppressMs: 380,
  standUpSuppressMs: 320,
  handsHoldMs: 350,
  lostAfterMs: 450,
  minConfidence: 0.5,
  baselineAdaptRate: 0.015,
  handRaiseEnter: 0.55,
  handRaiseExit: 0.3,
  otherHandDownMax: 0.32,
  handSettleMs: 300,
};

export type LateralState = "center" | "left" | "right";
export type VerticalState = "neutral" | "jump" | "crouch";
export type TrackingState = "tracking" | "lost";

export interface GestureSnapshot {
  tracking: TrackingState;
  lateral: LateralState;
  vertical: VerticalState;
  /** Offset from centre in torso lengths (+ = player's right). */
  offsetX: number;
  tilt: number;
  /** Rise above baseline in torso lengths (+ = up). */
  rise: number;
  confidence: number;
  handsUp: boolean;
  /** False until the player returns to centre after (re)acquiring tracking. */
  armed: boolean;
  /** Hand raise above the relaxed position (torso lengths), or null when not visible. */
  leftHand: number | null;
  rightHand: number | null;
}

export interface GestureResult {
  actions: GameAction[];
  snapshot: GestureSnapshot;
}

/**
 * Converts a stream of body features into discrete GameActions. Each gesture
 * is a small state machine with hysteresis: a lean fires one lane change and
 * must return to centre before it can fire again, so one physical movement
 * never produces repeated actions.
 */
export class GestureRecognizer {
  private readonly tuning: GestureTuning;
  private sensitivity = 1;
  private baseline: CalibrationProfile;
  private readonly filterX = new OneEuroFilter(1.2, 0.8);
  private readonly filterShoulderY = new OneEuroFilter(1.6, 1.2);
  private readonly filterScale = new OneEuroFilter(0.6, 0.1);
  /** Current body scale (torso length in image units); held while hips are out of frame. */
  private scale: number | null = null;
  private readonly filterTilt = new OneEuroFilter(1.2, 0.6);

  private tracking: TrackingState = "lost";
  private lastSeenMs = -Infinity;
  private lateral: LateralState = "center";
  private vertical: VerticalState = "neutral";
  private armed = false;
  private leftFrames = 0;
  private rightFrames = 0;
  private jumpFrames = 0;
  private crouchFrames = 0;
  private lastLateralMs = -Infinity;
  private lastVerticalMs = -Infinity;
  private jumpEndedMs = -Infinity;
  private crouchEndedMs = -Infinity;
  private handsUpSince: number | null = null;
  private handsFired = false;
  private laneMode: LaneGesture = "hands";
  private readonly filterLeftHand = new OneEuroFilter(2.0, 1.5);
  private readonly filterRightHand = new OneEuroFilter(2.0, 1.5);
  /** Per-hand state: a hand must be seen down before a raise can fire. */
  private handState: Record<"left" | "right", "unarmed" | "down" | "up"> = { left: "unarmed", right: "unarmed" };
  private handFrames: Record<"left" | "right", number> = { left: 0, right: 0 };
  private snapshot: GestureSnapshot = {
    tracking: "lost",
    lateral: "center",
    vertical: "neutral",
    offsetX: 0,
    tilt: 0,
    rise: 0,
    confidence: 0,
    handsUp: false,
    armed: false,
    leftHand: null,
    rightHand: null,
  };

  constructor(profile: CalibrationProfile, tuning: Partial<GestureTuning> = {}) {
    this.baseline = { ...profile };
    this.tuning = { ...DEFAULT_TUNING, ...tuning };
  }

  /** Chooses hand raises (default) or leaning/stepping for lane changes. */
  setLaneMode(mode: LaneGesture): void {
    if (mode === this.laneMode) return;
    this.laneMode = mode;
    this.lateral = "center";
    this.handState = { left: "unarmed", right: "unarmed" };
  }

  get laneGesture(): LaneGesture {
    return this.laneMode;
  }

  /** Higher sensitivity lowers every threshold (0.5–1.5). */
  setSensitivity(value: number): void {
    this.sensitivity = Math.min(1.5, Math.max(0.5, value));
  }

  setProfile(profile: CalibrationProfile): void {
    this.baseline = { ...profile };
    this.reset();
  }

  get profile(): CalibrationProfile {
    return { ...this.baseline };
  }

  reset(): void {
    this.filterX.reset();
    this.filterShoulderY.reset();
    this.filterScale.reset();
    this.scale = null;
    this.filterTilt.reset();
    this.tracking = "lost";
    this.lateral = "center";
    this.vertical = "neutral";
    this.armed = false;
    this.leftFrames = this.rightFrames = this.jumpFrames = this.crouchFrames = 0;
    this.handsUpSince = null;
    this.handsFired = false;
    this.filterLeftHand.reset();
    this.filterRightHand.reset();
    this.handState = { left: "unarmed", right: "unarmed" };
    this.handFrames = { left: 0, right: 0 };
  }

  /**
   * @param features - Features for this frame, or null when no confident pose was found
   * @param timeMs - Monotonic frame timestamp in milliseconds
   */
  update(features: BodyFeatures | null, timeMs: number): GestureResult {
    const actions: GameAction[] = [];
    const confident = features !== null && features.confidence >= this.tuning.minConfidence;
    if (!confident) {
      if (timeMs - this.lastSeenMs > this.tuning.lostAfterMs && this.tracking !== "lost") {
        this.reset();
      }
      this.snapshot = { ...this.snapshot, tracking: this.tracking, confidence: features?.confidence ?? 0 };
      return { actions, snapshot: this.snapshot };
    }

    this.lastSeenMs = timeMs;
    this.tracking = "tracking";
    const seconds = timeMs / 1000;
    const x = this.filterX.filter(features.centerX, seconds);
    const shoulderY = this.filterShoulderY.filter(features.shoulderY, seconds);
    const tilt = features.tilt === null ? 0 : this.filterTilt.filter(features.tilt, seconds);
    if (features.torsoLength !== null) this.scale = this.filterScale.filter(features.torsoLength, seconds);
    this.scale ??= this.baseline.torsoLength;

    // Scale-aware normalisation: moving nearer/further from the camera does not change the thresholds.
    const torso = this.scale;
    // Perspective compensation: stepping toward or away from the camera scales every
    // landmark about the image centre. Project the calibrated pose by the same factor so
    // distance changes are not mistaken for lateral moves or crouches.
    const depthScale = torso / this.baseline.torsoLength;
    const expectedX = 0.5 + (this.baseline.centerX - 0.5) * depthScale;
    const expectedShoulderY = 0.5 + (this.baseline.shoulderY - 0.5) * depthScale;
    const offsetX = (x - expectedX) / torso;
    const rise = (expectedShoulderY - shoulderY) / torso;
    const riseVelocity = -this.filterShoulderY.velocity / torso;
    const k = 1 / this.sensitivity;
    const t = this.tuning;

    const leftHand = features.leftHandHeight === null ? null : this.filterLeftHand.filter(features.leftHandHeight, seconds) - this.baseline.leftHandRest;
    const rightHand = features.rightHandHeight === null ? null : this.filterRightHand.filter(features.rightHandHeight, seconds) - this.baseline.rightHandRest;
    if (this.laneMode === "lean") this.updateLateral(offsetX, tilt, features.tilt !== null, timeMs, k, actions);
    this.updateVertical(rise, riseVelocity, features.wristsAboveHead, timeMs, k, actions);
    // Hands are judged after the body: an arm swing that belongs to a jump or crouch must not become a lane change.
    if (this.laneMode === "hands") this.updateHandLanes(leftHand, rightHand, timeMs, k, actions);
    this.updateHands(features.wristsAboveHead, timeMs, actions);

    // Slowly follow drift (the player shuffling or the camera settling) only while idle in the centre.
    if (this.laneMode === "hands") this.armed = this.handState.left !== "unarmed" && this.handState.right !== "unarmed";
    if (this.armed && this.lateral === "center" && this.vertical === "neutral" && Math.abs(offsetX) < t.lateralExit * 0.5 && Math.abs(rise) < t.jumpExit) {
      // Adapt in the calibrated frame of reference (undo the perspective projection first).
      const a = t.baselineAdaptRate;
      const observedX = 0.5 + (x - 0.5) / depthScale;
      const observedShoulderY = 0.5 + (shoulderY - 0.5) / depthScale;
      this.baseline.centerX += (observedX - this.baseline.centerX) * a;
      this.baseline.shoulderY += (observedShoulderY - this.baseline.shoulderY) * a;
    }

    this.snapshot = {
      tracking: this.tracking,
      lateral: this.lateral,
      vertical: this.vertical,
      offsetX,
      tilt,
      rise,
      confidence: features.confidence,
      handsUp: features.wristsAboveHead,
      armed: this.armed,
      leftHand,
      rightHand,
    };
    return { actions, snapshot: this.snapshot };
  }

  /**
   * Hand-raise lanes: with both hands relaxed, lifting one hand to chest height
   * moves one lane toward that hand. The hand must come back down before it can
   * fire again, and the other hand must stay down so two-handed gestures (the
   * hoverboard) never trigger a lane change on the way up.
   */
  private updateHandLanes(left: number | null, right: number | null, timeMs: number, k: number, actions: GameAction[]): void {
    const t = this.tuning;
    const bodyMoving = this.vertical !== "neutral" || this.jumpFrames > 0 || this.crouchFrames > 0;
    const settling = bodyMoving || timeMs - Math.max(this.jumpEndedMs, this.crouchEndedMs, this.lastVerticalMs) < t.handSettleMs;
    // Slightly longer confirmation than body gestures, so a starting jump can claim the arm swing first.
    const confirmFrames = t.confirmFrames + 2;
    const heights = { left, right };
    for (const side of ["left", "right"] as const) {
      const height = heights[side];
      const other = heights[side === "left" ? "right" : "left"];
      if (height === null) {
        this.handFrames[side] = 0;
        continue;
      }
      if (height < t.handRaiseExit * k) {
        this.handState[side] = "down";
        this.handFrames[side] = 0;
        continue;
      }
      if (this.handState[side] !== "down" || height < t.handRaiseEnter * k) {
        this.handFrames[side] = 0;
        continue;
      }
      const otherDown = other === null || other < t.otherHandDownMax;
      this.handFrames[side] = otherDown && !settling ? this.handFrames[side] + 1 : 0;
      if (this.handFrames[side] >= confirmFrames && timeMs - this.lastLateralMs >= t.lateralCooldownMs) {
        this.handState[side] = "up";
        this.handFrames[side] = 0;
        this.lastLateralMs = timeMs;
        actions.push(side);
      }
    }
    this.lateral = this.handState.left === "up" ? "left" : this.handState.right === "up" ? "right" : "center";
  }

  private updateLateral(offsetX: number, tilt: number, hasTilt: boolean, timeMs: number, k: number, actions: GameAction[]): void {
    const t = this.tuning;
    const leftNow = offsetX < -t.lateralEnter * k || (hasTilt && tilt < -t.tiltEnter * k);
    const rightNow = offsetX > t.lateralEnter * k || (hasTilt && tilt > t.tiltEnter * k);
    const centered = Math.abs(offsetX) < t.lateralExit * k && (!hasTilt || Math.abs(tilt) < t.tiltExit * k);

    if (centered) {
      this.lateral = "center";
      this.armed = true;
      this.leftFrames = this.rightFrames = 0;
      return;
    }
    if (!this.armed || this.lateral !== "center") return;

    this.leftFrames = leftNow ? this.leftFrames + 1 : 0;
    this.rightFrames = rightNow ? this.rightFrames + 1 : 0;
    if (timeMs - this.lastLateralMs < t.lateralCooldownMs) return;
    if (this.leftFrames >= t.confirmFrames) {
      this.lateral = "left";
      this.lastLateralMs = timeMs;
      actions.push("left");
    } else if (this.rightFrames >= t.confirmFrames) {
      this.lateral = "right";
      this.lastLateralMs = timeMs;
      actions.push("right");
    }
  }

  private updateVertical(rise: number, riseVelocity: number, handsUp: boolean, timeMs: number, k: number, actions: GameAction[]): void {
    const t = this.tuning;
    if (this.vertical === "jump") {
      if (rise < t.jumpExit * k) {
        this.vertical = "neutral";
        this.jumpEndedMs = timeMs;
      }
      return;
    }
    if (this.vertical === "crouch") {
      if (rise > -t.crouchExit * k) {
        this.vertical = "neutral";
        this.crouchEndedMs = timeMs;
      }
      return;
    }

    const cooling = timeMs - this.lastVerticalMs < t.verticalCooldownMs;
    // Raising both arms lifts the shoulders; that gesture is reserved for the hoverboard.
    const jumpNow = !handsUp && rise > t.jumpEnter * k && riseVelocity > t.jumpMinVelocity * k && timeMs - this.crouchEndedMs > t.standUpSuppressMs;
    const crouchNow = rise < -t.crouchEnter * k && timeMs - this.jumpEndedMs > t.landingSuppressMs;
    this.jumpFrames = jumpNow ? this.jumpFrames + 1 : 0;
    this.crouchFrames = crouchNow ? this.crouchFrames + 1 : 0;
    if (cooling) return;
    if (this.jumpFrames >= t.confirmFrames) {
      this.vertical = "jump";
      this.lastVerticalMs = timeMs;
      this.jumpFrames = 0;
      actions.push("jump");
    } else if (this.crouchFrames >= t.confirmFrames) {
      this.vertical = "crouch";
      this.lastVerticalMs = timeMs;
      this.crouchFrames = 0;
      actions.push("roll");
    }
  }

  private updateHands(handsUp: boolean, timeMs: number, actions: GameAction[]): void {
    if (!handsUp) {
      this.handsUpSince = null;
      this.handsFired = false;
      return;
    }
    this.handsUpSince ??= timeMs;
    if (!this.handsFired && timeMs - this.handsUpSince >= this.tuning.handsHoldMs) {
      this.handsFired = true;
      actions.push("hoverboard");
    }
  }
}
