import { PLAYER, WORLD } from "../core/config";
import type { Player } from "./Player";
import type { Collectible, CrashCause, Obstacle } from "./types";

export type HitResult =
  | { type: "none" }
  | { type: "stumble"; obstacle: Obstacle }
  | { type: "crash"; obstacle: Obstacle; cause: CrashCause }
  | { type: "stepUp"; obstacle: Obstacle };

/** Only obstacles within this z-window of the runner are tested each step. */
const BROAD_PHASE_BEHIND = 40;
const BROAD_PHASE_AHEAD = 6;
/** How far off-centre (m) a mid-lane-change clip must be to count as a side swipe rather than a head-on crash. */
const GRAZE_OVERLAP = 0.7;

const crashCauseFor = (obstacle: Obstacle): CrashCause => {
  switch (obstacle.kind) {
    case "movingTrain":
      return "movingTrain";
    case "train":
    case "ramp":
      return "train";
    case "block":
      return "block";
    default:
      return "barrier";
  }
};

/** Surface height of a walkable obstacle at a given z (ramps slope, roofs are flat). */
export const surfaceHeightAt = (obstacle: Obstacle, z: number): number => {
  if (obstacle.kind !== "ramp") return obstacle.top;
  const t = (z - obstacle.z) / obstacle.length;
  return obstacle.top * Math.min(1, Math.max(0, t));
};

const overlaps1D = (aMin: number, aMax: number, bMin: number, bMax: number) => aMin < bMax && aMax > bMin;

const inBroadPhase = (obstacle: Obstacle, playerZ: number) =>
  obstacle.z < playerZ + BROAD_PHASE_AHEAD && obstacle.z + obstacle.length > playerZ - BROAD_PHASE_BEHIND;

/**
 * Stateless collision queries between the runner and the world. The session
 * decides what a hit means (hoverboard save, invulnerability, game over).
 */
export class CollisionSystem {
  /** Highest walkable surface under the runner that it can stand on from its current height. */
  groundHeight(player: Player, obstacles: readonly Obstacle[]): number {
    let ground = 0;
    for (const obstacle of obstacles) {
      if (!obstacle.walkable || !inBroadPhase(obstacle, player.z)) continue;
      if (Math.abs(player.x - obstacle.x) > obstacle.width / 2) continue;
      if (player.z < obstacle.z || player.z > obstacle.z + obstacle.length) continue;
      const surface = surfaceHeightAt(obstacle, player.z);
      if (surface <= player.y + PLAYER.stepUpTolerance && surface > ground) ground = surface;
    }
    return ground;
  }

  /**
   * Tests the runner against solid obstacles after this step's movement.
   *
   * @param previousPlayerZ - Runner z before this step (distinguishes head-on vs side hits)
   * @param dt - Step length, used to rewind moving obstacles
   */
  detectHit(player: Player, obstacles: readonly Obstacle[], previousPlayerZ: number, dt: number): HitResult {
    const halfW = PLAYER.halfWidth;
    const halfD = PLAYER.halfDepth;
    const feet = player.y;
    const head = player.y + player.height;

    for (const obstacle of obstacles) {
      if (!inBroadPhase(obstacle, player.z)) continue;
      const minX = obstacle.x - obstacle.width / 2;
      const maxX = obstacle.x + obstacle.width / 2;
      if (!overlaps1D(player.x - halfW, player.x + halfW, minX, maxX)) continue;
      if (!overlaps1D(player.z - halfD, player.z + halfD, obstacle.z, obstacle.z + obstacle.length)) continue;

      let top = obstacle.top;
      if (obstacle.kind === "ramp") {
        top = surfaceHeightAt(obstacle, player.z);
        // Ramps are only solid when entered from the side below their surface.
        if (feet >= top - PLAYER.stepUpTolerance) continue;
      } else if (obstacle.walkable && feet >= top - 0.02) {
        continue;
      }
      if (!overlaps1D(feet, head, obstacle.bottom, top)) continue;

      const previousObstacleZ = obstacle.z + obstacle.speed * dt;
      const wasOverlappingZ = overlaps1D(previousPlayerZ - halfD, previousPlayerZ + halfD, previousObstacleZ, previousObstacleZ + obstacle.length);
      if (wasOverlappingZ) return { type: "stumble", obstacle };

      if (obstacle.walkable && feet >= top - PLAYER.stepUpTolerance) return { type: "stepUp", obstacle };

      const xOverlap = Math.min(player.x + halfW, maxX) - Math.max(player.x - halfW, minX);
      if (player.changingLanes && xOverlap < GRAZE_OVERLAP) return { type: "stumble", obstacle };

      return { type: "crash", obstacle, cause: crashCauseFor(obstacle) };
    }
    return { type: "none" };
  }

  /** While invulnerable the runner may end up inside a train; lift it onto the roof instead of clipping. */
  embeddedRoof(player: Player, obstacles: readonly Obstacle[]): number | null {
    for (const obstacle of obstacles) {
      if (!obstacle.walkable || obstacle.kind === "ramp" || !inBroadPhase(obstacle, player.z)) continue;
      if (Math.abs(player.x - obstacle.x) > obstacle.width / 2) continue;
      if (player.z < obstacle.z || player.z > obstacle.z + obstacle.length) continue;
      if (player.y < obstacle.top && player.y + player.height > obstacle.bottom) return obstacle.top;
    }
    return null;
  }

  collects(player: Player, item: Collectible): boolean {
    const centerY = player.y + player.height / 2;
    const radius = item.kind === "coin" ? WORLD.coinPickupRadius : WORLD.powerUpPickupRadius;
    const dx = item.x - player.x;
    const dy = item.y - centerY;
    const dz = item.z - player.z;
    // Taller vertical reach so coins are collected across the whole body, not just its centre.
    return dx * dx + dz * dz < radius * radius * 1.4 && Math.abs(dy) < radius + player.height / 2;
  }
}
