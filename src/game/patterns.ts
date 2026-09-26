import { WORLD } from "../core/config";
import type { SegmentBuilder } from "./SegmentBuilder";

export interface Pattern {
  id: string;
  /** Minimum difficulty (0–1) before this pattern can appear. */
  minDifficulty: number;
  /** Relative frequency, optionally scaled by difficulty. */
  weight: (difficulty: number) => number;
  build: (b: SegmentBuilder) => void;
}

const carsFor = (b: SegmentBuilder, min: number, max: number) => b.rng.int(min, max);

/**
 * Hand-authored building blocks, each written against an abstract lane
 * permutation `[a, b, c]` so the same idea appears in every lane combination.
 * Every pattern is still checked by the LayoutValidator before it is used.
 */
export const PATTERNS: readonly Pattern[] = [
  {
    id: "coinBreather",
    minDifficulty: 0,
    weight: (d) => 1.2 - d * 0.8,
    build: (b) => {
      const [a, c] = [b.lanes[0], b.lanes[2]];
      const length = b.rng.int(24, 40);
      b.coins(a, 0, length * 0.5);
      b.coins(c, length * 0.55, length);
    },
  },
  {
    id: "barrierSingle",
    minDifficulty: 0,
    weight: (d) => 1.4 - d,
    build: (b) => {
      const [a, lb] = b.lanes;
      const kind = b.randomBarrierKind();
      b.coins(a, -8, 8);
      b.barrier(a, 0, kind);
      if (b.rng.chance(0.5)) b.barrier(lb, 0, b.randomBarrierKind());
      b.pad(4);
    },
  },
  {
    id: "barrierWall",
    minDifficulty: 0.04,
    weight: () => 1,
    build: (b) => {
      const [a] = b.lanes;
      const kinds = b.lanes.map(() => b.randomBarrierKind());
      b.lanes.forEach((lane, i) => b.barrier(lane, 0, kinds[i]!));
      b.coins(a, -8, 8);
      b.pad(4);
    },
  },
  {
    id: "barrierStagger",
    minDifficulty: 0.1,
    weight: (d) => 0.6 + d,
    build: (b) => {
      const spacing = b.jumpClearance;
      b.lanes.forEach((lane, i) => b.barrier(lane, i * spacing, b.randomBarrierKind(i === 1)));
      b.coins(b.lanes[2], -6, spacing * 2 + 6);
      b.pad(4);
    },
  },
  {
    id: "trainsTwo",
    minDifficulty: 0,
    weight: () => 1.3,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      const endA = b.train(a, 0, carsFor(b, 1, 3));
      const offsetB = b.rng.range(0, 12);
      const endB = b.train(lb, offsetB, carsFor(b, 1, 2));
      const runEnd = Math.max(endA, endB);
      b.coins(c, 2, runEnd - 2);
      if (b.difficulty > 0.2 && b.rng.chance(0.6)) b.barrier(c, runEnd * 0.5, b.randomBarrierKind());
    },
  },
  {
    id: "rampRoof",
    minDifficulty: 0,
    weight: () => 1.2,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      const end = b.rampTrain(a, 0, carsFor(b, 2, 3));
      b.coins(a, 1, end - 1);
      if (b.rng.chance(0.7)) b.train(lb, WORLD.rampLength + b.rng.range(2, 10), carsFor(b, 1, 2));
      if (b.rng.chance(0.5)) b.barrier(c, b.rng.range(6, end - 6), b.randomBarrierKind());
      if (b.rng.chance(0.25)) b.item("mysteryBox", a, end - 4);
    },
  },
  {
    id: "roofHop",
    minDifficulty: 0.15,
    weight: (d) => 0.7 + d * 0.6,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      const car = WORLD.trainCarLength;
      const firstEnd = b.rampTrain(a, 0, 3);
      const secondStart = WORLD.rampLength + car * 1.5;
      const secondEnd = b.train(lb, secondStart, 3);
      b.coins(a, 1, firstEnd - 2);
      b.coins(lb, secondStart + 2, secondEnd - 2);
      if (b.rng.chance(0.6)) b.train(c, secondStart + car, 2);
      else b.barrier(c, secondEnd * 0.5, b.randomBarrierKind(true));
    },
  },
  {
    id: "barrierCorridor",
    minDifficulty: 0.12,
    weight: (d) => 0.5 + d * 0.9,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      const count = b.difficulty > 0.5 ? 3 : 2;
      const spacing = b.jumpClearance;
      const corridor = WORLD.trainCarLength * (count >= 3 ? 3 : 2);
      b.train(lb, 0, count >= 3 ? 3 : 2);
      if (b.rng.chance(0.5)) b.train(c, 0, count >= 3 ? 3 : 2);
      for (let i = 0; i < count; i++) b.barrier(a, 4 + i * spacing, b.randomBarrierKind());
      b.coins(a, 0, Math.min(corridor, 4 + count * spacing));
    },
  },
  {
    id: "slalom",
    minDifficulty: 0.2,
    weight: (d) => 0.4 + d * 0.8,
    build: (b) => {
      const spacing = b.laneChangeClearance + 6;
      const order = [b.lanes[0], b.lanes[1], b.lanes[0], b.lanes[2]];
      order.forEach((lane, i) => b.barrier(lane, i * spacing, "block"));
      b.coins(b.lanes[2], -4, spacing * 2);
      b.pad(4);
    },
  },
  {
    id: "oncoming",
    minDifficulty: 0.18,
    weight: (d) => 0.3 + d * 1.1,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      const meet = b.laneChangeClearance + 18;
      b.movingTrain(a, meet, carsFor(b, 1, 2));
      if (b.rng.chance(0.5)) b.train(lb, 4, carsFor(b, 1, 2));
      else b.barrier(lb, meet * 0.6, b.randomBarrierKind());
      b.coins(c, 2, meet + 10);
      if (b.difficulty > 0.45 && b.rng.chance(0.5)) b.barrier(c, meet + 4, b.randomBarrierKind());
    },
  },
  {
    id: "doubleOncoming",
    minDifficulty: 0.55,
    weight: (d) => d * 0.6,
    build: (b) => {
      const [a, lb, c] = b.lanes;
      b.movingTrain(a, 26, 2);
      b.train(lb, 0, 2);
      b.rampTrain(c, 0, 2);
      b.coins(c, 1, WORLD.rampLength + WORLD.trainCarLength * 2 - 1);
    },
  },
];

export const pickPattern = (b: SegmentBuilder, exclude: ReadonlySet<string>): Pattern => {
  const candidates = PATTERNS.filter((pattern) => pattern.minDifficulty <= b.difficulty && !exclude.has(pattern.id));
  const pool = candidates.length > 0 ? candidates : PATTERNS.filter((pattern) => pattern.id === "coinBreather");
  return b.rng.weighted(pool.map((pattern) => ({ item: pattern, weight: pattern.weight(b.difficulty) })));
};
