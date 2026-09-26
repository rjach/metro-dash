import { LANES, type Lane } from "../core/config";
import type { ObstacleKind } from "./types";

export interface LayoutBlock {
  kind: ObstacleKind;
  lane: Lane;
  z: number;
  length: number;
}

/** A lane that is impassable at ground level over a z-interval (e.g. an oncoming train's path). */
export interface LaneReservation {
  lane: Lane;
  from: number;
  to: number;
}

/** Player state used for reachability: which lane, and whether on the ground or a roof. */
export type Level = "ground" | "roof";
export interface ReachState {
  lane: Lane;
  level: Level;
}

const SAMPLE_STEP = 0.5;
/** Seconds a lane change occupies both lanes; slightly pessimistic versus the real ~0.15 s. */
const LANE_CHANGE_TIME = 0.2;
/** Safety margin (m) in front of a solid obstacle where the lane is already considered committed. */
const FRONT_MARGIN = 0.8;
/** The runner's body extends behind its centre, so a lane stays blocked briefly after an obstacle's tail. */
const BACK_MARGIN = 0.7;
/** Fraction of the way up a ramp after which the runner is high enough to hop onto a neighbouring roof. */
const RAMP_HOP_FRACTION = 0.8;
const UNREACHABLE = 0xffff;
/** Seconds of warning a runner needs after entering a lane before a jump/roll barrier. */
const BARRIER_REACTION_TIME = 0.28;

interface LaneCell {
  groundOk: boolean;
  roofOk: boolean;
  /** Ramp surface: ground players can climb onto roof level here. */
  ramp: boolean;
  /** 0 at the foot of a ramp, 1 at its top. */
  rampFraction: number;
  /** Just before a jump/roll barrier: fair play requires already being in this lane. */
  barrierZone: boolean;
}

/**
 * Proves a generated layout is survivable without power-ups. It sweeps the
 * segment in small z steps, tracking every (lane, level) state reachable by a
 * perfect player who can jump low barriers, roll under high ones, climb ramps,
 * hop between adjacent roofs and change lanes at a finite speed.
 */
const STATES: readonly ReachState[] = LANES.flatMap((lane) => (["ground", "roof"] as const).map((level) => ({ lane, level })));
const stateKey = (state: ReachState): number => (state.lane + 1) * 2 + (state.level === "roof" ? 1 : 0);

export class LayoutValidator {
  /**
   * @param blocks - Obstacles in (and overlapping) the segment
   * @param reservations - Lane intervals that are blocked regardless of static obstacles
   * @param entry - States reachable at `fromZ`
   * @param speed - Runner speed, which sets how far a lane change travels
   * @returns States reachable at `toZ` (empty when the layout is unwinnable)
   */
  static reachable(
    blocks: readonly LayoutBlock[],
    reservations: readonly LaneReservation[],
    entry: readonly ReachState[],
    fromZ: number,
    toZ: number,
    speed: number,
  ): ReachState[] {
    const sweep = LayoutValidator.sweep(blocks, reservations, entry, fromZ, toZ, speed);
    const last = sweep.cost[sweep.sampleCount]!;
    return STATES.filter((state) => last[stateKey(state)]! !== UNREACHABLE);
  }

  /**
   * Finds one survivable route from a single start state.
   *
   * @returns Waypoints (one per sample) or null when no route exists
   */
  static plan(
    blocks: readonly LayoutBlock[],
    reservations: readonly LaneReservation[],
    start: ReachState,
    fromZ: number,
    toZ: number,
    speed: number,
  ): (ReachState & { z: number })[] | null {
    const sweep = LayoutValidator.sweep(blocks, reservations, [start], fromZ, toZ, speed);
    // Prefer finishing in the starting lane, on the ground, to avoid pointless weaving.
    const preference = [...STATES].sort((a, b) => Math.abs(a.lane - start.lane) - Math.abs(b.lane - start.lane) || (a.level === "ground" ? -1 : 1));
    const last = sweep.cost[sweep.sampleCount]!;
    const reachable = preference.filter((state) => last[stateKey(state)]! !== UNREACHABLE);
    const end = reachable.reduce<ReachState | undefined>(
      (best, state) => (best === undefined || last[stateKey(state)]! < last[stateKey(best)]! ? state : best),
      undefined,
    );
    if (!end) return null;
    const path: (ReachState & { z: number })[] = [];
    let index = sweep.sampleCount;
    let key = stateKey(end);
    while (index >= 0) {
      const state = STATES[key]!;
      path.push({ ...state, z: fromZ + index * SAMPLE_STEP });
      const parent = sweep.parent[index]![key]!;
      if (parent < 0) break;
      const previousIndex = Math.floor(parent / 8);
      // Fill in the samples skipped by a lane change so the path is dense.
      for (let fill = index - 1; fill > previousIndex; fill--) path.push({ ...state, z: fromZ + fill * SAMPLE_STEP });
      index = previousIndex;
      key = parent % 8;
    }
    return path.reverse();
  }

