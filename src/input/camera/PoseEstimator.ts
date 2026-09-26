import type * as Vision from "@mediapipe/tasks-vision";
import type { Landmark } from "./BodyFeatures";
import { CameraError } from "./CameraService";
import { LANDMARK_COUNT, type FromPoseWorker, type ToPoseWorker } from "./poseProtocol";

/** Anything that can turn a video frame into pose landmarks (swappable for tests). */
export interface PoseEstimator {
  load(): Promise<void>;
  /** Resolves with the landmarks for this frame, or null when no person was detected. */
  estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Promise<Landmark[] | null>;
  dispose(): void;
  readonly backend: string;
}

type PoseLandmarkerInstance = Awaited<ReturnType<typeof Vision.PoseLandmarker.createFromOptions>>;

const assetBase = () => new URL(`${import.meta.env.BASE_URL}mediapipe`, location.href).href.replace(/\/$/, "");

/** Frames are downscaled before inference; the model itself runs at 256×256. */
const INFERENCE_WIDTH = 384;
const INFERENCE_HEIGHT = 288;

/**
 * Pose inference in a dedicated Web Worker: the render loop never waits on the
 * model. Everything stays on-device — the runtime and model are served from
 * this app's own origin.
 */
export class WorkerPoseEstimator implements PoseEstimator {
  private worker: Worker | null = null;
  private loading: Promise<void> | null = null;
  private pending: ((landmarks: Landmark[] | null) => void) | null = null;
  backend = "none";

  static get supported(): boolean {
    return typeof Worker !== "undefined" && typeof OffscreenCanvas !== "undefined" && typeof createImageBitmap !== "undefined";
  }

  load(): Promise<void> {
    this.loading ??= new Promise<void>((resolve, reject) => {
      const worker = new Worker(new URL("./pose.worker.ts", import.meta.url), { type: "module", name: "pose" });
      this.worker = worker;
      worker.onmessage = (event: MessageEvent<FromPoseWorker>) => {
        const message = event.data;
        if (message.type === "ready") {
          this.backend = message.backend;
          resolve();
        } else if (message.type === "error") {
          reject(new CameraError("model-load-failed", `Pose model failed to load in the worker: ${message.message}`));
        } else {
          this.pending?.(message.landmarks ? unpack(message.landmarks) : null);
          this.pending = null;
        }
      };
      worker.onerror = (event) => reject(new CameraError("model-load-failed", `Pose worker crashed: ${event.message}`));
      worker.postMessage({ type: "init", assetBase: assetBase() } satisfies ToPoseWorker);
    }).catch((error: unknown) => {
      this.dispose();
      throw error;
    });
    return this.loading;
  }

  async estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Promise<Landmark[] | null> {
    const worker = this.worker;
    if (!worker || this.pending) return null;
    const bitmap = await createImageBitmap(frame, { resizeWidth: INFERENCE_WIDTH, resizeHeight: INFERENCE_HEIGHT, resizeQuality: "low" });
    return new Promise((resolve) => {
      this.pending = resolve;
      worker.postMessage({ type: "frame", bitmap, timestamp: timestampMs } satisfies ToPoseWorker, [bitmap]);
    });
  }

  dispose(): void {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.pending?.(null);
    this.pending = null;
  }
}

const unpack = (packed: Float32Array): Landmark[] => {
  const landmarks: Landmark[] = [];
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    landmarks.push({ x: packed[i * 4]!, y: packed[i * 4 + 1]!, z: packed[i * 4 + 2]!, visibility: packed[i * 4 + 3]! });
  }
  return landmarks;
};

/**
 * Main-thread MediaPipe Pose Landmarker: the fallback when Web Workers or
 * OffscreenCanvas are unavailable (and used directly by the test harness).
 * Uses the lite model first so inference steals as little frame time as possible.
 */
export class MediaPipePoseEstimator implements PoseEstimator {
  private landmarker: PoseLandmarkerInstance | null = null;
  private loading: Promise<void> | null = null;
  private lastTimestamp = -1;
  backend = "none";

  constructor(private readonly models: readonly ("full" | "lite")[] = ["lite", "full"]) {}

  load(): Promise<void> {
    this.loading ??= this.create().catch((error) => {
      this.loading = null;
      throw error instanceof CameraError ? error : new CameraError("model-load-failed", `Pose model failed to load: ${String(error)}`, error);
    });
    return this.loading;
  }

  async estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Promise<Landmark[] | null> {
    return this.estimateSync(frame, timestampMs);
  }

  estimateSync(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Landmark[] | null {
    if (!this.landmarker) return null;
    const timestamp = Math.max(timestampMs, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    return this.landmarker.detectForVideo(frame, timestamp).landmarks[0] ?? null;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.loading = null;
  }

  private async create(): Promise<void> {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(`${assetBase()}/wasm`);
    let lastError: unknown = null;
    for (const model of this.models) {
      for (const delegate of ["GPU", "CPU"] as const) {
        try {
          this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, {
            baseOptions: { modelAssetPath: `${assetBase()}/pose_landmarker_${model}.task`, delegate },
            runningMode: "VIDEO",
            numPoses: 1,
            minPoseDetectionConfidence: 0.5,
            minPosePresenceConfidence: 0.55,
            minTrackingConfidence: 0.6,
            outputSegmentationMasks: false,
          });
          this.backend = `${delegate} · ${model}`;
          return;
        } catch (error) {
          lastError = error;
        }
      }
    }
    throw lastError;
  }
}

/**
 * Picks the best estimator for this browser: off-thread when possible, with an
 * automatic fall back to the main thread if the worker fails to start.
 */
export class AdaptivePoseEstimator implements PoseEstimator {
  private active: PoseEstimator | null = null;

  get backend(): string {
    return this.active?.backend ?? "none";
  }

  async load(): Promise<void> {
    if (this.active) return this.active.load();
    if (WorkerPoseEstimator.supported) {
      const worker = new WorkerPoseEstimator();
      try {
        await worker.load();
        this.active = worker;
        return;
      } catch {
        worker.dispose();
      }
    }
    const fallback = new MediaPipePoseEstimator();
    await fallback.load();
    this.active = fallback;
  }

  estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Promise<Landmark[] | null> {
    return this.active ? this.active.estimate(frame, timestampMs) : Promise.resolve(null);
  }

  dispose(): void {
    this.active?.dispose();
    this.active = null;
  }
}
