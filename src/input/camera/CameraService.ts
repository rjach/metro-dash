export type CameraErrorKind =
  "unsupported" | "insecure-context" | "permission-denied" | "not-found" | "in-use" | "overconstrained" | "model-load-failed" | "stream-ended" | "unknown";

export class CameraError extends Error {
  constructor(
    readonly kind: CameraErrorKind,
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = "CameraError";
  }
}

/** Maps browser getUserMedia failures to actionable categories for the UI. */
export const classifyCameraError = (error: unknown): CameraError => {
  if (error instanceof CameraError) return error;
  const name = error instanceof DOMException || error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  switch (name) {
    case "NotAllowedError":
    case "PermissionDeniedError":
    case "SecurityError":
      return new CameraError("permission-denied", `Camera permission was denied (${name}): ${message}`, error);
    case "NotFoundError":
    case "DevicesNotFoundError":
      return new CameraError("not-found", `No camera was found (${name}): ${message}`, error);
    case "NotReadableError":
    case "TrackStartError":
    case "AbortError":
      return new CameraError("in-use", `The camera is busy or could not start (${name}): ${message}`, error);
    case "OverconstrainedError":
    case "ConstraintNotSatisfiedError":
      return new CameraError("overconstrained", `The camera does not support the requested mode (${name}): ${message}`, error);
    default:
      return new CameraError("unknown", `Camera failed to start: ${name || "Error"} ${message}`, error);
  }
};

const PREFERRED: MediaStreamConstraints = {
  audio: false,
  video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30, max: 30 } },
};

/**
 * Owns the webcam stream. The stream is attached to a local <video> element
 * only; frames are consumed on-device by the pose model and never uploaded.
 */
export class CameraService {
  readonly video: HTMLVideoElement;
  private stream: MediaStream | null = null;
  private endedHandler: (() => void) | null = null;

  constructor(private readonly media: MediaDevices | undefined = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined) {
    this.video = document.createElement("video");
    this.video.playsInline = true;
    this.video.muted = true;
    this.video.autoplay = true;
    this.video.setAttribute("aria-hidden", "true");
  }

  /** True when the browser reports camera permission as already granted (no prompt needed). */
  static async permissionGranted(): Promise<boolean> {
    try {
      const status = await navigator.permissions?.query({ name: "camera" as PermissionName });
      return status?.state === "granted";
    } catch {
      // Firefox and older Safari do not expose "camera" to the Permissions API.
      return false;
    }
  }

  get active(): boolean {
    return this.stream !== null && this.stream.getVideoTracks().some((track) => track.readyState === "live");
  }

  /** Called when the camera stops unexpectedly (unplugged, revoked, taken by another app). */
  onEnded(handler: () => void): void {
    this.endedHandler = handler;
  }

  async start(): Promise<HTMLVideoElement> {
    if (this.active) return this.video;
    if (typeof window !== "undefined" && !window.isSecureContext) {
      throw new CameraError("insecure-context", "Camera access requires HTTPS or localhost.");
    }
    if (!this.media?.getUserMedia) throw new CameraError("unsupported", "This browser does not support camera access.");
    let stream: MediaStream;
    try {
      stream = await this.media.getUserMedia(PREFERRED);
    } catch (error) {
      const classified = classifyCameraError(error);
      if (classified.kind !== "overconstrained") throw classified;
      try {
        stream = await this.media.getUserMedia({ audio: false, video: true });
      } catch (retryError) {
        throw classifyCameraError(retryError);
      }
    }
    this.stream = stream;
    for (const track of stream.getVideoTracks()) {
      track.addEventListener("ended", () => {
        if (this.stream === stream) {
          this.stop();
          this.endedHandler?.();
        }
      });
    }
    this.video.srcObject = stream;
    try {
      await this.video.play();
    } catch {
      // Autoplay of a muted inline video is always allowed; a rejection here is benign.
    }
    await this.waitForFrames();
    return this.video;
  }

  stop(): void {
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
    this.video.srcObject = null;
  }

  private waitForFrames(): Promise<void> {
    if (this.video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && this.video.videoWidth > 0) return Promise.resolve();
    return new Promise((resolve) => {
      const done = () => {
        this.video.removeEventListener("loadeddata", done);
        resolve();
      };
      this.video.addEventListener("loadeddata", done);
      setTimeout(done, 3000);
    });
  }
}
