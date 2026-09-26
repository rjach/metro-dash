import { describe, expect, it } from "vitest";
import { laneToX, WORLD } from "../src/core/config";
import { GameSession } from "../src/game/GameSession";
import { testLoadout } from "./helpers/loadout";

const newRunningSession = (overrides = {}) => {
  const session = new GameSession(testLoadout(overrides), 1234);
  session.world.clear();
  session.start();
  return session;
};

/** Removes procedural content so hand-placed fixtures are tested in isolation. */
const isolate = (session: GameSession) => {
  session.world.clear();
  // Push the generator frontier far ahead so it does not add content mid-test.
  (session as unknown as { generator: { reset: (z: number) => void; update: () => void } }).generator.update = () => undefined;
};

const run = (session: GameSession, seconds: number, onStep?: () => void) => {
  const dt = 1 / 60;
  for (let t = 0; t < seconds; t += dt) {
    onStep?.();
    session.update(dt);
  }
};

describe("GameSession basics", () => {
  it("starts idle and runs forward after start()", () => {
    const session = new GameSession(testLoadout(), 1);
    expect(session.phase).toBe("idle");
    isolate(session);
    session.start();
    run(session, 1);
    expect(session.phase).toBe("running");
    expect(session.player.z).toBeGreaterThan(10);
    expect(session.stats.score).toBeGreaterThan(10);
  });

  it("changes lanes and bumps at the edge", () => {
    const session = newRunningSession();
    isolate(session);
    const bumps: number[] = [];
    session.events.on("edgeBump", ({ direction }) => bumps.push(direction));
    session.handleAction("left");
    run(session, 0.3);
    expect(session.player.lane).toBe(-1);
    expect(session.player.x).toBeCloseTo(laneToX(-1), 1);
    session.handleAction("left");
    expect(bumps).toEqual([-1]);
  });

  it("pausing freezes the simulation", () => {
    const session = newRunningSession();
    isolate(session);
    run(session, 0.5);
    const z = session.player.z;
    session.pause();
    run(session, 1);
    expect(session.player.z).toBe(z);
    session.resume();
    run(session, 0.2);
    expect(session.player.z).toBeGreaterThan(z);
  });

  it("ignores input when not running", () => {
    const session = new GameSession(testLoadout(), 1);
    session.handleAction("left");
    expect(session.player.lane).toBe(0);
  });
});

describe("obstacle interactions", () => {
  it("crashes head-on into a train", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "train", lane: 0, z: 20 });
    run(session, 2);
    expect(session.phase).toBe("crashed");
    expect(session.crashCause).toBe("train");
  });

  it("jumps over a low barrier", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "barrierLow", lane: 0, z: 20 });
    let jumped = false;
    run(session, 2.5, () => {
      if (!jumped && session.player.z > 20 - session.speed * 0.25) {
        session.handleAction("jump");
        jumped = true;
      }
    });
    expect(session.phase).toBe("running");
    expect(session.player.z).toBeGreaterThan(25);
  });

  it("crashes into a low barrier without jumping", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "barrierLow", lane: 0, z: 20 });
    run(session, 2.5);
    expect(session.phase).toBe("crashed");
  });

  it("rolls under a high barrier", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "barrierHigh", lane: 0, z: 20 });
    let rolled = false;
    run(session, 2.5, () => {
      if (!rolled && session.player.z > 20 - session.speed * 0.3) {
        session.handleAction("roll");
        rolled = true;
      }
    });
    expect(session.phase).toBe("running");
  });

  it("runs up a ramp onto the train roof", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "ramp", lane: 0, z: 15 });
    session.world.addObstacle({ kind: "train", lane: 0, z: 15 + WORLD.rampLength, length: 33 });
    run(session, 2);
    expect(session.phase).toBe("running");
    expect(session.player.y).toBeCloseTo(WORLD.trainHeight, 1);
  });

  it("stumbles on a side hit, then gets caught on the second", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "train", lane: -1, z: 0, length: 400 });
    const stumbles: boolean[] = [];
    session.events.on("stumble", ({ caught }) => stumbles.push(caught));
    run(session, 0.3);
    session.handleAction("left");
    run(session, 1);
    expect(stumbles).toEqual([false]);
    expect(session.player.lane).toBe(0);
    expect(session.phase).toBe("running");
    session.handleAction("left");
    run(session, 1);
    expect(stumbles).toEqual([false, true]);
    expect(session.phase).toBe("crashed");
    expect(session.crashCause).toBe("caught");
  });

  it("an active hoverboard absorbs a crash", () => {
    const session = newRunningSession({ hoverboards: 1 });
    isolate(session);
    session.world.addObstacle({ kind: "block", lane: 0, z: 25 });
    let broke = false;
    session.events.on("hoverboardBreak", () => (broke = true));
    expect(session.activateHoverboard()).toBe(true);
    expect(session.hoverboardsAvailable).toBe(0);
    run(session, 3);
    expect(broke).toBe(true);
    expect(session.phase).toBe("running");
  });

  it("dodges an oncoming train by changing lanes", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "movingTrain", lane: 0, z: 80, length: 22, speed: WORLD.movingTrainSpeed });
    run(session, 0.5);
    session.handleAction("right");
    run(session, 5);
    expect(session.phase).toBe("running");
  });
});

