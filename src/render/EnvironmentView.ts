import * as THREE from "three";
import { LANE_WIDTH } from "../core/config";
import { Random } from "../core/math";
import { emissive, MATERIALS, paint } from "./materials";
import { mergeByMaterial, worldScaleBoxUVs } from "./merge";
import { graffitiDecal, signTexture } from "./pbrTextures";

export const CHUNK_LENGTH = 30;
const CHUNKS_AHEAD = 9;
const TUNNEL_PERIOD = 44;
const TUNNEL_LENGTH = 4;
/** The menu view shows the most scenery behind the runner. */
const MAX_CHUNKS_BEHIND = 7;

/** Real-world track dimensions (metres). */
const GAUGE = 1.435;
const SLEEPER_SPACING = 0.65;
const RAIL_HEIGHT = 0.16;
const BALLAST_HALF_WIDTH = LANE_WIDTH * 1.5 + 1.1;
const WALL_X = 6.5;
const WALL_HEIGHT = 3.1;
const GROUND_Y = -0.3;
const STREET_X = WALL_X + 0.45;
const BUILDING_X = 10.5;

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

const graffitiMaterials = new Map<number, THREE.MeshStandardMaterial>();
const graffitiMaterial = (variant: number): THREE.MeshStandardMaterial => {
  let material = graffitiMaterials.get(variant);
  if (!material) {
    material = new THREE.MeshStandardMaterial({
      map: graffitiDecal(variant),
      transparent: true,
      roughness: 0.8,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -2,
    });
    graffitiMaterials.set(variant, material);
  }
  return material;
};

const signMaterials = new Map<string, THREE.MeshStandardMaterial>();
const signMaterial = (key: string, text: string, color: string, background: string, glow = 0): THREE.MeshStandardMaterial => {
  let material = signMaterials.get(key);
  if (!material) {
    const map = signTexture(key, text, color, background);
    material = new THREE.MeshStandardMaterial({ map, roughness: 0.5, ...(glow > 0 ? { emissive: "#ffffff", emissiveMap: map, emissiveIntensity: glow } : {}) });
    signMaterials.set(key, material);
  }
  return material;
};

/** Small helper that places primitives into a group (merged per material afterwards). */
class Kit {
  readonly group = new THREE.Group();

  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number, uvScale?: [number, number]): THREE.Mesh {
    const geometry = uvScale ? worldScaleBoxUVs(new THREE.BoxGeometry(w, h, d), uvScale[0], uvScale[1]) : new THREE.BoxGeometry(w, h, d);
    return this.add(geometry, material, x, y, z);
  }

  cylinder(
    rTop: number,
    rBottom: number,
    h: number,
    material: THREE.Material,
    x: number,
    y: number,
    z: number,
    segments = 10,
    rotation?: THREE.Euler,
  ): THREE.Mesh {
    return this.add(new THREE.CylinderGeometry(rTop, rBottom, h, segments), material, x, y, z, rotation);
  }

  /** Thin straight member between two points (wires, braces, stairs). */
  beam(from: THREE.Vector3, to: THREE.Vector3, radius: number, material: THREE.Material, segments = 5): THREE.Mesh {
    const length = from.distanceTo(to);
    const geometry = new THREE.CylinderGeometry(radius, radius, length, segments);
    geometry.translate(0, length / 2, 0);
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.copy(from);
    mesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), to.clone().sub(from).normalize());
    this.group.add(mesh);
    return mesh;
  }

  add(geometry: THREE.BufferGeometry, material: THREE.Material, x: number, y: number, z: number, rotation?: THREE.Euler): THREE.Mesh {
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(x, y, z);
    if (rotation) mesh.rotation.copy(rotation);
    this.group.add(mesh);
    return mesh;
  }
}

