import { LANES, laneToX, WORLD, type Lane } from "../core/config";
import { lerp, type Random } from "../core/math";
import { LayoutValidator, type LaneReservation, type ReachState } from "./LayoutValidator";
import { pickPattern } from "./patterns";
import { SegmentBuilder, type PlannedMovingTrain } from "./SegmentBuilder";
import type { PowerUpKind } from "./types";
import type { World } from "./World";

/** Oncoming trains are materialised this far ahead of the runner. */
const MOVING_TRAIN_SPAWN_LEAD = 85;
const MAX_PATTERN_ATTEMPTS = 10;
const START_CLEARANCE = 45;
const POWER_UP_MIN_SPACING = 160;
const KEY_MIN_SPACING = 1400;

const POWER_UP_WEIGHTS: readonly { item: PowerUpKind; weight: number }[] = [
  { item: "magnet", weight: 0.3 },
  { item: "multiplier", weight: 0.24 },
  { item: "sneakers", weight: 0.2 },
  { item: "jetpack", weight: 0.14 },
  { item: "mysteryBox", weight: 0.12 },
];

export interface GeneratorStats {
  segments: number;
  rejectedPatterns: number;
  fallbacks: number;
}

/**
 * Infinite procedural track. Segments are chosen from the pattern library,
 * proven survivable by the LayoutValidator (including lanes reserved by
 * oncoming trains), then committed to the World with coins and power-ups.
 */
export class TrackGenerator {
  private cursor = 0;
  private entry: ReachState[] = LANES.map((lane) => ({ lane, level: "ground" as const }));
  private reservations: LaneReservation[] = [];
  private staticFreeUntil = new Map<Lane, number>();
  private pendingMovingTrains: PlannedMovingTrain[] = [];
  private lastPatternId = "";
  private lastPowerUpZ = 0;
  private lastKeyZ = 0;
  readonly stats: GeneratorStats = { segments: 0, rejectedPatterns: 0, fallbacks: 0 };

  constructor(
    private readonly world: World,
    private rng: Random,
  ) {}

  reset(startZ: number, rng: Random = this.rng): void {
    this.rng = rng;
    this.cursor = startZ + START_CLEARANCE;
    this.entry = LANES.map((lane) => ({ lane, level: "ground" as const }));
    this.reservations = [];
    this.staticFreeUntil.clear();
    this.pendingMovingTrains = [];
    this.lastPatternId = "";
    this.lastPowerUpZ = startZ;
    this.lastKeyZ = startZ;
  }

  get frontier(): number {
    return this.cursor;
  }

  /**
   * Generates content up to the spawn horizon and materialises oncoming trains.
   *
   * @param playerZ - Runner position
   * @param speed - Current runner speed (m/s)
   * @param difficulty - 0 (start) to 1 (max)
   */
  update(playerZ: number, speed: number, difficulty: number, gapScale = 1): void {
    while (this.cursor < playerZ + WORLD.spawnAhead) this.generateSegment(speed, difficulty, gapScale);
    this.spawnDueMovingTrains(playerZ, speed);
    this.reservations = this.reservations.filter((r) => r.to > playerZ - 10);
  }

  /** Drops queued oncoming trains inside a window (used when clearing space after a revive). */
  clearRange(fromZ: number, toZ: number): void {
    this.pendingMovingTrains = this.pendingMovingTrains.filter((t) => t.meetZ < fromZ || t.meetZ > toZ + MOVING_TRAIN_SPAWN_LEAD);
  }

  /** Lays weaving coin trails at jetpack altitude between two z positions. */
  spawnSkyCoins(fromZ: number, toZ: number): void {
    let lane: Lane = this.rng.pick(LANES);
    let nextSwitch = fromZ + this.rng.range(18, 30);
    for (let z = fromZ; z < toZ; z += WORLD.coinSpacing) {
      if (z > nextSwitch) {
        const options = LANES.filter((candidate) => Math.abs(candidate - lane) === 1);
        lane = this.rng.pick(options);
        nextSwitch = z + this.rng.range(18, 30);
      }
      this.world.addCollectible("coin", laneToX(lane), WORLD.jetpackAltitude + 0.85, z);
    }
  }

  private generateSegment(speed: number, difficulty: number, gapScale: number): void {
    const gap = (lerp(30, 13, difficulty) + speed * 0.3 + this.rng.range(0, 8)) * gapScale;
    const start = this.cursor + gap;
    const excluded = new Set([this.lastPatternId]);

    for (let attempt = 0; attempt < MAX_PATTERN_ATTEMPTS; attempt++) {
      const builder = this.newBuilder(start, speed, difficulty);
      const pattern = pickPattern(builder, excluded);
      pattern.build(builder);
      builder.resolveCoins();
      const newReservations = this.reservationsFor(builder.movingTrains);
      const exits = this.validate(builder, newReservations, speed);
      if (exits && this.respectsStaticFree(builder)) {
        this.commit(builder, newReservations, exits, speed, gap);
        this.lastPatternId = pattern.id;
        return;
      }
      this.stats.rejectedPatterns++;
      excluded.add(pattern.id);
    }

    this.stats.fallbacks++;
    const fallback = this.newBuilder(start, speed, difficulty);
    fallback.pad(20);
    this.commit(fallback, [], this.validate(fallback, [], speed) ?? this.entry, speed, gap);
    this.lastPatternId = "fallback";
  }

