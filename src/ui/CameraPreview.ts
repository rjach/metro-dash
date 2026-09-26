import type { CameraFrame, CameraInput } from "../input/camera/CameraInput";
import { LANDMARK, type Landmark } from "../input/camera/BodyFeatures";
import { h } from "./dom";

/** Skeleton edges drawn over the preview (MediaPipe pose indices). */
const BONES: [number, number][] = [
  [11, 12],
  [11, 13],
  [13, 15],
  [12, 14],
  [14, 16],
  [11, 23],
  [12, 24],
  [23, 24],
  [23, 25],
  [25, 27],
  [24, 26],
  [26, 28],
  [0, 11],
  [0, 12],
];

/**
 * Mirrored selfie preview with a live skeleton overlay. Drawing only happens
 * while mounted and visible, so it costs nothing when hidden.
 */
export class CameraPreview {
  readonly root: HTMLElement;
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private lastFrame: CameraFrame | null = null;
  private unsubscribe: (() => void) | null = null;
  private raf = 0;
  guide = false;

  /**
   * @param resolution - Backing canvas size; the small in-game PiP uses a quarter-size canvas to stay cheap.
   */
  constructor(
    private readonly camera: CameraInput,
    className: string,
    resolution: [number, number] = [640, 480],
  ) {
    this.canvas = h("canvas", { width: resolution[0], height: resolution[1], "aria-label": "Camera preview (mirrored)", role: "img" });
    const ctx = this.canvas.getContext("2d");
    if (!ctx) throw new Error("Canvas 2D context unavailable for the camera preview");
    this.ctx = ctx;
    this.root = h("div", { class: className }, this.canvas);
  }

  start(): void {
    if (this.unsubscribe) return;
    this.unsubscribe = this.camera.events.on("frame", (frame) => (this.lastFrame = frame));
    const loop = () => {
      this.draw();
      this.raf = requestAnimationFrame(loop);
    };
    this.raf = requestAnimationFrame(loop);
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    cancelAnimationFrame(this.raf);
  }

  private draw(): void {
    const { ctx, canvas } = this;
    const video = this.camera.video;
    const width = canvas.width;
    const height = canvas.height;
    ctx.save();
    ctx.clearRect(0, 0, width, height);
    // Mirror so the player sees themselves like in a mirror (their right is on the right).
    ctx.translate(width, 0);
    ctx.scale(-1, 1);
    if (video.readyState >= 2 && video.videoWidth > 0) {
      const scale = Math.max(width / video.videoWidth, height / video.videoHeight);
      const drawWidth = video.videoWidth * scale;
      const drawHeight = video.videoHeight * scale;
      ctx.drawImage(video, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
    } else {
      ctx.fillStyle = "#0b1a33";
      ctx.fillRect(0, 0, width, height);
    }
    ctx.restore();

    if (this.guide) this.drawGuide();
    const landmarks = this.lastFrame?.landmarks;
    if (landmarks) this.drawSkeleton(landmarks);
  }

  private drawGuide(): void {
    const { ctx, canvas } = this;
    const cx = canvas.width / 2;
    ctx.save();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.setLineDash([12, 10]);
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.ellipse(cx, canvas.height * 0.22, 42, 52, 0, 0, Math.PI * 2);
    ctx.moveTo(cx - 95, canvas.height * 0.4);
    ctx.lineTo(cx + 95, canvas.height * 0.4);
    ctx.lineTo(cx + 70, canvas.height * 0.82);
    ctx.lineTo(cx - 70, canvas.height * 0.82);
    ctx.closePath();
    ctx.stroke();
    ctx.restore();
  }

  private drawSkeleton(landmarks: readonly Landmark[]): void {
    const { ctx, canvas } = this;
    const video = this.camera.video;
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;
    const scale = Math.max(canvas.width / vw, canvas.height / vh);
    const offsetX = (canvas.width - vw * scale) / 2;
    const offsetY = (canvas.height - vh * scale) / 2;
    const project = (landmark: Landmark) => ({
      x: canvas.width - (landmark.x * vw * scale + offsetX),
      y: landmark.y * vh * scale + offsetY,
    });
    const snapshot = this.lastFrame?.snapshot;
    const color =
      !snapshot || snapshot.tracking === "lost" ? "#ffb81c" : snapshot.lateral !== "center" || snapshot.vertical !== "neutral" ? "#7cf6ff" : "#5ce65c";
    ctx.save();
    const unit = canvas.width / 640;
    ctx.lineWidth = 6 * unit;
    ctx.lineCap = "round";
    ctx.strokeStyle = color;
    ctx.shadowColor = "rgba(0,0,0,0.6)";
    ctx.shadowBlur = 6;
    for (const [a, b] of BONES) {
      const la = landmarks[a];
      const lb = landmarks[b];
      if (!la || !lb || (la.visibility ?? 0) < 0.5 || (lb.visibility ?? 0) < 0.5) continue;
      const pa = project(la);
      const pb = project(lb);
      ctx.beginPath();
      ctx.moveTo(pa.x, pa.y);
      ctx.lineTo(pb.x, pb.y);
      ctx.stroke();
    }
    ctx.fillStyle = "#ffffff";
    for (const index of [
      LANDMARK.nose,
      LANDMARK.leftShoulder,
      LANDMARK.rightShoulder,
      LANDMARK.leftHip,
      LANDMARK.rightHip,
      LANDMARK.leftWrist,
      LANDMARK.rightWrist,
    ]) {
      const landmark = landmarks[index];
      if (!landmark || (landmark.visibility ?? 0) < 0.5) continue;
      const point = project(landmark);
      ctx.beginPath();
      ctx.arc(point.x, point.y, 7 * unit, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }
}
