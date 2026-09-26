import * as THREE from "three";
import type { CollectibleKind } from "../game/types";
import { additive, lambert, MATERIALS, phong, transparent } from "./materials";
import { glowTexture, labelTexture, mysteryTexture } from "./textures";

export const COIN_RADIUS = 0.42;

export const createCoinGeometry = (): THREE.CylinderGeometry => {
  const geometry = new THREE.CylinderGeometry(COIN_RADIUS, COIN_RADIUS, 0.1, 20);
  // The bottom cap's UVs are rotated 180° relative to the top cap, so the emblem
  // would read upside-down ("W") whenever the spinning coin shows its back.
  const bottomCap = geometry.groups[2];
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  const index = geometry.index!;
  if (bottomCap) {
    const seen = new Set<number>();
    for (let i = bottomCap.start; i < bottomCap.start + bottomCap.count; i++) {
      const vertex = index.getX(i);
      if (seen.has(vertex)) continue;
      seen.add(vertex);
      uv.setXY(vertex, 1 - uv.getX(vertex), 1 - uv.getY(vertex));
    }
  }
  // Turning the cap toward the camera also turns its emblem sideways; spin it upright again.
  geometry.rotateY(Math.PI / 2);
  geometry.rotateX(Math.PI / 2);
  return geometry;
};

export const coinMaterials = (): THREE.Material[] => {
  // Real gold: fully metallic, embossed face (normal-mapped "M"), milled rim.
  const face = MATERIALS.gold();
  const rim = MATERIALS.goldRim();
  // Cylinder groups: side, top cap, bottom cap.
  return [rim, face, face];
};

const glowColors: Record<Exclude<CollectibleKind, "coin">, string> = {
  magnet: "#ff5a5a",
  jetpack: "#ffc23d",
  sneakers: "#5dff9a",
  multiplier: "#5ab4ff",
  mysteryBox: "#c77dff",
  key: "#66e3ff",
};

const buildMagnet = (): THREE.Object3D => {
  const group = new THREE.Group();
  const arc = new THREE.Mesh(new THREE.TorusGeometry(0.34, 0.13, 10, 20, Math.PI), phong("#e6392f", 70));
  arc.rotation.z = Math.PI;
  group.add(arc);
  for (const x of [-0.34, 0.34]) {
    const tip = new THREE.Mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.22, 12), phong("#e9eef2", 100));
    tip.position.set(x, 0.1, 0);
    group.add(tip);
  }
  return group;
};

const buildJetpack = (): THREE.Object3D => {
  const group = new THREE.Group();
  for (const x of [-0.2, 0.2]) {
    const tank = new THREE.Mesh(new THREE.CapsuleGeometry(0.16, 0.4, 4, 10), phong("#ffb300", 70));
    tank.position.x = x;
    group.add(tank);
    const nozzle = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.2, 10), phong("#555", 40));
    nozzle.position.set(x, -0.42, 0);
    nozzle.rotation.x = Math.PI;
    group.add(nozzle);
  }
  const strap = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.14, 0.2), lambert("#444"));
  group.add(strap);
  return group;
};

const buildSneaker = (): THREE.Object3D => {
  const group = new THREE.Group();
  const upper = new THREE.Mesh(new THREE.CapsuleGeometry(0.2, 0.42, 4, 10), phong("#2bd46b", 60));
  upper.rotation.z = Math.PI / 2;
  upper.position.y = 0.08;
  group.add(upper);
  const sole = new THREE.Mesh(new THREE.BoxGeometry(0.86, 0.1, 0.36), lambert("#ffffff"));
  sole.position.y = -0.12;
  group.add(sole);
  const wing = new THREE.Mesh(new THREE.ConeGeometry(0.16, 0.5, 3), lambert("#ffffff"));
  wing.rotation.z = Math.PI / 2.6;
  wing.position.set(-0.3, 0.3, 0);
  group.add(wing);
  group.rotation.y = Math.PI / 2;
  return group;
};

const buildMultiplier = (): THREE.Object3D => {
  const group = new THREE.Group();
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 24), phong("#2f7de1", 80));
  disc.rotation.x = Math.PI / 2;
  group.add(disc);
  const label = labelTexture("label-2x", "2x", "#ffffff", "#123a7a");
  for (const z of [0.08, -0.08]) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.8, 0.8), transparent(label, 1, "2x"));
    face.position.z = z;
    if (z < 0) face.rotation.y = Math.PI;
    group.add(face);
  }
  return group;
};

const buildMystery = (): THREE.Object3D => new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.72, 0.72), lambert("#ffffff", mysteryTexture()));

const buildKey = (): THREE.Object3D => {
  const group = new THREE.Group();
  const material = phong("#39c5ff", 110);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.2, 0.07, 8, 16), material);
  ring.position.y = 0.3;
  group.add(ring);
  const shaft = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.55, 0.1), material);
  shaft.position.y = -0.12;
  group.add(shaft);
  for (const y of [-0.3, -0.18]) {
    const tooth = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.07, 0.1), material);
    tooth.position.set(0.12, y, 0);
    group.add(tooth);
  }
  return group;
};

/** Floating pickup with a soft glow halo; the halo is billboarded by the WorldView. */
export const buildPickup = (kind: Exclude<CollectibleKind, "coin">): THREE.Group => {
  const group = new THREE.Group();
  const halo = new THREE.Mesh(new THREE.PlaneGeometry(1.9, 1.9), additive(glowColors[kind], glowTexture(), 0.8));
  halo.name = "halo";
  group.add(halo);
  const builders: Record<Exclude<CollectibleKind, "coin">, () => THREE.Object3D> = {
    magnet: buildMagnet,
    jetpack: buildJetpack,
    sneakers: buildSneaker,
    multiplier: buildMultiplier,
    mysteryBox: buildMystery,
    key: buildKey,
  };
  const icon = builders[kind]();
  icon.name = "icon";
  group.add(icon);
  return group;
};
