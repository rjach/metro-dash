import * as THREE from "three";
import { WORLD } from "../core/config";
import type { ObstacleKind } from "../game/types";
import { additive, emissive, MATERIALS, paint, physical, standard } from "./materials";
import { mergeByMaterial } from "./merge";
import { graffitiDecal, signTexture } from "./pbrTextures";
import { glowTexture } from "./textures";

/** Livery colours for the painted bands of each train variant. */
export const TRAIN_LIVERIES = ["#1f5fb4", "#c8312b", "#e07b1a", "#1f8a5b"] as const;
const RAIL_TOP = 0.16;
const WHEEL_RADIUS = 0.42;
const BODY_BOTTOM = 0.98;
const BODY_TOP = WORLD.trainHeight - 0.1;
const CAR_GAP = 0.45;

const trainWindow = () =>
  physical("train-window", {
    color: "#1b252c",
    roughness: 0.04,
    metalness: 0.2,
    clearcoat: 1,
    clearcoatRoughness: 0.03,
    // Faint warm interior lighting behind the glass.
    emissive: "#ffe6bf",
    emissiveIntensity: 0.12,
    envMapIntensity: 1.8,
  });

const destinationSign = (variant: number) =>
  standard(`dest-${variant}`, {
    color: "#050505",
    emissive: "#ffffff",
    emissiveIntensity: 3,
    emissiveMap: signTexture(`dest-${variant}`, ["7 EXPRESS", "C  UPTOWN", "L  8 AV", "5  DOWNTOWN"][variant % 4]!, "#ff9a1c", "#050505"),
  });

class Parts {
  readonly group = new THREE.Group();
  box(w: number, h: number, d: number, material: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }
  cylinder(r: number, h: number, material: THREE.Material, x: number, y: number, z: number, axis: "x" | "y" | "z" = "y", segments = 14): THREE.Mesh {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(r, r, h, segments), material);
    if (axis === "x") mesh.rotation.z = Math.PI / 2;
    if (axis === "z") mesh.rotation.x = Math.PI / 2;
    mesh.position.set(x, y, z);
    this.group.add(mesh);
    return mesh;
  }
}

/** Two-axle bogie: side frames, springs, axle boxes and flanged wheels on the rails. */
const addBogie = (p: Parts, z: number) => {
  const frame = MATERIALS.underframe();
  const wheelY = RAIL_TOP + WHEEL_RADIUS;
  for (const side of [-0.72, 0.72]) {
    p.box(0.14, 0.32, 2.6, frame, side * 1.02, wheelY + 0.05, z);
    for (const dz of [-0.95, 0.95]) {
      p.cylinder(WHEEL_RADIUS, 0.12, MATERIALS.steel("#6f747a", 0.35), side, wheelY, z + dz, "x", 18);
      p.cylinder(WHEEL_RADIUS * 0.55, 0.14, MATERIALS.darkMetal(), side, wheelY, z + dz, "x", 12);
      p.cylinder(0.09, 0.28, paint("#b33b2a", 0.6, 0.3), side * 1.1, wheelY + 0.32, z + dz * 0.55);
    }
  }
  p.box(1.6, 0.16, 0.3, frame, 0, wheelY + 0.18, z);
};

/**
 * Builds a multi-car subway train whose local origin is its front face at rail
 * level; it extends toward −z (away from the runner).
 */
