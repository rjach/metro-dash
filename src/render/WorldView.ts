import * as THREE from "three";
import type { Collectible, CollectibleKind, Obstacle } from "../game/types";
import { buildPickup, coinMaterials, createCoinGeometry } from "./CollectibleMeshes";
import { WORLD } from "../core/config";
import { buildObstacle, obstacleKey } from "./ObstacleMeshes";
import { TRAIN_LIVERIES } from "./ObstacleMeshes";

const MAX_COINS = 600;
const COIN_SPIN_SPEED = 3.2;
const PICKUP_BOB_HEIGHT = 0.18;

type PickupKind = Exclude<CollectibleKind, "coin">;

/** Every distinct obstacle look the generator can produce. */
const ALL_OBSTACLE_LOOKS: Pick<Obstacle, "kind" | "length" | "variant">[] = [
  ...(["train", "movingTrain"] as const).flatMap((kind) =>
    [1, 2, 3].flatMap((cars) => TRAIN_LIVERIES.map((_, variant) => ({ kind, length: cars * WORLD.trainCarLength, variant }))),
  ),
  { kind: "ramp", length: WORLD.rampLength, variant: 0 },
  { kind: "block", length: WORLD.blockDepth, variant: 0 },
  ...[0, 1].flatMap((variant) => [
    { kind: "barrierLow" as const, length: WORLD.lowBarrierDepth, variant },
    { kind: "barrierHigh" as const, length: WORLD.highBarrierDepth, variant },
  ]),
];

/**
 * Mirrors the simulation's entities into the scene. Obstacle and pickup meshes
 * are pooled by visual key; every coin is drawn by a single InstancedMesh.
 */
export class WorldView {
  readonly root = new THREE.Group();
  private readonly obstacleViews = new Map<number, { key: string; object: THREE.Object3D }>();
  private readonly obstaclePools = new Map<string, THREE.Object3D[]>();
  /** One built mesh per visual key; pool growth clones it, sharing geometry and materials. */
  private readonly obstacleTemplates = new Map<string, THREE.Object3D>();
  private readonly pickupTemplates = new Map<PickupKind, THREE.Group>();
  private readonly pickupViews = new Map<number, { kind: PickupKind; object: THREE.Group }>();
  private readonly pickupPools = new Map<PickupKind, THREE.Group[]>();
  private readonly seen = new Set<number>();
  private readonly coins: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly quaternion = new THREE.Quaternion();
  private readonly position = new THREE.Vector3();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private readonly spinAxis = new THREE.Vector3(0, 1, 0);

  constructor() {
    this.coins = new THREE.InstancedMesh(createCoinGeometry(), coinMaterials(), MAX_COINS);
    this.coins.frustumCulled = false;
    this.coins.count = 0;
    this.root.add(this.coins);
  }

  /**
   * Builds every obstacle and pickup template up front (and puts one of each in
   * the scene, hidden) so geometry upload and shader compilation never happen
   * mid-run when a rare obstacle first appears.
   */
  prewarm(): void {
    const kinds: PickupKind[] = ["magnet", "jetpack", "sneakers", "multiplier", "mysteryBox", "key"];
    for (const kind of kinds) this.releasePickup(kind, this.acquirePickup(kind));
    for (const spec of ALL_OBSTACLE_LOOKS) {
      const key = obstacleKey(spec.kind, spec.length, spec.variant);
      if (this.obstacleTemplates.has(key)) continue;
      this.releaseObstacle(key, this.acquireObstacle(key, { ...spec, id: -1, lane: 0, x: 0, z: 0, width: 0, bottom: 0, top: 0, speed: 0, walkable: false }));
    }
  }

  sync(obstacles: readonly Obstacle[], collectibles: readonly Collectible[], playerZ: number, time: number, camera: THREE.Camera): void {
    this.syncObstacles(obstacles, playerZ);
    this.syncCollectibles(collectibles, playerZ, time, camera);
  }

