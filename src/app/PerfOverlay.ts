import type { GameSession } from "../game/GameSession";
import type { CameraInput } from "../input/camera/CameraInput";
import type { GameRenderer } from "../render/GameRenderer";
import { h } from "../ui/dom";

const REFRESH_SECONDS = 0.5;

/** Optional on-screen performance readout (Settings → Show performance stats). */
export class PerfOverlay {
  readonly root = h("div", { class: "fps", "aria-hidden": "true" });
  private fps = 60;
  private timer = 0;

  constructor(
    private readonly renderer: GameRenderer,
    private readonly session: GameSession,
    private readonly camera: CameraInput,
  ) {}

  setVisible(visible: boolean): void {
    this.root.hidden = !visible;
  }

  update(dt: number): void {
    if (this.root.hidden) return;
    this.fps = this.fps * 0.95 + (dt > 0 ? 1 / dt : 60) * 0.05;
    this.timer -= dt;
    if (this.timer > 0) return;
    this.timer = REFRESH_SECONDS;
    const info = this.renderer.info;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory;
    this.root.textContent = [
      `${this.fps.toFixed(0)} fps · ${info.calls} draws · ${(info.triangles / 1000).toFixed(0)}k tris`,
      `geo ${info.geometries} · tex ${info.textures} · entities ${this.session.obstacles.length + this.session.collectibles.length}`,
      heap ? `heap ${(heap.usedJSHeapSize / 1048576).toFixed(0)} MB` : "",
      this.camera.enabled ? `camera ${this.camera.status.state}` : "",
    ]
      .filter(Boolean)
      .join("\n");
  }
}
