import * as THREE from "three";
import {
  ballastSet,
  carbonSet,
  coinFaceSet,
  concreteSet,
  curtainWallSet,
  denimSet,
  fabricSet,
  facadeSet,
  hairSet,
  ribbedSteelSet,
  rustSet,
  treadPlateSet,
  type PbrSet,
} from "./pbrTextures";

/**
 * Physically based material library. Every surface in the game uses
 * MeshStandard/MeshPhysical materials lit by the sky environment map, so
 * metal, glass, paint, fabric and skin respond believably to light.
 * Materials are cached and shared by every pooled mesh.
 */
const cache = new Map<string, THREE.Material>();

const memo = <T extends THREE.Material>(key: string, create: () => T): T => {
  const existing = cache.get(key);
  if (existing) return existing as T;
  const material = create();
  cache.set(key, material);
  return material;
};

/** Applies a PBR texture set with a UV repeat (clones share the painted source image). */
const withSet = (set: PbrSet, repeat: [number, number] = [1, 1]): Partial<THREE.MeshStandardMaterialParameters> => {
  const tiled = <T extends THREE.Texture | undefined>(texture: T): T => {
    if (!texture || (repeat[0] === 1 && repeat[1] === 1)) return texture;
    const clone = texture.clone() as T & THREE.Texture;
    clone.repeat.set(repeat[0], repeat[1]);
    clone.needsUpdate = true;
    return clone;
  };
  return {
    map: tiled(set.map),
    ...(set.normalMap ? { normalMap: tiled(set.normalMap) } : {}),
    ...(set.roughnessMap ? { roughnessMap: tiled(set.roughnessMap) } : {}),
    ...(set.metalnessMap ? { metalnessMap: tiled(set.metalnessMap) } : {}),
    ...(set.emissiveMap ? { emissiveMap: tiled(set.emissiveMap) } : {}),
  };
};

export const standard = (key: string, params: THREE.MeshStandardMaterialParameters): THREE.MeshStandardMaterial =>
  memo(`std:${key}`, () => new THREE.MeshStandardMaterial(params));

export const physical = (key: string, params: THREE.MeshPhysicalMaterialParameters): THREE.MeshPhysicalMaterial =>
  memo(`phys:${key}`, () => new THREE.MeshPhysicalMaterial(params));

/** Painted/coated surface of a given colour. */
export const paint = (color: THREE.ColorRepresentation, roughness = 0.55, metalness = 0): THREE.MeshStandardMaterial =>
  standard(`paint:${String(color)}:${roughness}:${metalness}`, { color, roughness, metalness });

/** Unlit glowing surface (lamps, signals, LEDs) — picked up by bloom. */
export const emissive = (color: THREE.ColorRepresentation, intensity = 1): THREE.MeshStandardMaterial =>
  standard(`emissive:${String(color)}:${intensity}`, { color: "#000000", emissive: color, emissiveIntensity: intensity * 15, roughness: 0.4 });

export const additive = (color: THREE.ColorRepresentation, map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial =>
  memo(
    `add:${String(color)}:${map.uuid}:${opacity}`,
    () => new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );

export const transparent = (map: THREE.Texture, opacity = 1, key = ""): THREE.MeshBasicMaterial =>
  memo(`transparent:${map.uuid}:${opacity}:${key}`, () => new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false }));

// ─── Compatibility helpers (map old flat-shaded calls onto PBR) ──────────────

export const lambert = (color: THREE.ColorRepresentation, map?: THREE.Texture, key = ""): THREE.MeshStandardMaterial =>
  standard(`lambert:${key}:${String(color)}:${map?.uuid ?? ""}`, { color, map: map ?? null, roughness: 0.85 });

export const phong = (color: THREE.ColorRepresentation, shininess = 60, map?: THREE.Texture): THREE.MeshStandardMaterial =>
  standard(`phong:${String(color)}:${shininess}:${map?.uuid ?? ""}`, {
    color,
    map: map ?? null,
    roughness: Math.max(0.12, 1 - shininess / 130),
    metalness: 0.35,
  });