  reset(): void {
    for (const [id, view] of this.obstacleViews) {
      this.releaseObstacle(view.key, view.object);
      this.obstacleViews.delete(id);
    }
    for (const [id, view] of this.pickupViews) {
      this.releasePickup(view.kind, view.object);
      this.pickupViews.delete(id);
    }
    this.coins.count = 0;
  }

  private syncObstacles(obstacles: readonly Obstacle[], playerZ: number): void {
    this.seen.clear();
    for (const obstacle of obstacles) {
      this.seen.add(obstacle.id);
      let view = this.obstacleViews.get(obstacle.id);
      if (!view) {
        const key = obstacleKey(obstacle.kind, obstacle.length, obstacle.variant);
        view = { key, object: this.acquireObstacle(key, obstacle) };
        this.obstacleViews.set(obstacle.id, view);
      }
      view.object.position.set(obstacle.x, 0, -(obstacle.z - playerZ));
    }
    for (const [id, view] of this.obstacleViews) {
      if (this.seen.has(id)) continue;
      this.releaseObstacle(view.key, view.object);
      this.obstacleViews.delete(id);
    }
  }

  private syncCollectibles(collectibles: readonly Collectible[], playerZ: number, time: number, camera: THREE.Camera): void {
    this.seen.clear();
    let coinCount = 0;
    this.quaternion.setFromAxisAngle(this.spinAxis, time * COIN_SPIN_SPEED);
    for (const item of collectibles) {
      if (item.collected) continue;
      const z = -(item.z - playerZ);
      if (item.kind === "coin") {
        if (coinCount >= MAX_COINS) continue;
        this.position.set(item.x, item.y, z);
        this.matrix.compose(this.position, this.quaternion, this.scale);
        this.coins.setMatrixAt(coinCount++, this.matrix);
        continue;
      }
      this.seen.add(item.id);
      let view = this.pickupViews.get(item.id);
      if (!view) {
        view = { kind: item.kind, object: this.acquirePickup(item.kind) };
        this.pickupViews.set(item.id, view);
      }
      const bob = Math.sin(time * 3 + item.id) * PICKUP_BOB_HEIGHT;
      view.object.position.set(item.x, item.y + bob, z);
      const icon = view.object.getObjectByName("icon");
      if (icon) icon.rotation.y = time * 2.2;
      const halo = view.object.getObjectByName("halo");
      if (halo) halo.quaternion.copy(camera.quaternion);
    }
    this.coins.count = coinCount;
    this.coins.instanceMatrix.needsUpdate = true;
    for (const [id, view] of this.pickupViews) {
      if (this.seen.has(id)) continue;
      this.releasePickup(view.kind, view.object);
      this.pickupViews.delete(id);
    }
  }

  private acquireObstacle(key: string, obstacle: Obstacle): THREE.Object3D {
    const pooled = this.obstaclePools.get(key)?.pop();
    if (pooled) {
      pooled.visible = true;
      return pooled;
    }
    let template = this.obstacleTemplates.get(key);
    if (!template) {
      template = buildObstacle(obstacle.kind, obstacle.length, obstacle.variant);
      this.obstacleTemplates.set(key, template);
    }
    const object = template.clone();
    this.root.add(object);
    return object;
  }

  private releaseObstacle(key: string, object: THREE.Object3D): void {
    object.visible = false;
    let pool = this.obstaclePools.get(key);
    if (!pool) {
      pool = [];
      this.obstaclePools.set(key, pool);
    }
    pool.push(object);
  }

  private acquirePickup(kind: PickupKind): THREE.Group {
    const pooled = this.pickupPools.get(kind)?.pop();
    if (pooled) {
      pooled.visible = true;
      return pooled;
    }
    let template = this.pickupTemplates.get(kind);
    if (!template) {
      template = buildPickup(kind);
      this.pickupTemplates.set(kind, template);
    }
    const object = template.clone();
    this.root.add(object);
    return object;
  }

  private releasePickup(kind: PickupKind, object: THREE.Group): void {
    object.visible = false;
    let pool = this.pickupPools.get(kind);
    if (!pool) {
      pool = [];
      this.pickupPools.set(kind, pool);
    }
    pool.push(object);
  }
}
