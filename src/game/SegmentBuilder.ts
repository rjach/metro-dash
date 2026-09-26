import { LANES, laneToX, WORLD, type Lane } from "../core/config";
import type { Random } from "../core/math";
import type { LayoutBlock } from "./LayoutValidator";
import type { CollectibleKind, ObstacleKind } from "./types";

export interface PlannedCollectible {
  kind: CollectibleKind;
  x: number;
  y: number;
  z: number;
}

export interface PlannedMovingTrain {
  lane: Lane;
  meetZ: number;
  cars: number;
  variant: number;
}

export interface PlannedObstacle extends LayoutBlock {
  variant: number;
}

const COIN_GROUND_Y = 0.9;
const COIN_ROLL_Y = 0.45;
const COIN_ROOF_CLEARANCE = 0.9;
const COIN_ARC_EXTRA_HEIGHT = 1.35;

/**
 * Accumulates the contents of one procedural segment before it is validated and
 * committed to the world. Patterns describe intent (a ramp here, coins there);
 * the builder resolves exact geometry such as coin heights over obstacles.
 */
export class SegmentBuilder {
  readonly obstacles: PlannedObstacle[] = [];
  readonly movingTrains: PlannedMovingTrain[] = [];
  readonly collectibles: PlannedCollectible[] = [];
  private readonly coinRequests: { lane: Lane; from: number; to: number }[] = [];
  private end: number;

  /**
   * @param start - Absolute z where the segment content begins
   * @param lanes - Random permutation of lanes so patterns are lane-agnostic
   */
  constructor(
    readonly start: number,
    readonly lanes: readonly [Lane, Lane, Lane],
    readonly rng: Random,
    readonly speed: number,
    readonly difficulty: number,
  ) {
    this.end = start;
  }

  /** Distance covered during a jump plus landing recovery at the current speed. */
  get jumpClearance(): number {
    return Math.max(10, this.speed * 0.72);
  }

  /** Distance needed to complete one lane change with a comfortable reaction margin. */
  get laneChangeClearance(): number {
    return Math.max(7, this.speed * 0.42);
  }

  get extent(): number {
    return this.end;
  }

  randomVariant(): number {
    return this.rng.int(0, 3);
  }

  train(lane: Lane, offset: number, cars: number, variant = this.randomVariant()): number {
    const length = cars * WORLD.trainCarLength;
    this.pushObstacle("train", lane, this.start + offset, length, variant);
    return offset + length;
  }

  /** A ramp that leads directly onto a train; returns the offset where the train ends. */
  rampTrain(lane: Lane, offset: number, cars: number, variant = this.randomVariant()): number {
    this.pushObstacle("ramp", lane, this.start + offset, WORLD.rampLength, variant);
    return this.train(lane, offset + WORLD.rampLength, cars, variant);
  }

  barrier(lane: Lane, offset: number, kind: "barrierLow" | "barrierHigh" | "block"): number {
    const depth = kind === "barrierLow" ? WORLD.lowBarrierDepth : kind === "barrierHigh" ? WORLD.highBarrierDepth : WORLD.blockDepth;
    this.pushObstacle(kind, lane, this.start + offset, depth, this.randomVariant());
    return offset + depth;
  }

  randomBarrierKind(allowBlock = false): "barrierLow" | "barrierHigh" | "block" {
    const options: { item: "barrierLow" | "barrierHigh" | "block"; weight: number }[] = [
      { item: "barrierLow", weight: 1 },
      { item: "barrierHigh", weight: 1 },
    ];
    if (allowBlock) options.push({ item: "block", weight: 0.6 });
    return this.rng.weighted(options);
  }

  /** An oncoming train that reaches the runner at `offset`. */
  movingTrain(lane: Lane, offset: number, cars: number): void {
    const meetZ = this.start + offset;
    this.movingTrains.push({ lane, meetZ, cars, variant: this.randomVariant() });
    this.extendTo(meetZ + cars * WORLD.trainCarLength);
  }

  coins(lane: Lane, fromOffset: number, toOffset: number): void {
    this.coinRequests.push({ lane, from: this.start + fromOffset, to: this.start + toOffset });
    this.extendTo(this.start + toOffset);
  }

  item(kind: CollectibleKind, lane: Lane, offset: number): void {
    const z = this.start + offset;
    this.collectibles.push({ kind, x: laneToX(lane), y: this.surfaceAt(lane, z) + COIN_GROUND_Y + 0.15, z });
    this.extendTo(z);
  }

  pad(length: number): void {
    this.extendTo(this.end + length);
  }

  /** Converts coin requests into concrete positions that hug roofs, arc over barriers and dip under bars. */
  resolveCoins(): void {
    const arcHalf = Math.min(6.5, Math.max(3.5, this.speed * 0.26));
    for (const request of this.coinRequests) {
      for (let z = request.from; z <= request.to; z += WORLD.coinSpacing) {
        const y = this.coinHeight(request.lane, z, arcHalf);
        if (y !== null) this.collectibles.push({ kind: "coin", x: laneToX(request.lane), y, z });
      }
    }
    this.coinRequests.length = 0;
  }

  laneIsClear(lane: Lane, from: number, to: number): boolean {
    return !this.obstacles.some((o) => o.lane === lane && o.z < to && o.z + o.length > from);
  }

  otherLanes(lane: Lane): Lane[] {
    return LANES.filter((candidate) => candidate !== lane);
  }

  private coinHeight(lane: Lane, z: number, arcHalf: number): number | null {
    let y = COIN_GROUND_Y;
    for (const o of this.obstacles) {
      if (o.lane !== lane) continue;
      const start = o.z;
      const end = o.z + o.length;
      if (o.kind === "block" && z > start - 1.5 && z < end + 1.5) return null;
      if ((o.kind === "train" || o.kind === "ramp") && z >= start && z <= end) {
        return this.surfaceAt(lane, z) + COIN_ROOF_CLEARANCE;
      }
      if ((o.kind === "train" || o.kind === "movingTrain") && z > start - 2 && z < start) return null;
      if (o.kind === "barrierLow") {
        const dz = z - (start + o.length / 2);
        if (Math.abs(dz) < arcHalf) y = Math.max(y, COIN_GROUND_Y + COIN_ARC_EXTRA_HEIGHT * (1 - (dz / arcHalf) ** 2));
      }
      if (o.kind === "barrierHigh" && z > start - 2.5 && z < end + 2.5) y = COIN_ROLL_Y;
    }
    for (const train of this.movingTrains) {
      if (train.lane === lane && z >= train.meetZ - 4) return null;
    }
    return y;
  }

  private surfaceAt(lane: Lane, z: number): number {
    let surface = 0;
    for (const o of this.obstacles) {
      if (o.lane !== lane || z < o.z || z > o.z + o.length) continue;
      if (o.kind === "train") surface = Math.max(surface, o.length > 0 ? WORLD.trainHeight : 0);
      if (o.kind === "ramp") surface = Math.max(surface, (WORLD.trainHeight * (z - o.z)) / o.length);
    }
    return surface;
  }

  private pushObstacle(kind: ObstacleKind, lane: Lane, z: number, length: number, variant: number): void {
    this.obstacles.push({ kind, lane, z, length, variant });
    this.extendTo(z + length);
  }

  private extendTo(z: number): void {
    if (z > this.end) this.end = z;
  }
}