describe("collectibles and power-ups", () => {
  it("collects coins in the lane and scores them", () => {
    const session = newRunningSession();
    isolate(session);
    for (let i = 0; i < 10; i++) session.world.addCollectible("coin", 0, 0.9, 10 + i * 3);
    session.world.addCollectible("coin", laneToX(1), 0.9, 20);
    run(session, 3);
    expect(session.stats.coins).toBe(10);
  });

  it("the magnet pulls coins from other lanes", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addCollectible("magnet", 0, 1, 8);
    for (let i = 0; i < 5; i++) session.world.addCollectible("coin", laneToX(1), 0.9, 30 + i * 3);
    run(session, 4);
    expect(session.stats.coins).toBe(5);
  });

  it("the 2x multiplier doubles the score rate", () => {
    const session = newRunningSession();
    isolate(session);
    expect(session.multiplier).toBe(1);
    session.world.addCollectible("multiplier", 0, 1, 5);
    run(session, 1);
    expect(session.multiplier).toBe(2);
    expect(session.isPowerUpActive("multiplier")).toBe(true);
  });

  it("the jetpack flies over trains and lands safely", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addCollectible("jetpack", 0, 1, 5);
    session.world.addObstacle({ kind: "train", lane: 0, z: 40, length: 33 });
    run(session, 1.5);
    expect(session.player.flying).toBe(true);
    expect(session.player.y).toBeGreaterThan(WORLD.trainHeight);
    run(session, 12);
    expect(session.player.flying).toBe(false);
    expect(session.phase).toBe("running");
  });

  it("super sneakers let the runner jump onto a train", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addCollectible("sneakers", 0, 1, 5);
    session.world.addObstacle({ kind: "train", lane: 0, z: 40, length: 33 });
    let jumped = false;
    run(session, 3, () => {
      if (!jumped && session.player.z > 40 - session.speed * 0.45) {
        session.handleAction("jump");
        jumped = true;
      }
    });
    expect(session.phase).toBe("running");
    expect(session.player.y).toBeCloseTo(WORLD.trainHeight, 1);
  });
});

describe("crash, revive and game over", () => {
  it("revive clears the way and doubles the key cost", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "block", lane: 0, z: 20 });
    session.world.addObstacle({ kind: "block", lane: 0, z: 45 });
    run(session, 2);
    expect(session.phase).toBe("crashed");
    expect(session.reviveCost).toBe(1);
    expect(session.revive()).toBe(true);
    expect(session.reviveCost).toBe(2);
    run(session, 3);
    expect(session.phase).toBe("running");
  });

  it("finish moves to game over and resetRun returns to idle", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "block", lane: 0, z: 20 });
    run(session, 2);
    session.finish();
    expect(session.phase).toBe("gameOver");
    session.resetRun(99);
    expect(session.phase).toBe("idle");
    expect(session.stats.score).toBe(0);
    expect(session.player.z).toBe(0);
  });
});

describe("difficulty", () => {
  it("easy starts slower and turns barrier hits into stumbles; trains still end the run", async () => {
    const { DIFFICULTIES } = await import("../src/core/config");
    const session = new GameSession(testLoadout({ difficulty: DIFFICULTIES.easy }), 5);
    isolate(session);
    session.start();
    expect(session.speed).toBeLessThan(DIFFICULTIES.normal.startSpeed);
    session.world.addObstacle({ kind: "barrierLow", lane: 0, z: 20 });
    run(session, 2.5);
    expect(session.phase).toBe("running");
    session.world.addObstacle({ kind: "train", lane: session.player.lane, z: session.player.z + 25 });
    run(session, 3);
    expect(session.phase).toBe("crashed");
  });
});

describe("headstart", () => {
  it("rockets the runner forward at the start and lands safely", () => {
    const session = newRunningSession();
    isolate(session);
    session.world.addObstacle({ kind: "train", lane: 0, z: 300, length: 33 });
    expect(session.startHeadstart()).toBe(true);
    expect(session.player.flying).toBe(true);
    run(session, 0.5);
    expect(session.speed).toBeGreaterThan(40);
    run(session, 20);
    expect(session.headstartActive).toBe(false);
    expect(session.player.flying).toBe(false);
    expect(session.phase).toBe("running");
    expect(session.player.z).toBeGreaterThan(750);
  });

  it("is only offered in the opening seconds", () => {
    const session = newRunningSession();
    isolate(session);
    run(session, 6);
    expect(session.headstartAvailable).toBe(false);
    expect(session.startHeadstart()).toBe(false);
  });
});
