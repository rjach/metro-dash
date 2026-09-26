import { laneToX, WORLD, type Lane } from "../core/config";
import { Pool } from "../core/Pool";
import type { Collectible, CollectibleKind, Obstacle, ObstacleKind } from "./types";

export interface ObstacleSpec {
  kind: ObstacleKind;
  lane: Lane;
  z: number;
  length?: number;
  speed?: number;
  variant?: number;
}

const OBSTACLE_SHAPES: Record<ObstacleKind, { width: number; bottom: number; top: number; length: number; walkable: boolean }> = {
  train: { width: WORLD.trainWidth, bottom: 0, top: WORLD.trainHeight, length: WORLD.trainCarLength, walkable: true },
  movingTrain: { width: WORLD.trainWidth, bottom: 0, top: WORLD.trainHeight, length: WORLD.trainCarLength, walkable: true },
  ramp: { width: WORLD.trainWidth, bottom: 0, top: WORLD.trainHeight, length: WORLD.rampLength, walkable: true },
  barrierLow: { width: WORLD.barrierWidth, bottom: 0, top: WORLD.lowBarrierHeight, length: WORLD.lowBarrierDepth, walkable: false },
  barrierHigh: { width: WORLD.barrierWidth, bottom: WORLD.highBarrierBottom, top: WORLD.highBarrierTop, length: WORLD.highBarrierDepth, walkable: false },
  block: { width: WORLD.barrierWidth, bottom: 0, top: WORLD.blockHeight, length: WORLD.blockDepth, walkable: false },
};

/**
 * Container for every live gameplay entity. Entities are recycled through pools
 * and kept sorted-by-insertion (which is roughly by z because the generator
 * only ever appends ahead of the player).
 */
export class World {
  readonly obstacles: Obstacle[] = [];
  readonly collectibles: Collectible[] = [];
  private nextId = 1;

  private readonly obstaclePool = new Pool<Obstacle>(
    () => ({ id: 0, kind: "train", lane: 0, x: 0, z: 0, length: 0, width: 0, bottom: 0, top: 0, speed: 0, variant: 0, walkable: false }),
    undefined,
    64,
  );

  private readonly collectiblePool = new Pool<Collectible>(
    () => ({ id: 0, kind: "coin", x: 0, y: 0, z: 0, collected: false, attracted: false }),
    undefined,
    256,
  );

  addObstacle(spec: ObstacleSpec): Obstacle {
    const shape = OBSTACLE_SHAPES[spec.kind];
    const obstacle = this.obstaclePool.acquire();
    obstacle.id = this.nextId++;
    obstacle.kind = spec.kind;
    obstacle.lane = spec.lane;
    obstacle.x = laneToX(spec.lane);
    obstacle.z = spec.z;
    obstacle.length = spec.length ?? shape.length;
    obstacle.width = shape.width;
    obstacle.bottom = shape.bottom;
    obstacle.top = shape.top;
    obstacle.speed = spec.speed ?? 0;
    obstacle.variant = spec.variant ?? 0;
    obstacle.walkable = shape.walkable;
    this.obstacles.push(obstacle);
    return obstacle;
  }

  addCollectible(kind: CollectibleKind, x: number, y: number, z: number): Collectible {
    const item = this.collectiblePool.acquire();
    item.id = this.nextId++;
    item.kind = kind;
    item.x = x;
    item.y = y;
    item.z = z;
    item.collected = false;
    item.attracted = false;
    this.collectibles.push(item);
    return item;
  }

  /** Advances moving obstacles (oncoming trains). */
  step(dt: number): void {
    for (const obstacle of this.obstacles) {
      if (obstacle.speed !== 0) obstacle.z -= obstacle.speed * dt;
    }
  }

  /** Recycles entities that are behind the player. */
  despawnBehind(playerZ: number): void {
    const limit = playerZ - WORLD.despawnBehind;
    this.compact(
      this.obstacles,
      (o) => o.z + o.length < limit,
      (o) => this.obstaclePool.release(o),
    );
    this.compact(
      this.collectibles,
      (c) => c.collected || c.z < limit,
      (c) => this.collectiblePool.release(c),
    );
  }

  /** Removes everything inside a z-window (used to clear space after a revive). */
  clearRange(fromZ: number, toZ: number): void {
    this.compact(
      this.obstacles,
      (o) => o.z < toZ && o.z + o.length > fromZ,
      (o) => this.obstaclePool.release(o),
    );
    // Oncoming trains further ahead would still arrive inside the cleared window.
    this.compact(
      this.obstacles,
      (o) => o.speed > 0 && o.z < toZ + 120,
      (o) => this.obstaclePool.release(o),
    );
  }

  clear(): void {
    this.compact(
      this.obstacles,
      () => true,
      (o) => this.obstaclePool.release(o),
    );
    this.compact(
      this.collectibles,
      () => true,
      (c) => this.collectiblePool.release(c),
    );
  }

  get poolStats(): { obstaclesCreated: number; collectiblesCreated: number } {
    return { obstaclesCreated: this.obstaclePool.totalCreated, collectiblesCreated: this.collectiblePool.totalCreated };
  }

  /** In-place filter that hands removed items to a recycler without allocating a new array. */
  private compact<T>(list: T[], shouldRemove: (item: T) => boolean, recycle: (item: T) => void): void {
    let write = 0;
    for (let read = 0; read < list.length; read++) {
      const item = list[read]!;
      if (shouldRemove(item)) recycle(item);
      else list[write++] = item;
    }
    list.length = write;
  }
}