/** Flat-bottom rail cross-section (UIC-60-like proportions) extruded along −z. */
let railGeometryCache: THREE.BufferGeometry | null = null;
const railGeometry = (): THREE.BufferGeometry => {
  if (railGeometryCache) return railGeometryCache;
  const shape = new THREE.Shape();
  const foot = 0.075;
  const web = 0.009;
  const head = 0.036;
  shape.moveTo(-foot, 0);
  shape.lineTo(foot, 0);
  shape.lineTo(foot, 0.012);
  shape.lineTo(web, 0.035);
  shape.lineTo(web, 0.11);
  shape.lineTo(head, 0.118);
  shape.lineTo(head, RAIL_HEIGHT - 0.006);
  shape.quadraticCurveTo(head, RAIL_HEIGHT, head - 0.008, RAIL_HEIGHT);
  shape.lineTo(-head + 0.008, RAIL_HEIGHT);
  shape.quadraticCurveTo(-head, RAIL_HEIGHT, -head, RAIL_HEIGHT - 0.006);
  shape.lineTo(-head, 0.118);
  shape.lineTo(-web, 0.11);
  shape.lineTo(-web, 0.035);
  shape.lineTo(-foot, 0.012);
  shape.closePath();
  railGeometryCache = new THREE.ExtrudeGeometry(shape, { depth: CHUNK_LENGTH, bevelEnabled: false, curveSegments: 3 });
  railGeometryCache.translate(0, 0, -CHUNK_LENGTH);
  return railGeometryCache;
};

/**
 * Streams realistic railway scenery around the track: ballast bed, concrete
 * sleepers, profiled rails, retaining walls with graffiti, overhead catenary,
 * street lighting, brick and glass buildings, overpasses and tunnels. Chunks
 * are pooled per theme and repositioned as the runner advances.
 */
export class EnvironmentView {
  readonly root = new THREE.Group();
  private readonly active = new Map<number, Chunk>();
  private readonly pools = new Map<ChunkTheme, Chunk[]>();
  private readonly skyline = new THREE.Group();
  private detail = 1;
  private tunnelFactor = 0;
  private chunksBehind = 1;

  constructor() {
    this.buildSkyline();
    this.root.add(this.skyline);
  }

  setDetail(level: number): void {
    this.detail = level;
  }

  /**
   * Pre-builds the scenery pools so that the first tunnel or overpass never
   * builds several chunks (and uploads their geometry) in the middle of a run.
   */
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

  setChunksBehind(count: number): void {
    this.chunksBehind = count;
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
    this.skyline.visible = this.tunnelFactor < 0.95;
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
    const kit = new Kit();
    this.buildTrackBed(kit);
    switch (theme) {
      case "tunnel":
        this.buildTunnel(kit, rng);
        break;
      case "tunnelEntry":
        this.buildTrackside(kit, rng, false);
        this.buildTunnelPortal(kit);
        break;
      case "overpass":
        this.buildTrackside(kit, rng, true);
        this.buildOverpass(kit, rng);
        break;
      default:
        this.buildTrackside(kit, rng, true);
    }
    const merged = mergeByMaterial(kit.group);
    merged.add(this.buildSleepers());
    return merged;
  }

  // ─── Track ───────────────────────────────────────────────────────────────