export const buildTrain = (cars: number, variant: number, moving: boolean): THREE.Group => {
  const p = new Parts();
  const carLength = WORLD.trainCarLength;
  const bodyLength = carLength - CAR_GAP;
  const bodyHeight = BODY_TOP - BODY_BOTTOM;
  const liveryColor = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length]!;
  const livery = MATERIALS.trainPaint(liveryColor);
  const halfWidth = WORLD.trainWidth / 2;

  for (let i = 0; i < cars; i++) {
    const zc = -(i * carLength + carLength / 2);
    p.box(WORLD.trainWidth, bodyHeight, bodyLength, MATERIALS.trainBody(), 0, BODY_BOTTOM + bodyHeight / 2, zc);
    // Curved roof and roof-mounted air conditioning units.
    const roof = new THREE.Mesh(
      new THREE.CylinderGeometry(halfWidth, halfWidth, bodyLength, 20, 1, false, -Math.PI / 2, Math.PI),
      MATERIALS.steel("#9ca1a6", 0.5),
    );
    roof.rotation.x = -Math.PI / 2;
    roof.scale.set(1, 1, 0.09);
    roof.position.set(0, BODY_TOP, zc);
    p.group.add(roof);
    for (const dz of [-bodyLength * 0.28, bodyLength * 0.28]) {
      p.box(1.3, 0.22, 2.2, MATERIALS.steel("#b9bdc1", 0.45), 0, BODY_TOP + 0.13, zc + dz);
      p.box(1.2, 0.02, 2.0, MATERIALS.darkMetal(), 0, BODY_TOP + 0.25, zc + dz);
    }
    // Underframe equipment between the bogies.
    p.box(1.9, 0.42, bodyLength - 5.4, MATERIALS.underframe(), 0, BODY_BOTTOM - 0.24, zc);
    addBogie(p, zc - bodyLength / 2 + 1.7);
    addBogie(p, zc + bodyLength / 2 - 1.7);

    for (const side of [-1, 1]) {
      const x = side * (halfWidth + 0.012);
      p.box(0.02, 0.28, bodyLength, livery, x, BODY_BOTTOM + 0.5, zc);
      p.box(0.02, 0.06, bodyLength, livery, x, BODY_TOP - 0.35, zc);
      // Two sets of double doors; windows between them.
      for (const dz of [-bodyLength * 0.27, bodyLength * 0.27]) {
        p.box(0.03, 1.95, 1.3, MATERIALS.steel("#a9adb2", 0.3), x, BODY_BOTTOM + 0.98, zc + dz);
        p.box(0.035, 1.95, 0.03, MATERIALS.rubber(), x, BODY_BOTTOM + 0.98, zc + dz);
        for (const half of [-0.33, 0.33]) p.box(0.04, 0.75, 0.42, trainWindow(), x, BODY_BOTTOM + 1.45, zc + dz + half);
      }
      for (const dz of [-bodyLength * 0.45, 0, bodyLength * 0.45]) {
        const width = dz === 0 ? bodyLength * 0.36 : 0.9;
        p.box(0.04, 0.78, width, trainWindow(), x, BODY_BOTTOM + 1.5, zc + dz);
      }
      if (variant === 3 && i % 2 === 0) {
        const tag = new THREE.Mesh(
          new THREE.PlaneGeometry(4.5, 1.6),
          standard(`train-graffiti-${i}`, { map: graffitiDecal(20 + i), transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 }),
        );
        tag.position.set(side * (halfWidth + 0.03), BODY_BOTTOM + 0.9, zc);
        tag.rotation.y = side * (Math.PI / 2);
        p.group.add(tag);
      }
    }
    if (i > 0) {
      // Rubber gangway bellows and coupler between cars.
      p.box(1.3, 2.1, CAR_GAP + 0.1, MATERIALS.rubber(), 0, BODY_BOTTOM + 1.1, -(i * carLength));
      p.box(0.3, 0.2, CAR_GAP + 0.4, MATERIALS.darkMetal(), 0, BODY_BOTTOM - 0.15, -(i * carLength));
    }
  }

  // Cab ends: windshield, lights and a destination display.
  const ends = [
    { z: -CAR_GAP / 2 + 0.01, dir: 1, front: true },
    { z: -(cars * carLength) + CAR_GAP / 2 - 0.01, dir: -1, front: false },
  ];
  for (const end of ends) {
    const z = end.z + end.dir * 0.02;
    p.box(1.9, 1.15, 0.04, MATERIALS.rubber(), 0, BODY_BOTTOM + 1.55, z);
    p.box(1.7, 0.95, 0.05, trainWindow(), 0, BODY_BOTTOM + 1.6, z + end.dir * 0.01);
    p.box(1.2, 0.2, 0.05, destinationSign(variant), 0, BODY_TOP - 0.18, z + end.dir * 0.01);
    p.box(WORLD.trainWidth, 0.2, 0.05, livery, 0, BODY_BOTTOM + 0.5, z);
    const lamp = end.front ? emissive(moving ? "#fffaf0" : "#fff1d6", moving ? 2.2 : 0.7) : emissive("#ff2a1a", 0.8);
    for (const x of [-0.72, 0.72]) p.cylinder(0.11, 0.06, lamp, x, BODY_BOTTOM + 0.78, z + end.dir * 0.02, "z", 16);
    p.box(0.5, 0.18, 0.3, MATERIALS.darkMetal(), 0, BODY_BOTTOM - 0.05, z - end.dir * 0.05);
  }
  if (moving) {
    // Oncoming trains announce themselves with bright headlight glare.
    for (const x of [-0.72, 0.72]) {
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), additive("#fff2c8", glowTexture(), 0.9));
      halo.position.set(x, BODY_BOTTOM + 0.78, 0.15);
      p.group.add(halo);
    }
  }
  return p.group;
};