  private static sweep(
    blocks: readonly LayoutBlock[],
    reservations: readonly LaneReservation[],
    entry: readonly ReachState[],
    fromZ: number,
    toZ: number,
    speed: number,
  ): { cost: Uint16Array[]; parent: Int32Array[]; sampleCount: number } {
    const sampleCount = Math.max(1, Math.ceil((toZ - fromZ) / SAMPLE_STEP));
    const changeSamples = Math.max(1, Math.ceil((speed * LANE_CHANGE_TIME) / SAMPLE_STEP));
    const cells = LayoutValidator.rasterize(blocks, reservations, fromZ, sampleCount, Math.max(3, speed * BARRIER_REACTION_TIME));
    // cost = number of lane changes on the cheapest route to each state, so plans avoid weaving.
    const cost: Uint16Array[] = Array.from({ length: sampleCount + 1 }, () => new Uint16Array(6).fill(UNREACHABLE));
    const parent: Int32Array[] = Array.from({ length: sampleCount + 1 }, () => new Int32Array(6).fill(-1));

    for (const state of entry) {
      const cell = cells[0]![state.lane + 1]!;
      if (state.level === "ground" ? cell.groundOk || cell.ramp : cell.roofOk) cost[0]![stateKey(state)] = 0;
    }

    const cellAt = (i: number, lane: Lane) => cells[Math.min(i, sampleCount)]![lane + 1]!;
    const standable = (i: number, lane: Lane, level: Level): boolean => {
      const cell = cellAt(i, lane);
      return level === "ground" ? cell.groundOk : cell.roofOk;
    };
    const mark = (index: number, state: ReachState, from: number, fromKey: number, extra: number) => {
      const key = stateKey(state);
      const candidate = cost[from]![fromKey]! + extra;
      if (candidate >= cost[index]![key]!) return;
      cost[index]![key] = candidate;
      parent[index]![key] = from * 8 + fromKey;
    };

    for (let i = 0; i < sampleCount; i++) {
      for (const state of STATES) {
        const currentKey = stateKey(state);
        if (cost[i]![currentKey] === UNREACHABLE) continue;
        const { lane, level } = state;
        const here = cellAt(i, lane);
        const next = cellAt(i + 1, lane);
        // Continue straight ahead.
        if (level === "ground") {
          if (next.groundOk) mark(i + 1, { lane, level: "ground" }, i, currentKey, 0);
          if (next.ramp) mark(i + 1, { lane, level: "roof" }, i, currentKey, 0);
        } else if (next.roofOk) {
          mark(i + 1, { lane, level: "roof" }, i, currentKey, 0);
        } else if (next.groundOk) {
          mark(i + 1, { lane, level: "ground" }, i, currentKey, 0);
        }
        // Lane changes: the destination must stay passable for the whole manoeuvre,
        // and the source lane must stay passable for its first half.
        for (const target of [lane - 1, lane + 1] as Lane[]) {
          if (target < -1 || target > 1) continue;
          const landing = i + changeSamples;
          if (landing > sampleCount) continue;
          // Hopping across to another roof needs full height: not from the low end of a ramp.
          const canReachRoof = level === "roof" && (!here.ramp || here.rampFraction > RAMP_HOP_FRACTION);
          const levelsToTry: Level[] = level === "roof" ? (canReachRoof ? ["roof", "ground"] : ["ground"]) : ["ground"];
          for (const targetLevel of levelsToTry) {
            let ok = true;
            for (let s = i + 1; s <= landing && ok; s++) {
              if (!standable(s, target, targetLevel)) ok = false;
              if (targetLevel === "ground" && cellAt(s, target).barrierZone) ok = false;
              if (s <= i + Math.ceil(changeSamples / 2) && !standable(s, lane, level)) ok = false;
            }
            if (ok) mark(landing, { lane: target, level: targetLevel }, i, currentKey, 1);
          }
        }
      }
    }
    return { cost, parent, sampleCount };
  }

  private static rasterize(
    blocks: readonly LayoutBlock[],
    reservations: readonly LaneReservation[],
    fromZ: number,
    sampleCount: number,
    reactionDistance: number,
  ): LaneCell[][] {
    const cells: LaneCell[][] = [];
    for (let i = 0; i <= sampleCount; i++) {
      const z = fromZ + i * SAMPLE_STEP;
      const row: LaneCell[] = [];
      for (const lane of LANES) {
        const cell: LaneCell = { groundOk: true, roofOk: false, ramp: false, rampFraction: 0, barrierZone: false };
        for (const reservation of reservations) {
          if (reservation.lane === lane && z >= reservation.from && z <= reservation.to) cell.groundOk = false;
        }
        for (const block of blocks) {
          if (block.lane !== lane) continue;
          const start = block.z;
          const end = block.z + block.length;
          if (block.kind === "ramp") {
            // Ramps can only be mounted head-on; once on one the runner is at "roof" level.
            if (z >= start && z <= end) {
              cell.ramp = true;
              cell.rampFraction = (z - start) / block.length;
              cell.groundOk = false;
              cell.roofOk = true;
            }
          } else if (block.kind === "train" || block.kind === "movingTrain") {
            if (z >= start - FRONT_MARGIN && z <= end + BACK_MARGIN) cell.groundOk = false;
            if (z >= start && z <= end) cell.roofOk = true;
          } else if (block.kind === "block") {
            if (z >= start - FRONT_MARGIN && z <= end + BACK_MARGIN) cell.groundOk = false;
          }
          // Low/high barriers are passable by jumping/rolling, but switching into a lane
          // right before one would demand a frame-perfect combo, so that is disallowed.
          else if ((block.kind === "barrierLow" || block.kind === "barrierHigh") && z >= start - reactionDistance && z <= end + 0.5) {
            cell.barrierZone = true;
          }
        }
        row.push(cell);
      }
      cells.push(row);
    }
    return cells;
  }
}
