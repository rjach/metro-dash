import { describe, expect, it } from "vitest";
import { DIFFICULTIES, LANES } from "../src/core/config";

const SPEED = { start: DIFFICULTIES.normal.startSpeed, max: DIFFICULTIES.normal.maxSpeed, rampTimeConstant: DIFFICULTIES.normal.rampTimeConstant };
import { Random } from "../src/core/math";
import { GameSession } from "../src/game/GameSession";
import { LayoutValidator } from "../src/game/LayoutValidator";
import { TrackGenerator } from "../src/game/TrackGenerator";
import { World } from "../src/game/World";
import { Autopilot } from "./helpers/Autopilot";
import { testLoadout } from "./helpers/loadout";

const generate = (seed: number, length: number) => {
  const world = new World();
  const generator = new TrackGenerator(world, new Random(seed));
  generator.reset(0);
  for (let z = 0; z < length; z += 20) {
    const t = z / 22;
    const speed = SPEED.start + (SPEED.max - SPEED.start) * (1 - Math.exp(-t / SPEED.rampTimeConstant));
    generator.update(z, speed, Math.min(1, z / 4500));
  }
  return { world, generator };
};

describe("TrackGenerator", () => {
  it("never overlaps static obstacles within a lane", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const { world } = generate(seed, 6000);
      const statics = world.obstacles.filter((o) => o.speed === 0);
      for (const lane of LANES) {
        const inLane = statics.filter((o) => o.lane === lane).sort((a, b) => a.z - b.z);
        for (let i = 1; i < inLane.length; i++) {
          const previous = inLane[i - 1]!;
          const current = inLane[i]!;
          // Ramps butt directly against their train.
          expect(current.z + 1e-6).toBeGreaterThanOrEqual(previous.z + previous.length - 1e-6);
        }
      }
    }
  });

  it("produces a layout that stays survivable end to end", () => {
    for (let seed = 1; seed <= 12; seed++) {
      const { world, generator } = generate(seed, 5000);
      const statics = world.obstacles.filter((o) => o.speed === 0);
      const exits = LayoutValidator.reachable(
        statics,
        [],
        LANES.map((lane) => ({ lane, level: "ground" as const })),
        0,
        generator.frontier - 5,
        SPEED.max,
      );
      expect(exits.length, `seed ${seed}`).toBeGreaterThan(0);
      expect(generator.stats.fallbacks, `seed ${seed}`).toBeLessThan(generator.stats.segments * 0.05);
    }
  });

  it("uses a wide variety of content", () => {
    const { world } = generate(7, 5000);
    const kinds = new Set(world.obstacles.map((o) => o.kind));
    expect(kinds).toEqual(new Set(["train", "movingTrain", "ramp", "barrierLow", "barrierHigh", "block"]));
    const items = new Set(world.collectibles.map((c) => c.kind));
    expect(items.has("coin")).toBe(true);
    expect([...items].some((kind) => kind !== "coin" && kind !== "key")).toBe(true);
  });
});

const soak = (seed: number, seconds: number) => {
  const session = new GameSession(testLoadout(), seed);
  const bot = new Autopilot(session);
  session.start();
  const dt = 1 / 60;
  let maxLive = 0;
  for (let t = 0; t < seconds && session.phase === "running"; t += dt) {
    const action = bot.decide(dt);
    if (action) session.handleAction(action);
    session.update(dt);
    maxLive = Math.max(maxLive, session.world.obstacles.length + session.world.collectibles.length);
  }
  const pool = session.world.poolStats;
  return { session, maxLive, created: pool.obstaclesCreated + pool.collectiblesCreated };
};

describe("long-session soak (planning autopilot)", () => {
  it("a planning bot survives 4-minute runs across seeds (generator is fair at full speed)", () => {
    const results = Array.from({ length: 10 }, (_, i) => soak(i + 1, 240));
    const survivors = results.filter((r) => r.session.phase === "running").length;
    const summary = results.map((r) => `${Math.round(r.session.stats.distance)}${r.session.crashCause ? `(${r.session.crashCause})` : ""}`);
    console.log("autopilot distances", summary.join(", "));
    expect(survivors).toBeGreaterThanOrEqual(9);
  }, 120_000);

  it("keeps memory bounded over a 10-minute session", () => {
    const { session, maxLive, created } = soak(42, 600);
    console.log(`10-min run: distance ${Math.round(session.stats.distance)} live ${maxLive} pooled ${created}`);
    expect(maxLive).toBeLessThan(500);
    // Pools recycle: allocations plateau instead of growing with distance.
    expect(created).toBeLessThan(900);
  }, 120_000);
});