  private buildTrackBed(kit: Kit): void {
    // Ballast bed: flat top with sloping shoulders down to the cess walkways.
    const shape = new THREE.Shape();
    shape.moveTo(-BALLAST_HALF_WIDTH - 0.8, GROUND_Y);
    shape.lineTo(-BALLAST_HALF_WIDTH, -0.1);
    shape.lineTo(BALLAST_HALF_WIDTH, -0.1);
    shape.lineTo(BALLAST_HALF_WIDTH + 0.8, GROUND_Y);
    shape.closePath();
    const bed = new THREE.ExtrudeGeometry(shape, { depth: CHUNK_LENGTH, bevelEnabled: false });
    bed.translate(0, 0, -CHUNK_LENGTH);
    const uv = bed.attributes.uv as THREE.BufferAttribute;
    const position = bed.attributes.position as THREE.BufferAttribute;
    // World-scale UVs: one texture tile per 2 m across the top.
    for (let i = 0; i < uv.count; i++) uv.setXY(i, position.getX(i) / 2, position.getZ(i) / 2);
    kit.add(bed, MATERIALS.ballast(), 0, 0, 0);

    const cess = MATERIALS.concrete(3, [12, 1], false);
    for (const side of [-1, 1]) {
      kit.box(
        WALL_X - BALLAST_HALF_WIDTH - 0.6,
        0.12,
        CHUNK_LENGTH,
        cess,
        side * ((WALL_X + BALLAST_HALF_WIDTH + 0.8) / 2),
        GROUND_Y + 0.02,
        -CHUNK_LENGTH / 2,
      );
      // Covered cable trough along the foot of the wall.
      kit.box(0.5, 0.28, CHUNK_LENGTH, MATERIALS.concrete(1, [15, 0.2], false), side * (WALL_X - 0.35), GROUND_Y + 0.14, -CHUNK_LENGTH / 2);
    }

    const rail = railGeometry();
    for (let lane = -1; lane <= 1; lane++) {
      for (const side of [-GAUGE / 2, GAUGE / 2]) {
        kit.add(rail, MATERIALS.railBody(), lane * LANE_WIDTH + side, 0, 0);
        // Polished running surface where the wheels contact the rail.
        kit.box(0.05, 0.004, CHUNK_LENGTH, MATERIALS.railHead(), lane * LANE_WIDTH + side, RAIL_HEIGHT + 0.001, -CHUNK_LENGTH / 2);
      }
    }
  }

  private buildSleepers(): THREE.Group {
    const group = new THREE.Group();
    const perLane = Math.floor(CHUNK_LENGTH / SLEEPER_SPACING);
    const sleepers = new THREE.InstancedMesh(new THREE.BoxGeometry(2.5, 0.2, 0.26), MATERIALS.sleeper(), perLane * 3);
    const clips = this.detail > 0 ? new THREE.InstancedMesh(new THREE.BoxGeometry(0.2, 0.05, 0.1), MATERIALS.darkMetal(), perLane * 6) : null;
    const matrix = new THREE.Matrix4();
    let n = 0;
    let c = 0;
    for (let lane = -1; lane <= 1; lane++) {
      for (let i = 0; i < perLane; i++) {
        const z = -i * SLEEPER_SPACING - SLEEPER_SPACING / 2;
        matrix.makeTranslation(lane * LANE_WIDTH, -0.1, z);
        sleepers.setMatrixAt(n++, matrix);
        if (!clips) continue;
        for (const side of [-GAUGE / 2, GAUGE / 2]) {
          matrix.makeTranslation(lane * LANE_WIDTH + side, 0.025, z);
          clips.setMatrixAt(c++, matrix);
        }
      }
    }
    for (const mesh of [sleepers, clips]) {
      if (!mesh) continue;
      mesh.instanceMatrix.needsUpdate = true;
      mesh.frustumCulled = false;
      mesh.receiveShadow = true;
      group.add(mesh);
    }
    return group;
  }

  // ─── Trackside ───────────────────────────────────────────────────────────

  private buildTrackside(kit: Kit, rng: Random, withBuildings: boolean): void {
    const wall = MATERIALS.concrete(rng.int(0, 2), [CHUNK_LENGTH / 6, 1]);
    const coping = MATERIALS.concrete(3, [CHUNK_LENGTH / 3, 0.2], false);
    for (const side of [-1, 1]) {
      kit.box(0.45, WALL_HEIGHT - GROUND_Y, CHUNK_LENGTH, wall, side * WALL_X, (WALL_HEIGHT + GROUND_Y) / 2, -CHUNK_LENGTH / 2);
      kit.box(0.7, 0.16, CHUNK_LENGTH, coping, side * WALL_X, WALL_HEIGHT + 0.08, -CHUNK_LENGTH / 2);
      if (rng.chance(0.55)) {
        const decal = new THREE.Mesh(new THREE.PlaneGeometry(7, 2.6), graffitiMaterial(rng.int(0, 9)));
        decal.position.set(side * (WALL_X - 0.235), 1.35, -rng.range(5, CHUNK_LENGTH - 5));
        decal.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
        kit.group.add(decal);
      }
      // Street level beyond the wall: pavement slab.
      const pavementWidth = BUILDING_X - STREET_X + 20;
      kit.box(
        pavementWidth,
        0.2,
        CHUNK_LENGTH,
        MATERIALS.concrete(2, [6, CHUNK_LENGTH / 4], false),
        side * (STREET_X + pavementWidth / 2),
        WALL_HEIGHT - 0.1,
        -CHUNK_LENGTH / 2,
      );
      this.buildLampPosts(kit, side, rng);
      if (withBuildings) this.buildBuildings(kit, side, rng);
      if (this.detail > 0) this.buildStreetTrees(kit, side, rng);
    }
    this.buildCatenary(kit, -CHUNK_LENGTH / 2);
    if (rng.chance(0.3)) this.buildSignal(kit, rng.pick([-1, 1]), -rng.range(4, 12), rng);
  }

