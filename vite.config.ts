import { defineConfig } from "vitest/config";

export default defineConfig({
  base: "./",
  build: {
    target: "es2022",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        // Three.js changes rarely; a separate chunk keeps it cached across game updates.
        manualChunks: (id: string) => (id.includes("node_modules/three/") ? "three" : undefined),
      },
    },
  },
  // MediaPipe ships its own wasm loader; pre-bundling it breaks its dynamic imports.
  optimizeDeps: { exclude: ["@mediapipe/tasks-vision"] },
  server: { host: true },
  // The pose worker is a module worker (MediaPipe's runtime is loaded with import()).
  worker: { format: "es" },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
  },
});
