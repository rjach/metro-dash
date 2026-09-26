// Copies MediaPipe WASM runtime into public/ and downloads the pose model once,
// so camera mode runs fully offline and no camera data ever leaves the browser.
import { copyFileSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const wasmSrc = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const wasmDest = join(root, "public/mediapipe/wasm");
// "full" is the accurate default; "lite" is the fallback for slow devices or a failed download.
const MODELS = ["full", "lite"].map((variant) => ({
  dest: join(root, `public/mediapipe/pose_landmarker_${variant}.task`),
  url: `https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_${variant}/float16/1/pose_landmarker_${variant}.task`,
}));

// Classic runtimes (main-thread fallback, with a no-SIMD build for older browsers) plus the ES-module
// runtime used by the pose Web Worker.
const WASM_FILES = [
  "vision_wasm_internal.js",
  "vision_wasm_internal.wasm",
  "vision_wasm_nosimd_internal.js",
  "vision_wasm_nosimd_internal.wasm",
  "vision_wasm_module_internal.js",
  "vision_wasm_module_internal.wasm",
];
if (existsSync(wasmSrc)) {
  rmSync(wasmDest, { recursive: true, force: true });
  mkdirSync(wasmDest, { recursive: true });
  for (const file of WASM_FILES) copyFileSync(join(wasmSrc, file), join(wasmDest, file));
}

for (const model of MODELS) {
  if (existsSync(model.dest)) continue;
  try {
    const response = await fetch(model.url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    mkdirSync(dirname(model.dest), { recursive: true });
    writeFileSync(model.dest, Buffer.from(await response.arrayBuffer()));
    console.log(`[setup-assets] downloaded ${model.dest}`);
  } catch (error) {
    console.warn(`[setup-assets] could not download ${model.url} (${error}); camera mode needs it at ${model.dest}`);
  }
}