  private buildLampPosts(kit: Kit, side: number, rng: Random): void {
    const pole = MATERIALS.galvanised();
    for (let z = -rng.range(3, 8); z > -CHUNK_LENGTH; z -= 15) {
      const x = side * (WALL_X - 0.55);
      kit.cylinder(0.07, 0.1, 6, pole, x, GROUND_Y + 3, z, 8);
      kit.beam(new THREE.Vector3(x, 5.9, z), new THREE.Vector3(x - side * 1.4, 6.05, z), 0.04, pole);
      kit.box(0.55, 0.1, 0.22, MATERIALS.darkMetal(), x - side * 1.55, 6.0, z);
      kit.box(0.46, 0.02, 0.16, emissive("#ffe7c2", 1), x - side * 1.55, 5.94, z);
    }
  }

  /** Overhead line equipment: masts, cantilevers, messenger and contact wires with droppers. */
  private buildCatenary(kit: Kit, z: number): void {
    const steel = MATERIALS.galvanised();
    const wire = MATERIALS.steel("#4a4d50", 0.5);
    for (const side of [-1, 1]) {
      const x = side * (WALL_X - 0.9);
      // H-section mast: web plus two flanges.
      kit.box(0.08, 7.4, 0.26, steel, x, GROUND_Y + 3.7, z);
      kit.box(0.24, 7.4, 0.03, steel, x, GROUND_Y + 3.7, z + 0.12);
      kit.box(0.24, 7.4, 0.03, steel, x, GROUND_Y + 3.7, z - 0.12);
      kit.beam(new THREE.Vector3(x, 6.7, z), new THREE.Vector3(side * 1.2, 6.7, z), 0.045, steel);
      kit.beam(new THREE.Vector3(x, 5.9, z), new THREE.Vector3(side * 2.8, 6.65, z), 0.035, steel);
      kit.cylinder(0.06, 0.06, 0.35, paint("#7a4b3a", 0.6), x - side * 0.3, 6.7, z, 8, new THREE.Euler(0, 0, Math.PI / 2));
    }
    kit.beam(new THREE.Vector3(-1.2, 6.7, z), new THREE.Vector3(1.2, 6.7, z), 0.045, steel);
    for (let lane = -1; lane <= 1; lane++) {
      const x = lane * LANE_WIDTH;
      kit.beam(new THREE.Vector3(x, 5.55, 0), new THREE.Vector3(x, 5.55, -CHUNK_LENGTH), 0.012, wire, 4);
      // Messenger wire sagging between supports, with droppers holding the contact wire.
      const segments = 6;
      const sag = (zz: number) => 6.55 - 0.45 * (1 - ((zz - z) / (CHUNK_LENGTH / 2)) ** 2);
      for (let i = 0; i < segments; i++) {
        const z0 = -(i / segments) * CHUNK_LENGTH;
        const z1 = -((i + 1) / segments) * CHUNK_LENGTH;
        kit.beam(new THREE.Vector3(x, sag(z0), z0), new THREE.Vector3(x, sag(z1), z1), 0.01, wire, 4);
        if (this.detail > 0) kit.beam(new THREE.Vector3(x, 5.56, z1), new THREE.Vector3(x, sag(z1), z1), 0.005, wire, 3);
      }
      kit.beam(new THREE.Vector3(x, 5.55, z), new THREE.Vector3(x, 6.7, z), 0.012, steel, 4);
    }
  }

