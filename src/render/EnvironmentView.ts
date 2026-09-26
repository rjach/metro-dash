import * as THREE from "three";
import { LANE_WIDTH } from "../core/config";
import { Random } from "../core/math";
import { additive, emissive, lambert, phong } from "./materials";
import { mergeByMaterial, worldScaleBoxUVs } from "./merge";
import { buildingTexture, glowTexture, graffitiWallTexture, gravelTexture, sleeperTexture } from "./textures";

export const CHUNK_LENGTH = 30;
const CHUNKS_AHEAD = 9;
const MAX_CHUNKS_BEHIND = 7;
const SLEEPER_SPACING = 1.1;
const TRACK_HALF_WIDTH = LANE_WIDTH * 1.5 + 1.2;
const WALL_X = TRACK_HALF_WIDTH + 0.6;
const TUNNEL_PERIOD = 44;
const TUNNEL_LENGTH = 4;

export type ChunkTheme = "city" | "overpass" | "tunnel" | "tunnelEntry";

/** Deterministic theme sequence so the same run always looks the same at the same distance. */
export const themeForChunk = (index: number): ChunkTheme => {
  if (index < 3) return "city";
  const inCycle = index % TUNNEL_PERIOD;
  if (inCycle === TUNNEL_PERIOD - TUNNEL_LENGTH - 1) return "tunnelEntry";
  if (inCycle >= TUNNEL_PERIOD - TUNNEL_LENGTH) return "tunnel";
  return index % 9 === 4 ? "overpass" : "city";
};

interface Chunk {
  group: THREE.Group;
  theme: ChunkTheme;
  index: number;
}

const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/**
 * Streams the scenery around the track: gravel bed, three rail tracks,
 * graffiti walls, buildings, bridges and tunnels. Chunks are merged per
 * material, prebuilt at boot, pooled per theme and repositioned as the runner
 * advances, so scenery costs a handful of draw calls and no allocation.
 */
export class EnvironmentView {
  readonly root = new THREE.Group();
  private readonly active = new Map<number, Chunk>();
  private readonly pools = new Map<ChunkTheme, Chunk[]>();
  private readonly sleeperGeometry = box(LANE_WIDTH * 0.72, 0.12, 0.34);
  private readonly railGeometry: THREE.BufferGeometry;
  private detail = 1;
  private tunnelFactor = 0;
  /** The menu camera looks back down the line, so it needs scenery behind the runner. */
  private chunksBehind = 1;

  constructor() {
    const rail = box(0.1, 0.14, CHUNK_LENGTH);
    rail.translate(0, 0.12, -CHUNK_LENGTH / 2);
    this.railGeometry = rail;
  }

  setDetail(level: number): void {
    this.detail = level;
  }

  setChunksBehind(count: number): void {
    this.chunksBehind = count;
  }

  /** Pre-builds the scenery pools so no chunk is ever built mid-run. */
  prewarm(): void {
    const needed: Record<ChunkTheme, number> = {
      city: CHUNKS_AHEAD + MAX_CHUNKS_BEHIND + 2,
      overpass: 3,
      tunnel: TUNNEL_LENGTH + 1,
      tunnelEntry: 1,
    };
    for (const theme of Object.keys(needed) as ChunkTheme[]) {
      const pool = this.pool(theme);
      while (pool.length < needed[theme]) {
        const index = -1000 - pool.length;
        const group = this.build(theme, index);
        group.visible = false;
        this.root.add(group);
        pool.push({ group, theme, index });
      }
    }
  }

  /** 0 in open air, 1 deep inside a tunnel (used to dim lighting). */
  get tunnelAmount(): number {
    return this.tunnelFactor;
  }

  update(playerZ: number): void {
    const current = Math.floor(playerZ / CHUNK_LENGTH);
    const first = current - this.chunksBehind;
    const last = current + CHUNKS_AHEAD;
    for (const [index, chunk] of this.active) {
      if (index < first || index > last) {
        chunk.group.visible = false;
        this.pool(chunk.theme).push(chunk);
        this.active.delete(index);
      }
    }
    for (let index = first; index <= last; index++) {
      let chunk = this.active.get(index);
      if (!chunk) {
        chunk = this.acquire(themeForChunk(index), index);
        this.active.set(index, chunk);
      }
      chunk.group.position.z = -(index * CHUNK_LENGTH - playerZ);
    }
    const cameraChunk = Math.floor((playerZ - 6) / CHUNK_LENGTH);
    const target = themeForChunk(cameraChunk) === "tunnel" ? 1 : 0;
    this.tunnelFactor += (target - this.tunnelFactor) * 0.06;
  }

