import { EventBus } from "../../core/EventBus";
import type { CalibrationProfile, LaneGesture } from "../../persistence/SaveData";
import type { Emit, InputSource } from "../InputManager";
import { extractFeatures, type BodyFeatures, type Landmark } from "./BodyFeatures";
import { Calibrator, type CalibrationProgress } from "./Calibrator";
import { CameraError, classifyCameraError, type CameraService } from "./CameraService";
import { GestureRecognizer, type GestureSnapshot } from "./GestureRecognizer";
import type { PoseEstimator } from "./PoseEstimator";

export type CameraStatus =
  { state: "off" } | { state: "starting" } | { state: "loading-model" } | { state: "running"; backend: string } | { state: "error"; error: CameraError };

export interface CameraFrame {
  landmarks: Landmark[] | null;
  features: BodyFeatures | null;
  snapshot: GestureSnapshot | null;
  inferenceMs: number;
  fps: number;
}

export interface CameraEvents {
  status: CameraStatus;
  frame: CameraFrame;
  calibration: CalibrationProgress;
  tracking: { tracking: boolean };
  gesture: { action: string };
}

/** Minimum time between pose inferences (~30 Hz): plenty for gestures, light on the GPU. */
const MIN_INFERENCE_INTERVAL_MS = 30;

/**
 * Camera gesture input. Owns the webcam, the on-device pose model, the
 * calibration flow and the gesture state machine, and emits the same
 * GameActions as the keyboard.
 */
export class CameraInput implements InputSource {
  readonly id = "camera" as const;
  readonly events = new EventBus<CameraEvents>();
  private statusValue: CameraStatus = { state: "off" };
  private readonly calibrator = new Calibrator();
  private recognizer: GestureRecognizer | null = null;
  private calibrating = false;
  private running = false;
  private frameHandle = 0;
  private lastInference = 0;
  private fps = 0;
  private lastFrameAt = 0;
  private tracking = false;
  private sensitivity = 1;
  private laneGesture: LaneGesture = "hands";
  private runToken = 0;
  private inferring = false;

  constructor(
    private readonly emit: Emit,
    private readonly camera: CameraService,
    private readonly estimator: PoseEstimator,
    profile: CalibrationProfile | null,
  ) {
    if (profile) this.recognizer = new GestureRecognizer(profile);
    this.recognizer?.setLaneMode(this.laneGesture);
    camera.onEnded(() => this.fail(new CameraError("stream-ended", "The camera stopped sending video (it may have been unplugged or used by another app).")));
  }

  get status(): CameraStatus {
    return this.statusValue;
  }

  get enabled(): boolean {
    return this.running;
  }

  /** Which inference path is active (e.g. "worker · GPU · full"). */
  get estimatorBackend(): string {
    return this.estimator.backend;
  }

  get video(): HTMLVideoElement {
    return this.camera.video;
  }

  get isCalibrated(): boolean {
    return this.recognizer !== null;
  }

  get isTracking(): boolean {
    return this.tracking;
  }

  get isCalibrating(): boolean {
    return this.calibrating;
  }

  setSensitivity(value: number): void {
    this.sensitivity = value;
    this.recognizer?.setSensitivity(value);
  }

  setLaneGesture(mode: LaneGesture): void {
    this.laneGesture = mode;
    this.recognizer?.setLaneMode(mode);
  }

  setProfile(profile: CalibrationProfile | null): void {
    this.recognizer = profile ? new GestureRecognizer(profile) : null;
    this.recognizer?.setSensitivity(this.sensitivity);
    this.recognizer?.setLaneMode(this.laneGesture);
  }