  private buildSignal(kit: Kit, side: number, z: number, rng: Random): void {
    const x = side * (WALL_X - 1.3);
    kit.cylinder(0.08, 0.08, 3.6, MATERIALS.galvanised(), x, GROUND_Y + 1.8, z, 8);
    kit.box(0.42, 1.0, 0.28, paint("#161718", 0.6), x, GROUND_Y + 3.6, z);
    const aspect = rng.chance(0.7) ? "#39ff6a" : "#ff3b30";
    kit.cylinder(0.09, 0.09, 0.04, emissive(aspect, 0.8), x, GROUND_Y + 3.85, z + 0.15, 12, new THREE.Euler(Math.PI / 2, 0, 0));
    kit.cylinder(0.09, 0.09, 0.04, paint("#2a2a2a", 0.3), x, GROUND_Y + 3.45, z + 0.15, 12, new THREE.Euler(Math.PI / 2, 0, 0));
  }

  private buildStreetTrees(kit: Kit, side: number, rng: Random): void {
    for (let z = -rng.range(4, 10); z > -CHUNK_LENGTH + 2; z -= rng.range(10, 16)) {
      const x = side * rng.range(STREET_X + 1.2, BUILDING_X - 1);
      const height = rng.range(4.5, 7);
      kit.cylinder(0.12, 0.2, height, MATERIALS.bark(), x, WALL_HEIGHT + height / 2, z, 7);
      const foliage = MATERIALS.foliage(rng.pick(["#3f5a2a", "#4a6a31", "#35502a", "#56733a"]));
      for (let i = 0; i < 5; i++) {
        const radius = rng.range(1.1, 1.8);
        const geometry = new THREE.IcosahedronGeometry(radius, 1);
        const position = geometry.attributes.position as THREE.BufferAttribute;
        // Lumpy, irregular canopy clumps.
        for (let v = 0; v < position.count; v++) {
          const scale = 1 + (rng.next() - 0.5) * 0.35;
          position.setXYZ(v, position.getX(v) * scale, position.getY(v) * scale * 0.85, position.getZ(v) * scale);
        }
        geometry.computeVertexNormals();
        kit.add(geometry, foliage, x + rng.range(-1, 1), WALL_HEIGHT + height + rng.range(-0.5, 1.2), z + rng.range(-1, 1));
      }
    }
  }

  private buildBuildings(kit: Kit, side: number, rng: Random): void {
    let z = -rng.range(0, 3);
    while (z > -CHUNK_LENGTH + 5) {
      const width = rng.range(8, 14);
      const depth = rng.range(10, 18);
      const glass = rng.chance(0.22);
      const floors = glass ? rng.int(10, 20) : rng.int(4, 9);
      const height = floors * 3.2;
      const x = side * (BUILDING_X + depth / 2 + rng.range(0, 3));
      const baseY = WALL_HEIGHT;
      const faceX = x - side * (depth / 2);
      const zCenter = z - width / 2;
      if (glass) {
        kit.box(depth, height, width, MATERIALS.curtainWall(rng.int(0, 2), [1, 1]), x, baseY + height / 2, zCenter, [3.2, 6.4]);
        kit.box(depth + 0.3, 0.6, width + 0.3, MATERIALS.concrete(3, [4, 0.3], false), x, baseY + height + 0.3, zCenter);
      } else {
        kit.box(depth, height, width, MATERIALS.facade(rng.int(0, 3), [1, 1]), x, baseY + height / 2, zCenter, [10, 19.2]);
        // Parapet, cornice and a glazed ground-floor shopfront.
        kit.box(depth + 0.25, 0.9, width + 0.25, MATERIALS.concrete(1, [4, 0.3], false), x, baseY + height + 0.45, zCenter);
        kit.box(0.2, 0.35, width + 0.2, MATERIALS.concrete(3, [4, 0.3], false), faceX - side * 0.1, baseY + height - 0.2, zCenter);
        kit.box(0.1, 3, width * 0.9, MATERIALS.glass(), faceX - side * 0.05, baseY + 1.6, zCenter);
        if (this.detail > 0 && rng.chance(0.6)) this.buildFireEscape(kit, faceX, side, baseY, floors, zCenter);
        if (rng.chance(0.55)) this.buildWaterTank(kit, x + rng.range(-2, 2), baseY + height + 0.9, zCenter + rng.range(-2, 2));
        for (let i = 0; i < rng.int(1, 3); i++) {
          kit.box(1.1, 0.8, 1.4, MATERIALS.galvanised(), x + rng.range(-3, 3), baseY + height + 1.3, z - rng.range(1, width - 1));
        }
      }
      z -= width + rng.range(0.4, 2.5);
    }
  }

