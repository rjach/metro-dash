import type * as THREE from "three";

/**
 * Shared uniforms for the "curved horizon" effect: the world bends down and
 * sideways with distance from the camera, the genre's signature look. Every
 * scene material is patched with the same vertex transform.
 */
export const curveUniforms = {
  uCurveY: { value: 0.0013 },
  uCurveX: { value: 0 },
};

const CURVE_VERTEX = /* glsl */ `
  vec4 mvPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    mvPosition = batchingMatrix * mvPosition;
  #endif
  #ifdef USE_INSTANCING
    mvPosition = instanceMatrix * mvPosition;
  #endif
  vec4 curvedWorld = modelMatrix * mvPosition;
  float curveDistance = min(0.0, curvedWorld.z - cameraPosition.z + 4.0);
  float curveSq = curveDistance * curveDistance;
  curvedWorld.y -= uCurveY * curveSq;
  curvedWorld.x += uCurveX * curveSq;
  mvPosition = viewMatrix * curvedWorld;
  gl_Position = projectionMatrix * mvPosition;
`;

const patched = new WeakSet<THREE.Material>();

/** Injects the curve transform into a built-in material (idempotent). */
export const curved = <T extends THREE.Material>(material: T): T => {
  if (patched.has(material)) return material;
  patched.add(material);
  const previous = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previous?.call(material, shader, renderer);
    shader.uniforms.uCurveY = curveUniforms.uCurveY;
    shader.uniforms.uCurveX = curveUniforms.uCurveX;
    shader.vertexShader = shader.vertexShader
      .replace("#include <common>", "#include <common>\nuniform float uCurveY;\nuniform float uCurveX;")
      .replace("#include <project_vertex>", CURVE_VERTEX);
  };
  const previousKey = material.customProgramCacheKey.bind(material);
  material.customProgramCacheKey = () => `${previousKey()}|curved`;
  return material;
};