  /** Requests the camera, loads the model and starts processing frames. */
  async enable(): Promise<void> {
    if (this.running || this.statusValue.state === "starting" || this.statusValue.state === "loading-model") return;
    const token = ++this.runToken;
    try {
      this.setStatus({ state: "starting" });
      await this.camera.start();
      if (token !== this.runToken) return;
      this.setStatus({ state: "loading-model" });
      await this.estimator.load();
      if (token !== this.runToken) return;
      this.running = true;
      this.setStatus({ state: "running", backend: this.estimator.backend });
      this.scheduleFrame();
    } catch (error) {
      if (token !== this.runToken) return;
      this.camera.stop();
      // Callers observe failures through `status`; nothing is thrown past this point.
      this.fail(error instanceof CameraError ? error : classifyCameraError(error));
    }
  }

  disable(): void {
    this.runToken++;
    this.running = false;
    this.calibrating = false;
    this.cancelFrame();
    this.camera.stop();
    this.recognizer?.reset();
    this.setTracking(false);
    this.setStatus({ state: "off" });
  }

  startCalibration(): void {
    this.calibrator.reset();
    this.calibrating = true;
  }

  cancelCalibration(): void {
    this.calibrating = false;
  }

  private fail(error: CameraError): void {
    this.running = false;
    this.calibrating = false;
    this.cancelFrame();
    this.setTracking(false);
    this.setStatus({ state: "error", error });
  }

  private setStatus(status: CameraStatus): void {
    this.statusValue = status;
    this.events.emit("status", status);
  }

  private setTracking(tracking: boolean): void {
    if (this.tracking === tracking) return;
    this.tracking = tracking;
    this.events.emit("tracking", { tracking });
  }

  private scheduleFrame(): void {
    if (!this.running) return;
    const video = this.camera.video;
    if ("requestVideoFrameCallback" in video) {
      this.frameHandle = video.requestVideoFrameCallback(() => this.processFrame());
    } else {
      this.frameHandle = requestAnimationFrame(() => this.processFrame());
    }
  }

  private cancelFrame(): void {
    const video = this.camera.video;
    if ("cancelVideoFrameCallback" in video) video.cancelVideoFrameCallback(this.frameHandle);
    cancelAnimationFrame(this.frameHandle);
  }

  private processFrame(): void {
    if (!this.running) return;
    const now = performance.now();
    // One inference in flight at a time: slow devices skip frames instead of building a backlog.
    if (!this.inferring && now - this.lastInference >= MIN_INFERENCE_INTERVAL_MS && this.camera.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
      this.lastInference = now;
      void this.infer(now);
    }
    this.scheduleFrame();
  }

  private async infer(now: number): Promise<void> {
    const token = this.runToken;
    this.inferring = true;
    let landmarks: Landmark[] | null;
    const started = performance.now();
    try {
      landmarks = await this.estimator.estimate(this.camera.video, now);
    } catch (error) {
      this.inferring = false;
      if (token === this.runToken) this.fail(new CameraError("model-load-failed", `Pose detection crashed: ${String(error)}`, error));
      return;
    }
    this.inferring = false;
    // The camera may have been switched off while the frame was being processed.
    if (!this.running || token !== this.runToken) return;
    const inferenceMs = performance.now() - started;
    if (this.lastFrameAt > 0) this.fps = this.fps * 0.9 + (1000 / Math.max(1, now - this.lastFrameAt)) * 0.1;
    this.lastFrameAt = now;

    const features = extractFeatures(landmarks);
    let snapshot: GestureSnapshot | null = null;

    if (this.calibrating) {
      const progress = this.calibrator.update(features, now);
      this.events.emit("calibration", progress);
      if (progress.status === "done" && progress.profile) {
        this.calibrating = false;
        this.setProfile(progress.profile);
      }
      this.setTracking(features !== null);
    } else if (this.recognizer) {
      const result = this.recognizer.update(features, now);
      snapshot = result.snapshot;
      this.setTracking(result.snapshot.tracking === "tracking");
      for (const action of result.actions) {
        this.events.emit("gesture", { action });
        this.emit("action", { action, source: "camera" });
      }
    } else {
      this.setTracking(features !== null);
    }
    this.events.emit("frame", { landmarks, features, snapshot, inferenceMs, fps: this.fps });
  }
}
