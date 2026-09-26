/** Messages exchanged between the main thread and the pose Web Worker. */
export type ToPoseWorker = { type: "init"; assetBase: string } | { type: "frame"; bitmap: ImageBitmap; timestamp: number };

export type FromPoseWorker =
  | { type: "ready"; backend: string }
  | { type: "error"; message: string }
  /** 33 landmarks packed as [x, y, z, visibility] × 33, or null when no person was found. */
  | { type: "result"; landmarks: Float32Array | null; timestamp: number };

export const LANDMARK_COUNT = 33;
