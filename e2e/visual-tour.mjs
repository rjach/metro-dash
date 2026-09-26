// Captures every key screen and game state for design review:
//   node e2e/visual-tour.mjs            (starts its own dev server)
// Screenshots land in e2e/artifacts/tour-*.png
import { chromium } from "playwright";
import { createServer } from "vite";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const out = fileURLToPath(new URL("./artifacts/", import.meta.url));
mkdirSync(out, { recursive: true });
const server = await createServer({ root, logLevel: "error", server: { port: 5198, strictPort: true } });
await server.listen();
const BASE = "http://localhost:5198/";

const stage = (page) =>
  page.evaluate(() => {
    const s = window.__METRO_DASH__.session;
    const z = s.player.z;
    s.world.clear();
    s.generator.update = () => {};
    s.world.addObstacle({ kind: "ramp", lane: -1, z: z + 22, variant: 1 });
    s.world.addObstacle({ kind: "train", lane: -1, z: z + 30.5, length: 22, variant: 1 });
    s.world.addObstacle({ kind: "train", lane: 1, z: z + 16, length: 33, variant: 2 });
    s.world.addObstacle({ kind: "barrierLow", lane: 0, z: z + 20 });
    s.world.addObstacle({ kind: "barrierHigh", lane: 0, z: z + 42 });
    s.world.addObstacle({ kind: "movingTrain", lane: 0, z: z + 110, length: 22, speed: 11, variant: 0 });
    for (let i = 0; i < 8; i++) s.world.addCollectible("coin", 0, 0.9, z + 6 + i * 3.2);
    s.world.addCollectible("magnet", -2.5, 1.05, z + 12);
    s.world.addCollectible("mysteryBox", -2.5, 1.05, z + 17);
  });

async function tour(name, viewport) {
  const browser = await chromium.launch({
    args: [
      ...(process.platform === "darwin" ? ["--use-angle=metal"] : []),
      "--ignore-gpu-blocklist",
      "--use-fake-ui-for-media-stream",
      "--use-fake-device-for-media-stream",
    ],
  });
  const context = await browser.newContext({ viewport, permissions: ["camera"], hasTouch: viewport.width < viewport.height });
  const page = await context.newPage();
  await page.goto(BASE);
  await page.waitForFunction(() => window.__METRO_DASH__ !== undefined);
  await page.evaluate(() =>
    window.__METRO_DASH__.save.update((d) => {
      d.coins = 12000;
      d.tutorialSeen = true;
    }),
  );
  const shot = async (label) => {
    await page.waitForTimeout(650);
    await page.screenshot({ path: `${out}tour-${name}-${label}.png` });
  };
  const click = (selector) => page.locator(`.screen.visible ${selector} >> visible=true`).first().click({ force: true });
  await shot("01-menu");
  for (const [button, label] of [
    ["Runners", "02-runners"],
    ["Boards", "03-boards"],
    ["Shop", "04-shop"],
  ]) {
    await click(`button[aria-label='${button}']`);
    await shot(label);
    await click("button[aria-label='Back']");
  }
  await click("button[aria-label='Settings']");
  await shot("05-settings");
  await click(".settings .btn.green");
  await click(".mode-toggle button:nth-child(2)");
  await page.waitForTimeout(1500);
  await shot("06-camera-setup");
  await click("button:has-text('Use keyboard')");
  await page.locator(".tap-to-play").click({ force: true });
  await page.waitForTimeout(1300);
  await stage(page);
  await shot("07-run");
  await page.evaluate(() => {
    const s = window.__METRO_DASH__.session;
    s.world.addCollectible("jetpack", s.player.x, 1, s.player.z + 2);
  });
  await page.waitForTimeout(1200);
  await shot("08-jetpack");
  await page.keyboard.press("Escape");
  await shot("09-pause");
  await click(".btn.green:has-text('Resume')");
  await page.waitForTimeout(3300);
  await page.evaluate(() => {
    const app = window.__METRO_DASH__;
    app.save.update((d) => (d.keys = 0));
    const s = app.session;
    s.powerUps.clear();
    s.player.flying = false;
    s.world.clear();
    s.world.addObstacle({ kind: "block", lane: s.player.lane, z: s.player.z + 14 });
  });
  await page.waitForTimeout(3200);
  await shot("10-results");
  await browser.close();
}

await tour("landscape", { width: 1280, height: 720 });
await tour("portrait", { width: 390, height: 844 });
await server.close();
console.log(`screenshots written to ${out}`);