  private buildFireEscape(kit: Kit, faceX: number, side: number, baseY: number, floors: number, zCenter: number): void {
    const iron = paint("#2b2c2e", 0.55, 0.6);
    const outX = faceX - side * 0.7;
    for (let f = 1; f < floors; f++) {
      const y = baseY + f * 3.2;
      kit.box(1.3, 0.05, 3.2, iron, outX, y, zCenter);
      kit.box(0.04, 0.9, 3.2, iron, outX - side * 0.63, y + 0.45, zCenter);
      const dir = f % 2 === 0 ? 1 : -1;
      kit.beam(new THREE.Vector3(outX, y, zCenter + dir * 1.4), new THREE.Vector3(outX, y - 3.2, zCenter - dir * 1.4), 0.05, iron, 4);
    }
  }

  private buildWaterTank(kit: Kit, x: number, y: number, z: number): void {
    kit.cylinder(1.2, 1.2, 2.4, paint("#6d4b33", 0.85), x, y + 2, z, 14);
    kit.cylinder(0.02, 1.35, 0.9, paint("#3a3a3a", 0.7), x, y + 3.65, z, 14);
    for (const [dx, dz] of [
      [-0.8, -0.8],
      [0.8, -0.8],
      [-0.8, 0.8],
      [0.8, 0.8],
    ] as const) {
      kit.box(0.1, 1.2, 0.1, MATERIALS.darkMetal(), x + dx, y + 0.3, z + dz);
    }
  }

  // ─── Structures ──────────────────────────────────────────────────────────

  private buildOverpass(kit: Kit, rng: Random): void {
    const z = -rng.range(9, CHUNK_LENGTH - 9);
    const deckY = 8;
    kit.box(64, 0.9, 9, MATERIALS.concrete(1, [1, 1], false), 0, deckY, z, [6, 1]);
    for (const dz of [-3.2, -1.1, 1.1, 3.2]) kit.box(64, 0.9, 0.35, paint("#3d5a6e", 0.5, 0.5), 0, deckY - 0.85, z + dz);
    for (const dz of [-4.4, 4.4]) kit.box(64, 1.1, 0.25, MATERIALS.concrete(3, [10, 0.3], false), 0, deckY + 1, z + dz);
    for (const side of [-1, 1]) {
      kit.box(1.2, deckY - GROUND_Y, 8, MATERIALS.concrete(0, [2, 2]), side * (WALL_X + 1.2), (deckY + GROUND_Y) / 2, z);
      for (const dz of [-3.9, 3.9]) {
        kit.cylinder(0.06, 0.08, 4.5, MATERIALS.galvanised(), side * 14, deckY + 2.7, z + dz, 8);
        kit.box(0.5, 0.1, 0.2, emissive("#ffe7c2", 1), side * 13.6, deckY + 4.9, z + dz);
      }
    }
    kit.box(6, 1, 0.04, signMaterial("bridge", "MILL ST", "#f2f2f2", "#1f5a3a"), 0, deckY - 0.1, z + 4.53);
  }

