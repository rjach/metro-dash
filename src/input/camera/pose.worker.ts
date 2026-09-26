/// <reference lib="webworker" />
import { FilesetResolver, PoseLandmarker } from "@mediapipe/tasks-vision";
import { LANDMARK_COUNT, type FromPoseWorker, type ToPoseWorker } from "./poseProtocol";

/**
 * Runs MediaPipe pose inference off the main thread, so detection never
 * blocks rendering. Frames arrive as transferred ImageBitmaps; results go back
 * as packed Float32Arrays. The model runs on the GPU through an OffscreenCanvas
 * when available, otherwise on the CPU.
 */
const scope = self as unknown as DedicatedWorkerGlobalScope;
let landmarker: PoseLandmarker | null = null;
let lastTimestamp = -1;

const post = (message: FromPoseWorker, transfer: Transferable[] = []) => scope.postMessage(message, transfer);

const init = async (assetBase: string) => {
  const fileset = await FilesetResolver.forVisionTasks(`${assetBase}/wasm`, true);
  const attempts: ["full" | "lite", "GPU" | "CPU"][] = [
    ["full", "GPU"],
    ["lite", "GPU"],
    ["lite", "CPU"],
  ];
  let lastError: unknown = null;
  for (const [model, delegate] of attempts) {
    try {
      landmarker = await PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: `${assetBase}/pose_landmarker_${model}.task`, delegate },
        runningMode: "VIDEO",
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.55,
        minTrackingConfidence: 0.6,
        outputSegmentationMasks: false,
        ...(delegate === "GPU" ? { canvas: new OffscreenCanvas(1, 1) } : {}),
      });
      post({ type: "ready", backend: `worker · ${delegate} · ${model}` });
      return;
    } catch (error) {
      lastError = error;
    }
  }
  post({ type: "error", message: String(lastError) });
};

const detect = (bitmap: ImageBitmap, timestamp: number) => {
  if (!landmarker) {
    bitmap.close();
    return;
  }
  // MediaPipe requires strictly increasing timestamps in VIDEO mode.
  const ts = Math.max(timestamp, lastTimestamp + 1);
  lastTimestamp = ts;
  let packed: Float32Array | null = null;
  try {
    const result = landmarker.detectForVideo(bitmap, ts);
    const pose = result.landmarks[0];
    if (pose && pose.length >= LANDMARK_COUNT) {
      packed = new Float32Array(LANDMARK_COUNT * 4);
      for (let i = 0; i < LANDMARK_COUNT; i++) {
        const point = pose[i]!;
        packed.set([point.x, point.y, point.z, point.visibility ?? 0], i * 4);
      }
    }
  } finally {
    bitmap.close();
  }
  post({ type: "result", landmarks: packed, timestamp }, packed ? [packed.buffer] : []);
};

scope.onmessage = (event: MessageEvent<ToPoseWorker>) => {
  const message = event.data;
  if (message.type === "init") void init(message.assetBase);
  else detect(message.bitmap, message.timestamp);
};
