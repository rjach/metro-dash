import * as THREE from "three";
import { WORLD } from "../core/config";
import type { ObstacleKind } from "../game/types";
import { additive, emissive, lambert, phong } from "./materials";
import { mergeByMaterial } from "./merge";
import { glowTexture, stripeTexture, TRAIN_LIVERIES, trainAtlasTexture } from "./textures";

export { TRAIN_LIVERIES };

const UNDERCARRIAGE = 0.38;
const CAR_GAP = 0.35;

/** Atlas regions (u0, v0, u1, v1) for each BoxGeometry face: +x, -x, +y, -y, +z, -z. */
const TRAIN_ATLAS_FACES: [number, number, number, number][] = [
  [1, 0.5, 0, 1], // +x side (u flipped so graffiti reads correctly from this side)
  [0, 0.5, 1, 1], // -x side
  [0.25, 0, 0.5, 0.5], // roof
  [0.5, 0, 0.75, 0.5], // underside
  [0, 0, 0.25, 0.5], // front (faces the runner)
  [0, 0, 0.25, 0.5], // back
];

const trainBodyGeometry = (width: number, height: number, length: number): THREE.BoxGeometry => {
  const geometry = new THREE.BoxGeometry(width, height, length);
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const perFace = uv.count / 6;
  for (let face = 0; face < 6; face++) {
    const [u0, v0, u1, v1] = TRAIN_ATLAS_FACES[face]!;
    for (let i = face * perFace; i < (face + 1) * perFace; i++) {
      uv.setXY(i, u0 + uv.getX(i) * (u1 - u0), v0 + uv.getY(i) * (v1 - v0));
    }
  }
  return geometry;
};

/**
 * Builds a multi-car train whose local origin is its front face at ground level;
 * it extends toward −z (away from the runner).
 */
export const buildTrain = (cars: number, variant: number, moving: boolean): THREE.Group => {
  const group = new THREE.Group();
  const carLength = WORLD.trainCarLength;
  const height = WORLD.trainHeight - UNDERCARRIAGE - 0.12;
  const bodyGeometry = trainBodyGeometry(WORLD.trainWidth, height, carLength - CAR_GAP);
  const bodyMaterial = lambert("#ffffff", trainAtlasTexture(variant));
  const underGeometry = new THREE.BoxGeometry(WORLD.trainWidth * 0.8, UNDERCARRIAGE, carLength - 1.2);
  const wheelGeometry = new THREE.CylinderGeometry(0.34, 0.34, 0.2, 12);
  wheelGeometry.rotateZ(Math.PI / 2);
  const roofGeometry = new THREE.BoxGeometry(WORLD.trainWidth * 0.86, 0.12, carLength - CAR_GAP - 0.6);
  const livery = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length]!;

  for (let i = 0; i < cars; i++) {
    const zCenter = -(i * carLength + carLength / 2);
    const body = new THREE.Mesh(bodyGeometry, bodyMaterial);
    body.position.set(0, UNDERCARRIAGE + height / 2, zCenter);
    group.add(body);
    const roof = new THREE.Mesh(roofGeometry, lambert(livery.roof));
    roof.position.set(0, WORLD.trainHeight - 0.06, zCenter);
    group.add(roof);
    // Roof-mounted air-conditioning boxes break up the silhouette.
    for (const dz of [-2.4, 2.4]) {
      const unit = new THREE.Mesh(new THREE.BoxGeometry(1.1, 0.2, 1.6), lambert("#9aa3ad"));
      unit.position.set(0, WORLD.trainHeight + 0.08, zCenter + dz);
      group.add(unit);
    }
    const under = new THREE.Mesh(underGeometry, lambert("#2b2b2b"));
    under.position.set(0, UNDERCARRIAGE / 2, zCenter);
    group.add(under);
    if (i > 0) {
      const coupler = new THREE.Mesh(new THREE.BoxGeometry(1.2, 2.2, CAR_GAP + 0.2), lambert("#3a3a3a"));
      coupler.position.set(0, UNDERCARRIAGE + 1.2, -(i * carLength));
      group.add(coupler);
    }
    for (const dz of [-carLength / 2 + 1.6, -carLength / 2 + 2.5, carLength / 2 - 2.5, carLength / 2 - 1.6]) {
      for (const side of [-0.62, 0.62]) {
        const wheel = new THREE.Mesh(wheelGeometry, phong("#555a60", 40));
        wheel.position.set(side, 0.34, zCenter + dz);
        group.add(wheel);
      }
    }
  }

  if (moving) {
    // Oncoming trains announce themselves with bright headlights.
    for (const x of [-0.72, 0.72]) {
      const lamp = new THREE.Mesh(new THREE.CircleGeometry(0.2, 12), emissive("#fffbe0", 1.4));
      lamp.position.set(x, 0.98, 0.02);
      group.add(lamp);
      const halo = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 2.2), additive("#fff2b0", glowTexture(), 0.85));
      halo.position.set(x, 0.98, 0.1);
      group.add(halo);
    }
  }
  return group;
};