/** Steel loading ramp with tread-plate deck, hazard edges and support legs. */
export const buildRamp = (): THREE.Group => {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(WORLD.rampLength, 0);
  shape.lineTo(WORLD.rampLength, WORLD.trainHeight);
  shape.closePath();
  const deckGeometry = new THREE.ExtrudeGeometry(shape, { depth: WORLD.trainWidth, bevelEnabled: false });
  deckGeometry.rotateY(Math.PI / 2);
  deckGeometry.translate(-WORLD.trainWidth / 2, 0, 0);
  const uv = deckGeometry.attributes.uv as THREE.BufferAttribute;
  for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * 0.5, uv.getY(i) * 0.5);
  group.add(new THREE.Mesh(deckGeometry, MATERIALS.treadPlate()));
  const hazard = paint("#e0b400", 0.5, 0.2);
  const slope = Math.atan2(WORLD.trainHeight, WORLD.rampLength);
  const slopeLength = Math.hypot(WORLD.rampLength, WORLD.trainHeight);
  for (const x of [-WORLD.trainWidth / 2, WORLD.trainWidth / 2]) {
    const edge = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, slopeLength), hazard);
    edge.position.set(x, WORLD.trainHeight / 2 + 0.07, -WORLD.rampLength / 2);
    edge.rotation.x = slope;
    group.add(edge);
    for (let i = 1; i < 4; i++) {
      const h = (WORLD.trainHeight * i) / 4;
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, h, 0.1), MATERIALS.galvanised());
      leg.position.set(x * 0.95, h / 2, -(WORLD.rampLength * i) / 4);
      group.add(leg);
    }
  }
  return group;
};

const chevronCache = new Map<string, THREE.CanvasTexture>();
/** Retro-reflective chevron stripes. */
const chevronTexture = (color: string, second = "#f4f4f4"): THREE.CanvasTexture => {
  const key = `${color}-${second}`;
  const existing = chevronCache.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 64;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = second;
  ctx.fillRect(0, 0, 256, 64);
  ctx.fillStyle = color;
  for (let x = -64; x < 256 + 64; x += 64) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x + 32, 0);
    ctx.lineTo(x + 64, 64);
    ctx.lineTo(x + 32, 64);
    ctx.closePath();
    ctx.fill();
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = 8;
  chevronCache.set(key, texture);
  return texture;
};

/** Level-crossing style barrier: reflective chevron board on steel posts (jump over it). */
export const buildLowBarrier = (variant: number): THREE.Group => {
  const p = new Parts();
  const color = variant % 2 === 0 ? "#d12a22" : "#e07b1a";
  const board = standard(`barrier-board-${variant % 2}`, {
    map: chevronTexture(color),
    roughness: 0.35,
    metalness: 0.1,
    emissive: "#ffffff",
    emissiveMap: chevronTexture(color),
    emissiveIntensity: 0.05,
  });
  const z = -WORLD.lowBarrierDepth / 2;
  p.box(WORLD.barrierWidth, 0.42, 0.06, board, 0, WORLD.lowBarrierHeight - 0.26, z);
  p.box(WORLD.barrierWidth, 0.05, 0.08, MATERIALS.galvanised(), 0, WORLD.lowBarrierHeight - 0.02, z);
  for (const x of [-0.9, 0.9]) {
    p.box(0.08, WORLD.lowBarrierHeight, 0.08, MATERIALS.galvanised(), x, WORLD.lowBarrierHeight / 2, z);
    p.box(0.45, 0.06, 0.45, MATERIALS.concrete(3, [1, 1], false), x, 0.03, z);
  }
  p.cylinder(0.07, 0.08, emissive("#ff4a1a", 1.2), -0.9, WORLD.lowBarrierHeight + 0.06, z, "y", 12);
  return p.group;
};

