// Measures real frame times at a retina-laptop resolution, keyboard and camera mode.
//   node e2e/perf-probe.mjs [url]
import { chromium } from "playwright";
import { existsSync } from "node:fs";

const url = process.argv[2] ?? "http://localhost:5173/";
const video = new URL("./artifacts/performance.mjpeg", import.meta.url).pathname;
const args = [
  ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
  "--ignore-gpu-blocklist",
  "--use-fake-ui-for-media-stream",
  "--use-fake-device-for-media-stream",
];
if (existsSync(video)) args.push(`--use-file-for-fake-video-capture=${video}`);
const browser = await chromium.launch({ args });
const context = await browser.newContext({ viewport: { width: 1512, height: 945 }, deviceScaleFactor: 2, permissions: ["camera"] });
const page = await context.newPage();
await page.goto(url);
await page.waitForFunction(() => window.__METRO_DASH__ !== undefined, null, { timeout: 60000 });
const sample = (seconds) =>
  page.evaluate(
    (seconds) =>
      new Promise((resolve) => {
        const frames = [];
        let last = performance.now();
        const t0 = last;
        const tick = (now) => {
          frames.push(now - last);
          last = now;
          if (now - t0 < seconds * 1000) requestAnimationFrame(tick);
          else {
            const sorted = [...frames].sort((a, b) => a - b);
            resolve({
              fps: +(1000 / (frames.reduce((a, b) => a + b, 0) / frames.length)).toFixed(1),
              p95: +sorted[Math.floor(sorted.length * 0.95)].toFixed(1),
              worst: +sorted[sorted.length - 1].toFixed(1),
            });
          }
        };
        requestAnimationFrame(tick);
      }),
    seconds,
  );
const keepAlive = () =>
  page.evaluate(() => {
    const s = window.__METRO_DASH__.session;
    const update = s.update.bind(s);
    s.update = (dt) => {
      s.world.obstacles.length = 0;
      update(dt);
    };
  });
await page.evaluate(() => window.__METRO_DASH__.save.update((d) => (d.tutorialSeen = true)));
await page.waitForTimeout(1500);
console.log("menu      ", JSON.stringify(await sample(4)));
await page.keyboard.press("Enter");
await keepAlive();
await page.waitForTimeout(1500);
console.log("run (kbd) ", JSON.stringify(await sample(6)));
await page.keyboard.press("Escape");
await page.evaluate(() => window.__METRO_DASH__.quitToMenu());
await page.locator(".screen.visible .mode-toggle button:nth-child(2)").first().click();
await page.waitForTimeout(800);
if ((await page.evaluate(() => window.__METRO_DASH__.debugState().camera)) === "off")
  await page.locator(".screen.visible .cam-side .btn.green").first().click();
await page.waitForFunction(() => window.__METRO_DASH__.debugState().save.calibration !== null, null, { timeout: 40000 }).catch(() => {});
await page
  .locator(".screen.visible .cam-side .btn.green.big")
  .first()
  .click()
  .catch(() => {});
await page.waitForTimeout(4000);
await keepAlive();
console.log(
  "run (cam) ",
  JSON.stringify(await sample(6)),
  "camera:",
  await page.evaluate(() => window.__METRO_DASH__.debugState().camera),
  "backend:",
  await page.evaluate(() => window.__METRO_DASH__.camera.estimatorBackend),
);
console.log("render    ", JSON.stringify(await page.evaluate(() => window.__METRO_DASH__.debugState().renderer)));
await browser.close();