export const buildRamp = (): THREE.Group => {
  const group = new THREE.Group();
  const shape = new THREE.Shape();
  shape.moveTo(0, 0);
  shape.lineTo(WORLD.rampLength, 0);
  shape.lineTo(WORLD.rampLength, WORLD.trainHeight);
  shape.closePath();
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: WORLD.trainWidth, bevelEnabled: false });
  // Shape x → −z (away from runner), shape y → up, extrusion → x across the lane.
  geometry.rotateY(Math.PI / 2);
  geometry.translate(-WORLD.trainWidth / 2, 0, 0);
  const surface = stripeTexture("ramp-stripes", "#9aa3ad", "#ffd23f", 8);
  group.add(new THREE.Mesh(geometry, lambert("#ffffff", surface)));
  for (const x of [-WORLD.trainWidth / 2, WORLD.trainWidth / 2]) {
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, Math.hypot(WORLD.rampLength, WORLD.trainHeight)), phong("#e6392f"));
    rail.position.set(x, WORLD.trainHeight / 2 + 0.12, -WORLD.rampLength / 2);
    rail.rotation.x = Math.atan2(WORLD.trainHeight, WORLD.rampLength);
    group.add(rail);
  }
  return group;
};

export const buildLowBarrier = (variant: number): THREE.Group => {
  const group = new THREE.Group();
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD.barrierWidth, 0.5, 0.14),
    lambert("#ffffff", stripeTexture("barrier-red", "#ffffff", variant % 2 === 0 ? "#e6392f" : "#ff7a1a", 6)),
  );
  board.position.set(0, WORLD.lowBarrierHeight - 0.28, -WORLD.lowBarrierDepth / 2);
  group.add(board);
  const legMaterial = lambert("#8a5a2b");
  for (const x of [-0.85, 0.85]) {
    for (const dz of [-0.05, -WORLD.lowBarrierDepth + 0.05]) {
      const leg = new THREE.Mesh(new THREE.BoxGeometry(0.1, WORLD.lowBarrierHeight, 0.1), legMaterial);
      leg.position.set(x, WORLD.lowBarrierHeight / 2, dz);
      leg.rotation.x = dz > -0.1 ? -0.2 : 0.2;
      group.add(leg);
    }
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.1, 8, 6), emissive("#ffb300", 1.3));
  lamp.position.set(-0.85, WORLD.lowBarrierHeight + 0.05, -0.25);
  group.add(lamp);
  return group;
};

export const buildHighBarrier = (variant: number): THREE.Group => {
  const group = new THREE.Group();
  const boardHeight = WORLD.highBarrierTop - WORLD.highBarrierBottom;
  const board = new THREE.Mesh(
    new THREE.BoxGeometry(WORLD.barrierWidth + 0.2, boardHeight * 0.55, 0.16),
    lambert("#ffffff", stripeTexture("barrier-high", "#ffffff", variant % 2 === 0 ? "#e6392f" : "#2f7de1", 7)),
  );
  board.position.set(0, WORLD.highBarrierBottom + boardHeight * 0.3, -WORLD.highBarrierDepth / 2);
  group.add(board);
  const sign = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.62, 0.1), lambert("#ffd23f"));
  sign.position.set(0, WORLD.highBarrierTop - 0.3, -WORLD.highBarrierDepth / 2);
  group.add(sign);
  const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.2, 0.34, 3), lambert("#1b1b2f"));
  arrow.rotation.z = Math.PI;
  arrow.position.set(0, WORLD.highBarrierTop - 0.3, -WORLD.highBarrierDepth / 2 + 0.07);
  group.add(arrow);
  for (const x of [-(WORLD.barrierWidth / 2 + 0.12), WORLD.barrierWidth / 2 + 0.12]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.14, WORLD.highBarrierTop, 0.14), lambert("#6b7078"));
    post.position.set(x, WORLD.highBarrierTop / 2, -WORLD.highBarrierDepth / 2);
    group.add(post);
    const foot = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.6), lambert("#4a4f56"));
    foot.position.set(x, 0.06, -WORLD.highBarrierDepth / 2);
    group.add(foot);
  }
  return group;
};

export const buildBlock = (): THREE.Group => {
  const group = new THREE.Group();
  const chevrons = stripeTexture("chevrons", "#ffd23f", "#1b1b2f", 5);
  const body = new THREE.Mesh(new THREE.BoxGeometry(WORLD.barrierWidth, WORLD.blockHeight - 0.4, WORLD.blockDepth), [
    lambert("#c9a227"),
    lambert("#c9a227"),
    lambert("#8a8f99"),
    lambert("#333"),
    lambert("#ffffff", chevrons),
    lambert("#c9a227"),
  ]);
  body.position.set(0, (WORLD.blockHeight - 0.4) / 2 + 0.4, -WORLD.blockDepth / 2);
  group.add(body);
  const base = new THREE.Mesh(new THREE.BoxGeometry(WORLD.barrierWidth + 0.2, 0.4, WORLD.blockDepth + 0.3), lambert("#555a60"));
  base.position.set(0, 0.2, -WORLD.blockDepth / 2);
  group.add(base);
  for (const x of [-0.6, 0.6]) {
    const buffer = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 10), phong("#9aa3ad", 80));
    buffer.rotation.x = Math.PI / 2;
    buffer.position.set(x, 1.1, 0.2);
    group.add(buffer);
  }
  const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), emissive("#ff3030", 1.4));
  lamp.position.set(0, WORLD.blockHeight + 0.1, -WORLD.blockDepth / 2);
  group.add(lamp);
  return group;
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