  reset(): void {
    for (const chunk of this.active.values()) {
      chunk.group.visible = false;
      this.pool(chunk.theme).push(chunk);
    }
    this.active.clear();
    this.tunnelFactor = 0;
  }

  private pool(theme: ChunkTheme): Chunk[] {
    let pool = this.pools.get(theme);
    if (!pool) {
      pool = [];
      this.pools.set(theme, pool);
    }
    return pool;
  }

  private acquire(theme: ChunkTheme, index: number): Chunk {
    const pooled = this.pool(theme).pop();
    if (pooled) {
      pooled.group.visible = true;
      pooled.index = index;
      return pooled;
    }
    const group = this.build(theme, index);
    this.root.add(group);
    return { group, theme, index };
  }

  private build(theme: ChunkTheme, index: number): THREE.Group {
    const rng = new Random(index * 7919 + 17);
    const group = new THREE.Group();
    group.add(this.buildTrackBed());
    switch (theme) {
      case "tunnel":
        this.addTunnel(group);
        break;
      case "tunnelEntry":
        this.addCitySides(group, rng, false);
        this.addTunnelMouth(group);
        break;
      case "overpass":
        this.addCitySides(group, rng, true);
        this.addOverpass(group, rng);
        break;
      default:
        this.addCitySides(group, rng, true);
    }
    return mergeByMaterial(group);
  }

  private buildTrackBed(): THREE.Group {
    const bed = new THREE.Group();
    const groundGeometry = new THREE.PlaneGeometry(TRACK_HALF_WIDTH * 2 + 2, CHUNK_LENGTH);
    const groundUV = groundGeometry.attributes.uv as THREE.BufferAttribute;
    for (let i = 0; i < groundUV.count; i++) groundUV.setXY(i, groundUV.getX(i) * 4, groundUV.getY(i) * (CHUNK_LENGTH / 8));
    const ground = new THREE.Mesh(groundGeometry, lambert("#ffffff", gravelTexture(), "ground"));
    ground.rotation.x = -Math.PI / 2;
    ground.position.set(0, 0, -CHUNK_LENGTH / 2);
    bed.add(ground);

    const perLane = Math.floor(CHUNK_LENGTH / SLEEPER_SPACING);
    const sleepers = new THREE.InstancedMesh(this.sleeperGeometry, lambert("#ffffff", sleeperTexture(), "sleeper"), perLane * 3);
    const matrix = new THREE.Matrix4();
    let n = 0;
    for (let lane = -1; lane <= 1; lane++) {
      for (let i = 0; i < perLane; i++) {
        matrix.makeTranslation(lane * LANE_WIDTH, 0.04, -i * SLEEPER_SPACING - 0.4);
        sleepers.setMatrixAt(n++, matrix);
      }
    }
    sleepers.instanceMatrix.needsUpdate = true;
    sleepers.frustumCulled = false;
    bed.add(sleepers);

    const railMaterial = phong("#c8ccd2", 90);
    for (let lane = -1; lane <= 1; lane++) {
      for (const side of [-0.55, 0.55]) {
        const rail = new THREE.Mesh(this.railGeometry, railMaterial);
        rail.position.x = lane * LANE_WIDTH + side;
        bed.add(rail);
      }
    }
    // Darker gravel strips between tracks give the lanes definition from a distance.
    for (const x of [-LANE_WIDTH / 2, LANE_WIDTH / 2]) {
      const strip = new THREE.Mesh(new THREE.PlaneGeometry(0.35, CHUNK_LENGTH), lambert("#6e5a45"));
      strip.rotation.x = -Math.PI / 2;
      strip.position.set(x, 0.01, -CHUNK_LENGTH / 2);
      bed.add(strip);
    }
    return bed;
  }