/** Low-clearance gantry with a warning board: slide under it. */
export const buildHighBarrier = (variant: number): THREE.Group => {
  const p = new Parts();
  const z = -WORLD.highBarrierDepth / 2;
  const beamHeight = 0.42;
  const beam = standard(`clearance-beam-${variant % 2}`, { map: chevronTexture("#e0b400", "#1a1a1a"), roughness: 0.4, metalness: 0.2 });
  p.box(WORLD.barrierWidth + 0.2, beamHeight, 0.2, beam, 0, WORLD.highBarrierBottom + beamHeight / 2, z);
  const sign = standard("clearance-sign", { map: signTexture("clearance", "LOW CLEARANCE 1.1 m", "#111111", "#f2c200"), roughness: 0.45 });
  const signHeight = WORLD.highBarrierTop - WORLD.highBarrierBottom - beamHeight;
  p.box(WORLD.barrierWidth - 0.1, signHeight, 0.06, sign, 0, WORLD.highBarrierBottom + beamHeight + signHeight / 2, z);
  for (const x of [-(WORLD.barrierWidth / 2 + 0.18), WORLD.barrierWidth / 2 + 0.18]) {
    p.box(0.16, WORLD.highBarrierTop + 0.1, 0.16, MATERIALS.galvanised(), x, (WORLD.highBarrierTop + 0.1) / 2, z);
    p.box(0.5, 0.08, 0.5, MATERIALS.concrete(3, [1, 1], false), x, 0.04, z);
    p.cylinder(0.08, 0.12, emissive("#ffae00", 1.4), x, WORLD.highBarrierTop + 0.2, z, "y", 12);
  }
  return p.group;
};

/** Hydraulic buffer stop at the end of a siding: switch lanes. */
export const buildBlock = (): THREE.Group => {
  const p = new Parts();
  const depth = WORLD.blockDepth;
  const red = MATERIALS.trainPaint("#b3261e");
  p.box(WORLD.barrierWidth, 0.7, 0.3, standard("buffer-headstock", { map: chevronTexture("#d12a22"), roughness: 0.4, metalness: 0.2 }), 0, 1.15, -0.2);
  for (const x of [-0.62, 0.62]) {
    p.cylinder(0.2, 0.36, MATERIALS.steel("#9aa0a6", 0.3), x, 1.15, 0.05, "z", 18);
    p.cylinder(0.3, 0.06, MATERIALS.darkMetal(), x, 1.15, 0.24, "z", 18);
    const strut = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.14, Math.hypot(depth, 1.1)), red);
    strut.position.set(x, 0.62, -depth / 2 - 0.1);
    strut.rotation.x = -Math.atan2(1.1, depth);
    p.group.add(strut);
  }
  p.box(WORLD.barrierWidth, 0.2, depth, red, 0, 0.35, -depth / 2);
  p.box(WORLD.barrierWidth * 0.9, WORLD.blockHeight - 1.5, 0.12, red, 0, 1.5 + (WORLD.blockHeight - 1.5) / 2, -0.3);
  p.cylinder(0.14, 0.14, emissive("#ff2a1a", 1.6), 0, WORLD.blockHeight + 0.08, -0.3, "y", 14);
  return p.group;
};

export const obstacleKey = (kind: ObstacleKind, length: number, variant: number): string => {
  if (kind === "train" || kind === "movingTrain") return `${kind}:${Math.round(length / WORLD.trainCarLength)}:${variant % TRAIN_LIVERIES.length}`;
  if (kind === "ramp" || kind === "block") return kind;
  return `${kind}:${variant % 2}`;
};

export const buildObstacle = (kind: ObstacleKind, length: number, variant: number): THREE.Group => mergeByMaterial(buildObstacleParts(kind, length, variant));

const buildObstacleParts = (kind: ObstacleKind, length: number, variant: number): THREE.Group => {
  switch (kind) {
    case "train":
    case "movingTrain":
      return buildTrain(Math.max(1, Math.round(length / WORLD.trainCarLength)), variant, kind === "movingTrain");
    case "ramp":
      return buildRamp();
    case "barrierLow":
      return buildLowBarrier(variant);
    case "barrierHigh":
      return buildHighBarrier(variant);
    case "block":
      return buildBlock();
  }
};
