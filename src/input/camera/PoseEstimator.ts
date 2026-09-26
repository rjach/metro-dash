import type * as Vision from "@mediapipe/tasks-vision";
import type { Landmark } from "./BodyFeatures";
import { CameraError } from "./CameraService";

/** Anything that can turn a video frame into pose landmarks (swappable for tests). */
export interface PoseEstimator {
  load(): Promise<void>;
  estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Landmark[] | null;
  dispose(): void;
  readonly backend: string;
}

type PoseLandmarkerInstance = Awaited<ReturnType<typeof Vision.PoseLandmarker.createFromOptions>>;

const assetBase = () => `${import.meta.env.BASE_URL}mediapipe`;

/**
 * MediaPipe Pose Landmarker running fully in the browser (WebAssembly + WebGL).
 * The runtime and model are served from this app's own origin; no frame or
 * landmark ever leaves the device.
 */
export class MediaPipePoseEstimator implements PoseEstimator {
  private landmarker: PoseLandmarkerInstance | null = null;
  private loading: Promise<void> | null = null;
  private lastTimestamp = -1;
  backend = "none";

  load(): Promise<void> {
    this.loading ??= this.create().catch((error) => {
      this.loading = null;
      throw error instanceof CameraError ? error : new CameraError("model-load-failed", `Pose model failed to load: ${String(error)}`, error);
    });
    return this.loading;
  }

  estimate(frame: HTMLVideoElement | HTMLCanvasElement, timestampMs: number): Landmark[] | null {
    if (!this.landmarker) return null;
    // MediaPipe requires strictly increasing timestamps in VIDEO mode.
    const timestamp = Math.max(timestampMs, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;
    const result = this.landmarker.detectForVideo(frame, timestamp);
    return result.landmarks[0] ?? null;
  }

  dispose(): void {
    this.landmarker?.close();
    this.landmarker = null;
    this.loading = null;
  }

  private async create(): Promise<void> {
    const vision = await import("@mediapipe/tasks-vision");
    const fileset = await vision.FilesetResolver.forVisionTasks(`${assetBase()}/wasm`);
    const options = (model: "full" | "lite", delegate: "GPU" | "CPU") => ({
      baseOptions: { modelAssetPath: `${assetBase()}/pose_landmarker_${model}.task`, delegate },
      runningMode: "VIDEO" as const,
      numPoses: 1,
      minPoseDetectionConfidence: 0.5,
      minPosePresenceConfidence: 0.55,
      minTrackingConfidence: 0.6,
      outputSegmentationMasks: false,
    });
    // Most accurate first (full model on the GPU), degrading gracefully on weaker devices.
    const attempts: ["full" | "lite", "GPU" | "CPU"][] = [
      ["full", "GPU"],
      ["lite", "GPU"],
      ["lite", "CPU"],
    ];
    let lastError: unknown = null;
    for (const [model, delegate] of attempts) {
      try {
        this.landmarker = await vision.PoseLandmarker.createFromOptions(fileset, options(model, delegate));
        this.backend = `${delegate} · ${model}`;
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
  }
}