  private addCitySides(group: THREE.Group, rng: Random, withBuildings: boolean): void {
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(worldScaleBoxUVs(box(0.5, 2.6, CHUNK_LENGTH), 6, 2.6), lambert("#ffffff", graffitiWallTexture(rng.int(0, 3))));
      wall.position.set(side * WALL_X, 1.3, -CHUNK_LENGTH / 2);
      group.add(wall);
      const cap = new THREE.Mesh(box(0.7, 0.18, CHUNK_LENGTH), lambert("#8d8d8d"));
      cap.position.set(side * WALL_X, 2.65, -CHUNK_LENGTH / 2);
      group.add(cap);

      const verge = new THREE.Mesh(new THREE.PlaneGeometry(40, CHUNK_LENGTH), lambert("#7fb069"));
      verge.rotation.x = -Math.PI / 2;
      verge.position.set(side * (WALL_X + 20), -0.02, -CHUNK_LENGTH / 2);
      group.add(verge);

      if (withBuildings) this.addBuildings(group, side, rng);

      for (let z = -rng.range(3, 8); z > -CHUNK_LENGTH; z -= 15) {
        const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.1, 5.4, 6), lambert("#3d4450"));
        pole.position.set(side * (WALL_X - 0.5), 2.7, z);
        group.add(pole);
        const arm = new THREE.Mesh(box(1.1, 0.1, 0.12), lambert("#3d4450"));
        arm.position.set(side * (WALL_X - 1.0), 5.3, z);
        group.add(arm);
        const lamp = new THREE.Mesh(box(0.45, 0.14, 0.3), emissive("#fff3c4"));
        lamp.position.set(side * (WALL_X - 1.5), 5.2, z);
        group.add(lamp);
      }

      if (this.detail > 0 && rng.chance(0.6)) {
        for (let i = 0; i < 2; i++) {
          const x = side * (WALL_X + rng.range(1.5, 3.5));
          const z = -rng.range(2, CHUNK_LENGTH - 2);
          const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 2, 6), lambert("#7a5230"));
          trunk.position.set(x, 1, z);
          group.add(trunk);
          const shade = rng.pick(["#4caf50", "#66bb6a", "#2e7d32"]);
          // Two stacked, slightly smoothed crowns read rounder than one faceted blob.
          for (const [dy, radius] of [
            [2.6, rng.range(1.2, 1.6)],
            [3.5, rng.range(0.8, 1.1)],
          ] as const) {
            const crown = new THREE.Mesh(new THREE.IcosahedronGeometry(radius, 1), lambert(shade));
            crown.position.set(x, dy, z);
            group.add(crown);
          }
        }
      }
    }

    // Overhead catenary gantry every chunk for rhythm and a sense of speed.
    const gantryZ = -CHUNK_LENGTH / 2;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(box(0.25, 6.6, 0.25), lambert("#59606b"));
      post.position.set(side * (TRACK_HALF_WIDTH - 0.2), 3.3, gantryZ);
      group.add(post);
    }
    const beam = new THREE.Mesh(box(TRACK_HALF_WIDTH * 2, 0.25, 0.25), lambert("#59606b"));
    beam.position.set(0, 6.5, gantryZ);
    group.add(beam);
    const wireMaterial = lambert("#2b2b2b");
    for (let lane = -1; lane <= 1; lane++) {
      const wire = new THREE.Mesh(box(0.04, 0.04, CHUNK_LENGTH), wireMaterial);
      wire.position.set(lane * LANE_WIDTH, 6.1, -CHUNK_LENGTH / 2);
      group.add(wire);
    }
  }

  private addBuildings(group: THREE.Group, side: number, rng: Random): void {
    let z = -rng.range(0, 4);
    while (z > -CHUNK_LENGTH + 4) {
      const width = rng.range(6, 11);
      const height = rng.range(8, 22) * (this.detail > 0 ? 1 : 0.8);
      const depth = rng.range(6, 10);
      // One texture per facade style; UVs scale with the building so windows keep their size.
      const building = new THREE.Mesh(worldScaleBoxUVs(box(depth, height, width), 5.5, 9), lambert("#ffffff", buildingTexture(rng.int(0, 6))));
      building.position.set(side * (WALL_X + 4 + depth / 2 + rng.range(0, 6)), height / 2, z - width / 2);
      group.add(building);
      const roof = new THREE.Mesh(box(depth + 0.4, 0.5, width + 0.4), lambert("#5b5b66"));
      roof.position.set(building.position.x, height + 0.25, building.position.z);
      group.add(roof);
      if (rng.chance(0.4)) {
        const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 2, 10), lambert("#8b5e3c"));
        tank.position.set(building.position.x, height + 1.5, building.position.z + rng.range(-1, 1));
        group.add(tank);
      }
      if (this.detail > 0 && rng.chance(0.5)) {
        // Coloured shop awning at street level.
        const awning = new THREE.Mesh(box(1.2, 0.12, width * 0.7), lambert(rng.pick(["#e6392f", "#2f7de1", "#2bd46b", "#ff9f1c"])));
        awning.position.set(building.position.x - side * (depth / 2 + 0.6), 3.2, building.position.z);
        awning.rotation.z = side * 0.35;
        group.add(awning);
      }
      z -= width + rng.range(0.5, 3);
    }
  }

  private addOverpass(group: THREE.Group, rng: Random): void {
    const z = -rng.range(8, CHUNK_LENGTH - 8);
    const deck = new THREE.Mesh(box(TRACK_HALF_WIDTH * 2 + 14, 1.4, 5), lambert("#9aa3ad"));
    deck.position.set(0, 8.2, z);
    group.add(deck);
    const railing = new THREE.Mesh(box(TRACK_HALF_WIDTH * 2 + 14, 0.8, 0.2), lambert("#d64545"));
    railing.position.set(0, 9.3, z + 2.4);
    group.add(railing);
    for (const side of [-1, 1]) {
      const pillar = new THREE.Mesh(box(1.4, 8, 3.6), lambert("#b0b7bf"));
      pillar.position.set(side * (TRACK_HALF_WIDTH + 1.8), 4, z);
      group.add(pillar);
    }
    const sign = new THREE.Mesh(worldScaleBoxUVs(box(6, 1.4, 0.2), 6, 2.6), lambert("#ffffff", graffitiWallTexture(rng.int(0, 3))));
    sign.position.set(0, 8.2, z + 2.62);
    group.add(sign);
  }

  private addTunnel(group: THREE.Group): void {
    const wallMaterial = lambert("#6d6f78");
    for (const side of [-1, 1]) {
      const wall = new THREE.Mesh(box(0.8, 7, CHUNK_LENGTH), wallMaterial);
      wall.position.set(side * (WALL_X + 0.2), 3.5, -CHUNK_LENGTH / 2);
      group.add(wall);
      for (let z = -3; z > -CHUNK_LENGTH; z -= 7.5) {
        const light = new THREE.Mesh(box(0.1, 0.3, 1.6), emissive("#ffe9a8"));
        light.position.set(side * (WALL_X - 0.25), 4.8, z);
        group.add(light);
        const halo = new THREE.Mesh(new THREE.PlaneGeometry(3, 2), additive("#ffcf6b", glowTexture(), 0.45));
        halo.position.set(side * (WALL_X - 0.3), 4.8, z);
        halo.rotation.y = (-side * Math.PI) / 2;
        group.add(halo);
      }
      const pipe = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, CHUNK_LENGTH, 8), lambert("#a3572d"));
      pipe.rotation.x = Math.PI / 2;
      pipe.position.set(side * (WALL_X - 0.3), 2.2, -CHUNK_LENGTH / 2);
      group.add(pipe);
    }
    const ceiling = new THREE.Mesh(box(WALL_X * 2 + 1.5, 0.8, CHUNK_LENGTH), lambert("#55575f"));
    ceiling.position.set(0, 7.2, -CHUNK_LENGTH / 2);
    group.add(ceiling);
    for (let z = -2; z > -CHUNK_LENGTH; z -= 6) {
      const rib = new THREE.Mesh(box(WALL_X * 2 + 1.4, 0.5, 0.6), lambert("#474950"));
      rib.position.set(0, 6.6, z);
      group.add(rib);
    }
  }

  private addTunnelMouth(group: THREE.Group): void {
    const z = -CHUNK_LENGTH + 0.5;
    const facade = new THREE.Mesh(box(WALL_X * 2 + 16, 6, 1.4), lambert("#8a8f99"));
    facade.position.set(0, 10, z);
    group.add(facade);
    for (const side of [-1, 1]) {
      const cheek = new THREE.Mesh(box(8, 13, 1.4), lambert("#8a8f99"));
      cheek.position.set(side * (WALL_X + 4.6), 6.5, z);
      group.add(cheek);
    }
    const stripe = new THREE.Mesh(box(WALL_X * 2 + 1, 0.6, 1.5), lambert("#ffd23f"));
    stripe.position.set(0, 7.3, z);
    group.add(stripe);
  }
}
