// Renders a scripted "player performance" with the mannequin harness into an
// MJPEG file that Chromium can use as a fake webcam.
import { chromium } from "playwright";
import { writeFileSync } from "node:fs";

const FPS = 30;
const base = { x: 0, y: 0, lean: 0, crouch: 0, handsUp: false };
const smooth = (t) => t * t * (3 - 2 * t);
/** Timeline segments: [seconds, (progress 0..1) => pose]. */
const timeline = [
  [4.5, () => base],
  // Raise the right hand to chest height, then lower it…
  [0.9, () => ({ ...base, rightRaise: true })],
  [1.0, () => base],
  // …then the left hand.
  [0.9, () => ({ ...base, leftRaise: true })],
  [1.0, () => base],
  [0.2, (p) => ({ ...base, y: 0.3 * smooth(p) })],
  [0.15, () => ({ ...base, y: 0.3 })],
  [0.25, (p) => ({ ...base, y: 0.3 * (1 - smooth(p)) })],
  [1.2, () => base],
  [0.3, (p) => ({ ...base, crouch: 0.6 * smooth(p) })],
  [0.6, () => ({ ...base, crouch: 0.6 })],
  [0.3, (p) => ({ ...base, crouch: 0.6 * (1 - smooth(p)) })],
  [1.2, () => base],
  [0.9, () => ({ ...base, handsUp: true })],
  [1.5, () => base],
  // Walk out of frame (tracking lost), then come back and stand still.
  [3.0, () => ({ ...base, x: 4 })],
  [3.0, () => base],
];

/**
 * Renders the timeline with the mannequin harness page into an MJPEG file.
 *
 * @param baseUrl - Origin of a running dev server that serves e2e/pose-harness.html
 * @param outPath - Where to write the .mjpeg
 */
export async function renderPerformance(baseUrl, outPath) {
  const browser = await chromium.launch({ args: [...(process.platform === "darwin" ? ["--use-angle=metal"] : []), "--ignore-gpu-blocklist"] });
  const page = await browser.newPage();
  await page.goto(new URL("e2e/pose-harness.html", baseUrl).href);
  await page.waitForFunction(() => window.harness);
  const chunks = [];
  let frames = 0;
  for (const [seconds, poseAt] of timeline) {
    const count = Math.round(seconds * FPS);
    for (let i = 0; i < count; i++) {
      const dataUrl = await page.evaluate((p) => window.harness.render(p), poseAt(count > 1 ? i / (count - 1) : 1));
      chunks.push(Buffer.from(dataUrl.split(",")[1], "base64"));
      frames++;
    }
  }
  writeFileSync(outPath, Buffer.concat(chunks));
  await browser.close();
  return frames;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const out = new URL("./artifacts/performance.mjpeg", import.meta.url).pathname;
  const frames = await renderPerformance(process.argv[2] ?? "http://localhost:5173/", out);
  console.log(`wrote ${frames} frames (${(frames / FPS).toFixed(1)} s) to ${out}`);
}
