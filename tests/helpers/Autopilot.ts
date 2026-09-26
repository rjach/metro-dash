import { laneToX, type Lane } from "../../src/core/config";
import type { GameAction } from "../../src/game/actions";
import type { GameSession } from "../../src/game/GameSession";
import { LayoutValidator, type LaneReservation, type LayoutBlock, type Level } from "../../src/game/LayoutValidator";

const PLAN_HORIZON = 110;
const LANE_CHANGE_TRIGGER = 1.2;

/**
 * Soak-test bot. It re-plans a survivable route with the same reachability
 * model the generator uses, then executes it through ordinary GameActions,
 * so it exercises the real physics, collisions and input handling.
 */
export class Autopilot {
  private cooldown = 0;
  planFailures = 0;

  constructor(private readonly session: GameSession) {}

  decide(dt: number): GameAction | null {
    this.cooldown -= dt;
    const session = this.session;
    const player = session.player;
    if (player.flying || player.crashed) return null;

    const barrierAction = this.barrierAction();
    if (barrierAction) return barrierAction;
    if (this.cooldown > 0 || player.changingLanes) return null;

    const level: Level = player.groundY > 0.05 ? "roof" : "ground";
    const { blocks, reservations } = this.snapshot();
    const path = LayoutValidator.plan(blocks, reservations, { lane: player.lane, level }, player.z, player.z + PLAN_HORIZON, session.speed);
    if (!path) {
      this.planFailures++;
      return null;
    }
    const change = path.find((waypoint) => waypoint.lane !== player.lane);
    if (!change || change.z - player.z > LANE_CHANGE_TRIGGER) return null;
    // A barrier right after the lane change leaves no time to react: act before switching.
    const prep = this.barrierInLane(change.lane, session.speed * 0.2 + 2.5);
    if (prep === "barrierLow" && player.grounded) return "jump";
    if (prep === "barrierHigh" && !player.rolling && player.grounded) return "roll";
    this.cooldown = 0.12;
    return change.lane < player.lane ? "left" : "right";
  }

  private barrierInLane(lane: Lane, within: number): "barrierLow" | "barrierHigh" | null {
    const x = laneToX(lane);
    const z = this.session.player.z;
    for (const obstacle of this.session.obstacles) {
      if (Math.abs(obstacle.x - x) > 0.1 || (obstacle.kind !== "barrierLow" && obstacle.kind !== "barrierHigh")) continue;
      const distance = obstacle.z - z;
      if (distance >= 0 && distance < within) return obstacle.kind;
    }
    return null;
  }

  private barrierAction(): GameAction | null {
    const session = this.session;
    const player = session.player;
    const x = laneToX(player.lane);
    for (const obstacle of session.obstacles) {
      if (Math.abs(obstacle.x - x) > 0.1) continue;
      const distance = obstacle.z - player.z;
      if (distance < 0 || distance > 12) continue;
      if (obstacle.kind === "barrierLow" && distance < session.speed * 0.13 + 1) {
        // Grounded: jump now. Falling: press early and rely on the engine's jump buffer.
        if (player.grounded && player.y < 0.1) return "jump";
        const timeToLand = (player.y - player.groundY) / Math.max(1, -player.vy);
        if (!player.grounded && player.vy < 0 && timeToLand < 0.12 && this.cooldown <= 0) {
          this.cooldown = 0.1;
          return "jump";
        }
      }
      if (obstacle.kind === "barrierHigh" && distance < session.speed * 0.12 + 1.2 && !player.rolling) {
        return "roll";
      }
    }
    return null;
  }

  private snapshot(): { blocks: LayoutBlock[]; reservations: LaneReservation[] } {
    const session = this.session;
    const pz = session.player.z;
    const speed = session.speed;
    const blocks: LayoutBlock[] = [];
    const reservations: LaneReservation[] = [];
    for (const obstacle of session.obstacles) {
      if (obstacle.z + obstacle.length < pz - 2) continue;
      if (obstacle.speed === 0) {
        if (obstacle.z < pz + PLAN_HORIZON) blocks.push(obstacle);
        continue;
      }
      // Oncoming train: project into the runner's frame using the closing speed.
      const ratio = speed / (speed + obstacle.speed);
      const front = obstacle.z > pz ? pz + (obstacle.z - pz) * ratio : pz;
      const back = pz + Math.max(0, obstacle.z + obstacle.length - pz) * ratio;
      reservations.push({ lane: obstacle.lane as Lane, from: front - 1.5, to: back + 1 });
    }
    return { blocks, reservations };
  }
}