  private buildTunnel(kit: Kit, rng: Random): void {
    const lining = MATERIALS.concrete(3, [CHUNK_LENGTH / 6, 1.5]);
    const height = 7.2;
    for (const side of [-1, 1]) {
      kit.box(0.6, height - GROUND_Y, CHUNK_LENGTH, lining, side * (WALL_X + 0.1), (height + GROUND_Y) / 2, -CHUNK_LENGTH / 2);
      // Cable trays, a safety handrail and recessed emergency lights.
      for (const y of [2.2, 2.5, 2.8]) kit.box(0.25, 0.06, CHUNK_LENGTH, MATERIALS.galvanised(), side * (WALL_X - 0.35), y, -CHUNK_LENGTH / 2);
      kit.box(0.05, 0.05, CHUNK_LENGTH, paint("#d8b400", 0.5, 0.3), side * (WALL_X - 0.6), 1.1, -CHUNK_LENGTH / 2);
      for (let z = -4; z > -CHUNK_LENGTH; z -= 8) kit.box(0.08, 0.32, 1.1, emissive("#fff1d0", 0.9), side * (WALL_X - 0.22), 4.2, z);
      if (rng.chance(0.5)) kit.box(0.04, 0.3, 0.8, signMaterial("exit", "EXIT →", "#ffffff", "#0b7a36", 2.5), side * (WALL_X - 0.2), 3.1, -rng.range(5, 25));
    }
    kit.box(WALL_X * 2 + 1.4, 0.7, CHUNK_LENGTH, lining, 0, height + 0.35, -CHUNK_LENGTH / 2);
    // Lining rings every 3 m give the tunnel its rhythm at speed.
    for (let z = -1.5; z > -CHUNK_LENGTH; z -= 3) {
      kit.box(WALL_X * 2, 0.25, 0.35, MATERIALS.concrete(1, [4, 0.2], false), 0, height - 0.1, z);
      for (const side of [-1, 1]) {
        kit.box(0.25, height - GROUND_Y, 0.35, MATERIALS.concrete(1, [0.3, 3], false), side * (WALL_X - 0.2), (height + GROUND_Y) / 2, z);
      }
    }
    for (let lane = -1; lane <= 1; lane++) {
      for (let z = -3; z > -CHUNK_LENGTH; z -= 6) kit.box(0.2, 0.06, 2.2, emissive("#e9f0ff", 0.8), lane * LANE_WIDTH, height - 0.26, z);
    }
  }

  private buildTunnelPortal(kit: Kit): void {
    const z = -CHUNK_LENGTH + 0.6;
    const face = MATERIALS.concrete(0, [6, 3]);
    kit.box(40, 6, 1.6, face, 0, 10.2, z);
    for (const side of [-1, 1]) kit.box(14, 13.5, 1.6, face, side * (WALL_X + 7.4), 6.5, z);
    kit.box(WALL_X * 2 + 1.5, 0.5, 1.8, paint("#d8b400", 0.5, 0.2), 0, 7.45, z);
    kit.box(4, 1, 0.06, signMaterial("tunnel", "TUNNEL 3", "#f2f2f2", "#23324a"), 0, 9.3, z + 0.84);
  }

  /**
   * Hazy distant city blocks. Being effectively at infinity, they stay put
   * relative to the camera instead of scrolling with the track.
   */
  private buildSkyline(): void {
    const rng = new Random(4242);
    const kit = new Kit();
    for (let i = 0; i < 70; i++) {
      const side = rng.chance(0.5) ? -1 : 1;
      const width = rng.range(12, 35);
      const height = rng.range(20, 110);
      const material = rng.chance(0.5) ? MATERIALS.curtainWall(rng.int(0, 2), [1, 1]) : MATERIALS.facade(rng.int(0, 3), [1, 1]);
      kit.box(width, height, width, material, side * rng.range(35, 260), height / 2 - 5, -rng.range(140, 480), [10, 19.2]);
    }
    const merged = mergeByMaterial(kit.group);
    merged.traverse((object) => {
      if (object instanceof THREE.Mesh) object.castShadow = false;
    });
    this.skyline.add(merged);
  }
}
