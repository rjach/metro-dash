import * as THREE from "three";
import { curved } from "./curve";

/**
 * Stylised material library with caching. Materials are shared across all
 * pooled meshes so the GPU compiles each shader variant once, and every one is
 * patched with the curved-world transform.
 */
const cache = new Map<string, THREE.Material>();

/** Four light bands: a soft cartoon read with a bright rim instead of harsh steps. */
const gradientMap = (() => {
  const data = new Uint8Array([70, 140, 210, 255]);
  const texture = new THREE.DataTexture(data, data.length, 1, THREE.RedFormat);
  texture.minFilter = THREE.NearestFilter;
  texture.magFilter = THREE.NearestFilter;
  texture.needsUpdate = true;
  return texture;
})();

const memo = <T extends THREE.Material>(key: string, create: () => T): T => {
  const existing = cache.get(key);
  if (existing) return existing as T;
  const material = curved(create());
  cache.set(key, material);
  return material;
};

export const lambert = (color: THREE.ColorRepresentation, map?: THREE.Texture, key?: string): THREE.MeshLambertMaterial =>
  memo(`lambert:${key ?? ""}:${String(color)}:${map?.uuid ?? ""}`, () => new THREE.MeshLambertMaterial({ color, map: map ?? null }));

/** Cel-shaded material for characters. */
export const toon = (color: THREE.ColorRepresentation, map?: THREE.Texture): THREE.MeshToonMaterial =>
  memo(`toon:${String(color)}:${map?.uuid ?? ""}`, () => new THREE.MeshToonMaterial({ color, map: map ?? null, gradientMap }));

export const phong = (color: THREE.ColorRepresentation, shininess = 60, map?: THREE.Texture): THREE.MeshPhongMaterial =>
  memo(
    `phong:${String(color)}:${shininess}:${map?.uuid ?? ""}`,
    () => new THREE.MeshPhongMaterial({ color, shininess, map: map ?? null, specular: "#555555" }),
  );

export const emissive = (color: THREE.ColorRepresentation, intensity = 1): THREE.MeshBasicMaterial =>
  memo(`basic:${String(color)}:${intensity}`, () => {
    const material = new THREE.MeshBasicMaterial({ color });
    material.color.multiplyScalar(intensity);
    return material;
  });

export const additive = (color: THREE.ColorRepresentation, map: THREE.Texture, opacity = 1): THREE.MeshBasicMaterial =>
  memo(
    `add:${String(color)}:${map.uuid}:${opacity}`,
    () => new THREE.MeshBasicMaterial({ color, map, transparent: true, opacity, depthWrite: false, blending: THREE.AdditiveBlending }),
  );

export const transparent = (map: THREE.Texture, opacity = 1, key = ""): THREE.MeshBasicMaterial =>
  memo(`transparent:${map.uuid}:${opacity}:${key}`, () => new THREE.MeshBasicMaterial({ map, transparent: true, opacity, depthWrite: false }));

export const disposeMaterials = () => {
  for (const material of cache.values()) material.dispose();
  cache.clear();
};
