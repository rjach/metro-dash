import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

/**
 * Collapses a static hierarchy into one mesh per material. Scenery chunks and
 * obstacles are built from dozens of primitives; batching them cuts draw calls
 * by an order of magnitude. Multi-material and instanced meshes are kept as-is.
 */
export const mergeByMaterial = (root: THREE.Object3D): THREE.Group => {
  root.updateMatrixWorld(true);
  const toRoot = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const buckets = new Map<THREE.Material, THREE.BufferGeometry[]>();
  const kept: THREE.Object3D[] = [];
  const relative = new THREE.Matrix4();

  root.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    relative.multiplyMatrices(toRoot, object.matrixWorld);
    if (object instanceof THREE.InstancedMesh || Array.isArray(object.material)) {
      const copy = object.clone();
      copy.matrixAutoUpdate = false;
      copy.matrix.copy(relative);
      kept.push(copy);
      return;
    }
    let geometry = object.geometry.clone();
    geometry.applyMatrix4(relative);
    if (geometry.index) geometry = geometry.toNonIndexed();
    for (const name of Object.keys(geometry.attributes)) {
      if (name !== "position" && name !== "normal" && name !== "uv") geometry.deleteAttribute(name);
    }
    if (!geometry.attributes.uv) {
      const count = geometry.attributes.position!.count;
      geometry.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(count * 2), 2));
    }
    const material = object.material as THREE.Material;
    const bucket = buckets.get(material);
    if (bucket) bucket.push(geometry);
    else buckets.set(material, [geometry]);
  });

  const merged = new THREE.Group();
  for (const [material, geometries] of buckets) {
    const combined = mergeGeometries(geometries, false);
    geometries.forEach((geometry) => geometry.dispose());
    if (!combined) continue;
    combined.computeBoundingSphere();
    const mesh = new THREE.Mesh(combined, material);
    // Opaque scenery casts and receives sun shadows; glows and decals do neither.
    const opaque = !material.transparent;
    mesh.castShadow = opaque;
    mesh.receiveShadow = opaque;
    merged.add(mesh);
  }
  for (const object of kept) merged.add(object);
  return merged;
};

/**
 * Scales a BoxGeometry's UVs so a repeating texture keeps a constant
 * real-world size on every face (e.g. building windows stay the same size
 * regardless of building dimensions).
 */
export const worldScaleBoxUVs = (geometry: THREE.BoxGeometry, unitU: number, unitV: number): THREE.BoxGeometry => {
  const { width, height, depth } = geometry.parameters;
  const uv = geometry.attributes.uv as THREE.BufferAttribute;
  // Face order: +x, -x, +y, -y, +z, -z; each face has (widthSegments+1)*(heightSegments+1) vertices.
  const faceSizes: [number, number][] = [
    [depth, height],
    [depth, height],
    [width, depth],
    [width, depth],
    [width, height],
    [width, height],
  ];
  const perFace = uv.count / 6;
  for (let face = 0; face < 6; face++) {
    const [u, v] = faceSizes[face]!;
    for (let i = face * perFace; i < (face + 1) * perFace; i++) {
      uv.setXY(i, uv.getX(i) * (u / unitU), uv.getY(i) * (v / unitV));
    }
  }
  uv.needsUpdate = true;
  return geometry;
};