export const toon = (color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshStandardMaterial =>
  standard(`toon:${String(color)}:${map?.uuid ?? ""}`, { color, map: map ?? null, roughness: 0.7 });

// ─── Named surfaces ──────────────────────────────────────────────────────────

export const MATERIALS = {
  ballast: () => standard("ballast", { ...withSet(ballastSet()), roughness: 1, color: "#ffffff" }),
  concrete: (tone = 0, repeat: [number, number] = [1, 1], panels = true) =>
    standard(`concrete:${tone}:${repeat.join("x")}:${panels}`, { ...withSet(concreteSet(tone, panels), repeat), roughness: 1, color: "#ffffff" }),
  sleeper: () => standard("sleeper", { ...withSet(concreteSet(1, false), [0.4, 0.2]), roughness: 0.95, color: "#b8b4ad" }),
  railHead: () => standard("rail-head", { color: "#c8ccd1", metalness: 1, roughness: 0.22 }),
  railBody: () => standard("rail-body", { ...withSet(rustSet(), [2, 0.3]), roughness: 0.85, metalness: 0.3, color: "#ffffff" }),
  steel: (color: THREE.ColorRepresentation = "#8a9097", roughness = 0.4) => standard(`steel:${String(color)}:${roughness}`, { color, metalness: 1, roughness }),
  galvanised: () => standard("galvanised", { color: "#9ea4aa", metalness: 0.85, roughness: 0.5 }),
  rust: () => standard("rust", { ...withSet(rustSet()), roughness: 0.9, metalness: 0.2, color: "#ffffff" }),
  darkMetal: () => standard("dark-metal", { color: "#2a2d31", metalness: 0.7, roughness: 0.55 }),
  rubber: () => standard("rubber", { color: "#1b1c1e", roughness: 0.9 }),
  glass: () => physical("glass", { color: "#1d2a33", metalness: 0.1, roughness: 0.04, clearcoat: 1, clearcoatRoughness: 0.05, envMapIntensity: 1.6 }),
  trainBody: () => standard("train-body", { ...withSet(ribbedSteelSet(), [8, 1]), metalness: 0.9, roughness: 0.38, color: "#ffffff", envMapIntensity: 1.2 }),
  trainPaint: (color: THREE.ColorRepresentation) =>
    physical(`train-paint:${String(color)}`, { color, metalness: 0.2, roughness: 0.3, clearcoat: 0.7, clearcoatRoughness: 0.2 }),
  underframe: () => standard("underframe", { color: "#26282b", metalness: 0.6, roughness: 0.75 }),
  treadPlate: () => standard("tread-plate", { ...withSet(treadPlateSet(), [2, 4]), metalness: 0.85, roughness: 0.5, color: "#ffffff" }),
  facade: (variant: number, repeat: [number, number]) =>
    standard(`facade:${variant}:${repeat.join("x")}`, {
      ...withSet(facadeSet(variant), repeat),
      color: "#ffffff",
      roughness: 1,
      emissive: "#ffffff",
      emissiveIntensity: 0.9,
      envMapIntensity: 1.1,
    }),
  curtainWall: (variant: number, repeat: [number, number]) =>
    standard(`curtain:${variant}:${repeat.join("x")}`, {
      ...withSet(curtainWallSet(variant), repeat),
      color: "#ffffff",
      roughness: 1,
      metalness: 0.75,
      envMapIntensity: 1.1,
    }),
  gold: () => standard("gold", { ...withSet(coinFaceSet()), color: "#ffffff", metalness: 1, roughness: 0.22, envMapIntensity: 1.6 }),
  goldRim: () => standard("gold-rim", { color: "#f3b73b", metalness: 1, roughness: 0.28, envMapIntensity: 1.6 }),
  carbon: () =>
    physical("carbon", { ...withSet(carbonSet(), [3, 1]), color: "#ffffff", roughness: 0.35, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 }),
  foliage: (color: THREE.ColorRepresentation) => standard(`foliage:${String(color)}`, { color, roughness: 0.85, flatShading: true }),
  bark: () => standard("bark", { color: "#4b3a2c", roughness: 0.95 }),
  grass: () => standard("grass", { color: "#58703a", roughness: 1 }),
  skin: (color: THREE.ColorRepresentation) =>
    physical(`skin:${String(color)}`, {
      color,
      roughness: 0.52,
      sheen: 0.35,
      sheenRoughness: 0.6,
      sheenColor: new THREE.Color("#ff9a80"),
      clearcoat: 0.08,
      clearcoatRoughness: 0.5,
    }),
  fabric: (color: string) =>
    physical(`fabric:${color}`, {
      ...withSet(fabricSet(color), [4, 4]),
      color: "#ffffff",
      roughness: 0.9,
      sheen: 0.5,
      sheenRoughness: 0.8,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.4),
    }),
  denim: (color: string) =>
    physical(`denim:${color}`, {
      ...withSet(denimSet(color), [5, 5]),
      color: "#ffffff",
      roughness: 0.92,
      sheen: 0.3,
      sheenRoughness: 0.9,
      sheenColor: new THREE.Color("#9fb4d6"),
    }),
  leather: (color: string) => physical(`leather:${color}`, { color, roughness: 0.45, clearcoat: 0.4, clearcoatRoughness: 0.35 }),
  hair: (color: string) =>
    physical(`hair:${color}`, {
      ...withSet(hairSet(color), [3, 3]),
      color: "#ffffff",
      roughness: 0.55,
      sheen: 0.6,
      sheenRoughness: 0.35,
      sheenColor: new THREE.Color(color).lerp(new THREE.Color("#ffffff"), 0.5),
    }),
  eyeWhite: () => physical("eye-white", { color: "#f4f1ea", roughness: 0.1, clearcoat: 1, clearcoatRoughness: 0.02 }),
  iris: (color: THREE.ColorRepresentation) => physical(`iris:${String(color)}`, { color, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.02 }),
  plastic: (color: THREE.ColorRepresentation) => physical(`plastic:${String(color)}`, { color, roughness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.2 }),
  reflective: (color: THREE.ColorRepresentation) =>
    standard(`reflective:${String(color)}`, { color, roughness: 0.25, metalness: 0.1, emissive: color, emissiveIntensity: 0.12 }),
};

export const disposeMaterials = () => {
  for (const material of cache.values()) material.dispose();
  cache.clear();
};