  private newBuilder(start: number, speed: number, difficulty: number): SegmentBuilder {
    const lanes = this.rng.shuffle([...LANES]) as [Lane, Lane, Lane];
    return new SegmentBuilder(start, lanes, this.rng, speed, difficulty);
  }

  private reservationsFor(trains: readonly PlannedMovingTrain[]): LaneReservation[] {
    return trains.map((train) => ({
      lane: train.lane,
      from: train.meetZ - 1.5,
      to: train.meetZ + train.cars * WORLD.trainCarLength,
    }));
  }

  private validate(builder: SegmentBuilder, newReservations: LaneReservation[], speed: number): ReachState[] | null {
    const end = Math.max(builder.extent, builder.start) + 2;
    const exits = LayoutValidator.reachable(builder.obstacles, [...this.reservations, ...newReservations], this.entry, this.cursor, end, speed);
    return exits.length > 0 ? exits : null;
  }

  /** Static obstacles may not sit in the path an oncoming train will sweep through. */
  private respectsStaticFree(builder: SegmentBuilder): boolean {
    for (const obstacle of builder.obstacles) {
      const until = this.staticFreeUntil.get(obstacle.lane);
      if (until !== undefined && obstacle.z < until) return false;
    }
    for (const train of builder.movingTrains) {
      if (builder.obstacles.some((o) => o.lane === train.lane && o.z + o.length > train.meetZ - 2)) return false;
    }
    return true;
  }

  private commit(builder: SegmentBuilder, newReservations: LaneReservation[], exits: ReachState[], speed: number, gap: number): void {
    for (const planned of builder.obstacles) {
      this.world.addObstacle({ kind: planned.kind, lane: planned.lane, z: planned.z, length: planned.length, variant: planned.variant });
    }
    for (const item of builder.collectibles) this.world.addCollectible(item.kind, item.x, item.y, item.z);
    for (const train of builder.movingTrains) {
      this.pendingMovingTrains.push(train);
      const sweepEnd = train.meetZ + (WORLD.movingTrainSpeed * MOVING_TRAIN_SPAWN_LEAD) / Math.max(1, speed) + train.cars * WORLD.trainCarLength;
      this.staticFreeUntil.set(train.lane, Math.max(this.staticFreeUntil.get(train.lane) ?? 0, sweepEnd));
    }
    this.reservations.push(...newReservations);
    this.placeGapRewards(this.cursor, this.cursor + gap);
    this.entry = exits;
    this.cursor = Math.max(builder.extent, builder.start);
    this.stats.segments++;
  }

  /** The open stretch before a segment is the fair place for power-ups and keys. */
  private placeGapRewards(gapStart: number, gapEnd: number): void {
    const z = (gapStart + gapEnd) / 2;
    const lanes = LANES.filter(
      (lane) => !this.reservations.some((r) => r.lane === lane && z >= r.from - 4 && z <= r.to) && z >= (this.staticFreeUntil.get(lane) ?? -Infinity),
    );
    if (lanes.length === 0) return;
    const lane = this.rng.pick(lanes);
    if (z - this.lastKeyZ > KEY_MIN_SPACING && this.rng.chance(0.25)) {
      this.world.addCollectible("key", laneToX(lane), 1.05, z);
      this.lastKeyZ = z;
      return;
    }
    if (z - this.lastPowerUpZ > POWER_UP_MIN_SPACING && this.rng.chance(0.35)) {
      this.world.addCollectible(this.rng.weighted(POWER_UP_WEIGHTS), laneToX(lane), 1.05, z);
      this.lastPowerUpZ = z;
    }
  }

  private spawnDueMovingTrains(playerZ: number, speed: number): void {
    if (this.pendingMovingTrains.length === 0) return;
    const remaining: PlannedMovingTrain[] = [];
    for (const train of this.pendingMovingTrains) {
      const lead = train.meetZ - playerZ;
      if (lead > MOVING_TRAIN_SPAWN_LEAD) {
        remaining.push(train);
        continue;
      }
      if (lead <= 0) continue;
      const spawnZ = train.meetZ + (WORLD.movingTrainSpeed * lead) / Math.max(1, speed);
      this.world.addObstacle({
        kind: "movingTrain",
        lane: train.lane,
        z: spawnZ,
        length: train.cars * WORLD.trainCarLength,
        speed: WORLD.movingTrainSpeed,
        variant: train.variant,
      });
    }
    this.pendingMovingTrains = remaining;
  }
}
