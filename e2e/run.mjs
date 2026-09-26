// End-to-end suite: `npm run e2e` (starts its own Vite dev server).
// Each test gets a fresh browser context (fresh localStorage) unless noted.
import { chromium } from "playwright";
import { createServer } from "vite";
import { renderPerformance } from "./make-performance.mjs";
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const artifacts = fileURLToPath(new URL("./artifacts/", import.meta.url));
mkdirSync(artifacts, { recursive: true });
const performanceVideo = `${artifacts}performance.mjpeg`;

const server = await createServer({ root, logLevel: "error", server: { port: 5199, strictPort: true } });
await server.listen();
const BASE = "http://localhost:5199/";
if (!existsSync(performanceVideo)) {
  console.log("rendering the camera performance video (first run only)…");
  await renderPerformance(BASE, performanceVideo);
}
// Metal ANGLE is macOS-only; elsewhere Chromium picks its own GL backend.
const GPU_ARGS = process.platform === "darwin" ? ["--use-angle=metal", "--ignore-gpu-blocklist"] : ["--ignore-gpu-blocklist"];

const results = [];
const only = process.argv.slice(2);

const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function withPage(options, body) {
  const browser = await chromium.launch({ args: [...GPU_ARGS, ...(options.args ?? [])] });
  const context = await browser.newContext({
    viewport: options.viewport ?? { width: 1280, height: 720 },
    permissions: options.permissions ?? [],
    ...(options.context ?? {}),
  });
  if (options.initScript) await context.addInitScript(options.initScript);
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => msg.type() === "error" && errors.push(`console: ${msg.text()}`));
  try {
    await page.goto(BASE);
    await page.waitForFunction(() => window.__METRO_DASH__ !== undefined, null, { timeout: 30000 });
    await body(page, context);
    assert(errors.length === 0, `console errors:\n${errors.join("\n")}`);
  } finally {
    await browser.close();
  }
}

const state = (page) => page.evaluate(() => window.__METRO_DASH__.debugState());
const waitFor = (page, predicate, arg, timeout = 10000) => page.waitForFunction(predicate, arg, { timeout });
/** Clicks inside the active screen only (a screen fading out is still "visible" for a moment). */
const clickVisible = (page, selector) => page.locator(`.screen.visible ${selector} >> visible=true`).first().click();
/** Keeps the runner alive by deleting obstacles each frame (for control/perf checks). */
const godMode = (page) =>
  page.evaluate(() => {
    const s = window.__METRO_DASH__.session;
    const update = s.update.bind(s);
    s.update = (dt) => {
      s.world.obstacles.length = 0;
      update(dt);
    };
  });

async function test(name, fn) {
  if (only.length && !only.some((filter) => name.includes(filter))) return;
  const started = Date.now();
  try {
    await fn();
    results.push({ name, ok: true, ms: Date.now() - started });
    console.log(`✓ ${name} (${Date.now() - started} ms)`);
  } catch (error) {
    results.push({ name, ok: false, error });
    console.log(
      `✗ ${name}\n    ${String(error.message ?? error)
        .split("\n")
        .join("\n    ")}`,
    );
  }
}

// ─── Tests ───────────────────────────────────────────────────────────────────

await test("boots to the main menu and renders the 3D scene", () =>
  withPage({}, async (page) => {
    const s = await state(page);
    assert(s.screen === "menu" && s.runState === "menu", `unexpected start ${s.screen}/${s.runState}`);
    assert(s.renderer.calls > 20, "scene not rendering");
    assert(await page.locator(".tap-to-play").isVisible(), "tap to play not visible");
  }));

await test("keyboard: lanes, edge bump, jump, roll, hoverboard", () =>
  withPage({}, async (page) => {
    await page.keyboard.press("Enter");
    await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "running");
    await godMode(page);
    await page.keyboard.press("ArrowLeft");
    await page.waitForTimeout(250);
    assert((await state(page)).lane === -1, "left failed");
    await page.keyboard.press("KeyD");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(250);
    assert((await state(page)).lane === 1, "right x2 failed");
    await page.keyboard.press("ArrowRight");
    await page.waitForTimeout(100);
    assert((await state(page)).lane === 1, "moved past the edge");
    await page.keyboard.press("ArrowUp");
    await page.waitForTimeout(180);
    assert((await state(page)).y > 0.6, "jump failed");
    await page.waitForTimeout(700);
    await page.keyboard.press("ArrowDown");
    await page.waitForTimeout(80);
    assert((await state(page)).rolling, "roll failed");
    const boardsBefore = (await state(page)).save.hoverboards;
    await page.keyboard.press("Space");
    await page.waitForTimeout(100);
    const after = await state(page);
    assert(after.hoverboardActive, "hoverboard not active");
    assert(after.save.hoverboards === boardsBefore - 1, "hoverboard not consumed from the profile");
  }));

await test("pause freezes the run and resume counts down 3-2-1", () =>
  withPage({}, async (page) => {
    await page.keyboard.press("Enter");
    await godMode(page);
    await page.waitForTimeout(800);
    await page.keyboard.press("Escape");
    const paused = await state(page);
    assert(paused.runState === "paused" && paused.screen === "pause", "did not pause");
    await page.waitForTimeout(1000);
    assert((await state(page)).distance === paused.distance, "simulation moved while paused");
    await page.screenshot({ path: `${artifacts}e2e-pause.png` });
    await clickVisible(page, ".btn.green:has-text('Resume')");
    assert((await state(page)).runState === "countdown", "no countdown on resume");
    await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "running", null, 5000);
    await page.waitForTimeout(400);
    assert((await state(page)).distance > paused.distance, "did not resume");
  }));

await test("crash → Save me → No thanks → results; records persist across refresh", () =>
  withPage({}, async (page) => {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1500);
    await page.evaluate(() => {
      const s = window.__METRO_DASH__.session;
      s.world.obstacles.length = 0;
      for (let i = 0; i < 8; i++) s.world.addCollectible("coin", 0, 0.9, s.player.z + 5 + i * 2);
      s.world.addObstacle({ kind: "train", lane: 0, z: s.player.z + 25 });
    });
    await waitFor(page, () => window.__METRO_DASH__.debugState().screen === "saveMe", null, 8000);
    await page.screenshot({ path: `${artifacts}e2e-saveme.png` });
    await clickVisible(page, "button:has-text('No thanks')");
    await waitFor(page, () => window.__METRO_DASH__.debugState().screen === "results");
    await page.waitForTimeout(1300);
    await page.screenshot({ path: `${artifacts}e2e-results.png` });
    const s = await state(page);
    assert(s.save.highScore > 0 && s.save.coins >= 8, `records not saved: hs=${s.save.highScore} coins=${s.save.coins}`);
    assert(await page.locator(".ribbon").isVisible(), "no NEW HIGH SCORE ribbon on first run");
    await page.reload();
    await page.waitForFunction(() => window.__METRO_DASH__ !== undefined);
    const reloaded = await state(page);
    assert(reloaded.save.highScore === s.save.highScore && reloaded.save.coins === s.save.coins, "progress lost after refresh");
    const topRun = await page.locator(".top-run .value").textContent();
    assert(topRun?.replace(/,/g, "") === String(s.save.highScore), `menu shows ${topRun}`);
  }));

await test("revive with a key continues the run and doubles the price", () =>
  withPage({}, async (page) => {
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      const s = window.__METRO_DASH__.session;
      s.world.obstacles.length = 0;
      s.world.addObstacle({ kind: "train", lane: 0, z: s.player.z + 20 });
    });
    await waitFor(page, () => window.__METRO_DASH__.debugState().screen === "saveMe", null, 8000);
    const keys = (await state(page)).save.keys;
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    const s = await state(page);
    assert(s.runState === "running" && s.save.keys === keys - 1, `revive failed: ${s.runState} keys=${s.save.keys}`);
    const cost = await page.evaluate(() => window.__METRO_DASH__.session.reviveCost);
    assert(cost === 2, `second revive should cost 2 keys, got ${cost}`);
  }));

await test("results → Play restarts a fresh run", () =>
  withPage({}, async (page) => {
    await page.evaluate(() => window.__METRO_DASH__.save.update((d) => (d.keys = 0)));
    await page.keyboard.press("Enter");
    await page.waitForTimeout(1000);
    await page.evaluate(() => {
      const s = window.__METRO_DASH__.session;
      s.world.obstacles.length = 0;
      s.world.addObstacle({ kind: "train", lane: 0, z: s.player.z + 15 });
    });
    await waitFor(page, () => window.__METRO_DASH__.debugState().screen === "results", null, 8000);
    await page.waitForTimeout(500);
    await clickVisible(page, ".btn.green:has-text('Play')");
    await page.waitForTimeout(300);
    const s = await state(page);
    assert(s.runState === "running" && s.distance < 20, `restart failed ${s.runState} ${s.distance}`);
  }));

await test("characters, boards and upgrades: buy, equip, persist", () =>
  withPage({}, async (page) => {
    await page.evaluate(() => window.__METRO_DASH__.save.update((d) => (d.coins = 30000)));
    await clickVisible(page, "button[aria-label='Runners']");
    await clickVisible(page, ".card[aria-label='Kiki']");
    await clickVisible(page, ".details .btn.big");
    await clickVisible(page, "button[aria-label='Back']");
    await clickVisible(page, "button[aria-label='Boards']");
    await clickVisible(page, ".card[aria-label='Magneto']");
    await clickVisible(page, ".details .btn.big");
    await clickVisible(page, "button[aria-label='Back']");
    await clickVisible(page, "button[aria-label='Shop']");
    await clickVisible(page, "button[aria-label^='Upgrade Jetpack']");
    const s = await state(page);
    assert(s.save.selectedCharacter === "kiki" && s.save.selectedBoard === "magneto" && s.save.upgrades.jetpack === 1, "purchase state wrong");
    assert(s.save.coins === 30000 - 5000 - 6000 - 500, `coins ${s.save.coins}`);
    await page.reload();
    await page.waitForFunction(() => window.__METRO_DASH__ !== undefined);
    const r = await state(page);
    assert(r.save.selectedCharacter === "kiki" && r.save.selectedBoard === "magneto", "selections lost on refresh");
  }));

const rejectCamera = (name) => `
  navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("blocked for test", "${name}"));
`;

await test("camera permission denied shows guidance and falls back to keyboard", () =>
  withPage({ initScript: rejectCamera("NotAllowedError") }, async (page) => {
    await clickVisible(page, ".mode-toggle button:nth-child(2)");
    await clickVisible(page, ".cam-side .btn.green");
    await waitFor(page, () => window.__METRO_DASH__.debugState().camera === "error");
    const title = await page.locator(".screen.visible .cam-status").textContent();
    assert(title?.includes("Camera blocked"), `unexpected title ${title}`);
    await page.screenshot({ path: `${artifacts}e2e-camera-denied.png` });
    await clickVisible(page, ".cam-side button:has-text('Use keyboard')");
    const s = await state(page);
    assert(s.inputMode === "keyboard" && s.screen === "menu", `fallback failed: ${s.inputMode}/${s.screen}`);
    await page.keyboard.press("Enter");
    await page.waitForTimeout(300);
    assert((await state(page)).runState === "running", "keyboard play after fallback failed");
  }));

await test("missing camera and busy camera errors are explained", () =>
  withPage({ initScript: rejectCamera("NotFoundError") }, async (page) => {
    await clickVisible(page, ".mode-toggle button:nth-child(2)");
    await clickVisible(page, ".cam-side .btn.green");
    await waitFor(page, () => window.__METRO_DASH__.debugState().camera === "error");
    assert((await page.locator(".screen.visible .cam-status").textContent())?.includes("No camera found"), "not-found message missing");
    // Retry path: now the camera is "busy".
    await page.evaluate(() => (navigator.mediaDevices.getUserMedia = () => Promise.reject(new DOMException("busy", "NotReadableError"))));
    await clickVisible(page, ".cam-side button:has-text('Try again')");
    await page.waitForTimeout(300);
    assert((await page.locator(".screen.visible .cam-status").textContent())?.includes("Camera is busy"), "in-use message missing");
  }));

await test("camera mode: calibrate, gestures drive the runner, tracking loss auto-pauses, unplug falls back", async () => {
  await withPage(
    {
      args: ["--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream", `--use-file-for-fake-video-capture=${performanceVideo}`],
      permissions: ["camera"],
    },
    async (page) => {
      // Privacy: record every request made while the camera is in use.
      const requests = [];
      page.on("request", (request) => requests.push({ url: request.url(), method: request.method() }));
      await page.evaluate(() => {
        window.__gestures = [];
        window.__runEvents = [];
        const app = window.__METRO_DASH__;
        app.camera.events.on("gesture", ({ action }) => window.__gestures.push(action));
        app.session.events.on("laneChange", ({ lane }) => window.__runEvents.push(`lane:${lane}`));
        app.session.events.on("jump", () => window.__runEvents.push("jump"));
        app.session.events.on("roll", () => window.__runEvents.push("roll"));
      });
      // Pressing play in camera mode routes through setup first.
      await clickVisible(page, ".mode-toggle button:nth-child(2)");
      // With permission already granted the camera starts by itself; otherwise press "Enable camera".
      await page.waitForTimeout(600);
      if ((await state(page)).camera === "off") await clickVisible(page, ".cam-side .btn.green");
      await waitFor(page, () => window.__METRO_DASH__.debugState().save.calibration !== null, null, 30000);
      // Accuracy: one full pass of the performance must yield exactly these gestures, in order, nothing extra.
      await page.evaluate(() => (window.__gestures.length = 0));
      await page.waitForTimeout(13500);
      const firstPass = await page.evaluate(() => window.__gestures.slice());
      assert(
        JSON.stringify(firstPass) === JSON.stringify(["right", "left", "jump", "roll", "hoverboard"]),
        `gesture sequence was ${JSON.stringify(firstPass)}`,
      );
      console.log(`    accuracy: ${firstPass.join(" → ")} (exact, no false triggers)`);
      await clickVisible(page, ".cam-side .btn.green.big");
      await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "running", null, 6000);
      await godMode(page);
      // The looping video performs right, left, jump, crouch, hands-up, then walks out of frame.
      await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "trackingLost", null, 30000);
      const events = await page.evaluate(() => window.__runEvents.slice());
      assert(events.includes("jump") && events.includes("roll") && events.some((e) => e.startsWith("lane")), `camera did not drive the run: ${events}`);
      await page.screenshot({ path: `${artifacts}e2e-tracking-lost.png` });
      const lostDistance = (await state(page)).distance;
      await page.waitForTimeout(600);
      assert((await state(page)).distance === lostDistance, "run kept going while tracking was lost");
      await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "running", null, 12000);
      // Simulate unplugging the webcam mid-run.
      await page.evaluate(() => {
        const track = window.__METRO_DASH__.camera.video.srcObject.getVideoTracks()[0];
        track.stop();
        track.dispatchEvent(new Event("ended"));
      });
      await page.waitForTimeout(300);
      const s = await state(page);
      assert(s.inputMode === "keyboard" && s.runState === "paused", `no fallback after unplug: ${s.inputMode}/${s.runState}`);
      const gestures = await page.evaluate(() => window.__gestures.slice());
      for (const action of ["left", "right", "jump", "roll", "hoverboard"]) assert(gestures.includes(action), `gesture ${action} never detected (${gestures})`);
      const external = requests.filter((r) => !r.url.startsWith(BASE) && !r.url.startsWith("data:") && !r.url.startsWith("blob:"));
      assert(external.length === 0, `camera mode contacted external hosts: ${external.map((r) => r.url).join(", ")}`);
      const uploads = requests.filter((r) => r.method !== "GET");
      assert(uploads.length === 0, `camera mode sent non-GET requests: ${uploads.map((r) => `${r.method} ${r.url}`).join(", ")}`);
      console.log(`    privacy: ${requests.length} requests, all same-origin GETs (model + runtime loaded locally)`);
    },
  );
});

await test("long session: 3-minute autopilot run with real obstacles keeps FPS, memory and GPU resources stable", () =>
  withPage({}, async (page) => {
    // Normal difficulty: the full speed curve is the stress case.
    await page.evaluate(() => window.__METRO_DASH__.updateSettings({ difficulty: "normal" }));
    await page.keyboard.press("Enter");
    await waitFor(page, () => window.__METRO_DASH__.debugState().runState === "running");
    // Drive the real game with the planning autopilot (same bot as the unit soak tests).
    await page.evaluate(async () => {
      const { Autopilot } = await import("/tests/helpers/Autopilot.ts");
      const app = window.__METRO_DASH__;
      const bot = new Autopilot(app.session);
      window.__crashes = 0;
      const drive = () => {
        const s = app.session;
        if (s.phase === "running") {
          const action = bot.decide(1 / 60);
          if (action) s.handleAction(action);
        } else if (s.phase === "crashed") {
          window.__crashes++;
          s.revive();
          app.debugForceRunning();
        }
        requestAnimationFrame(drive);
      };
      drive();
    });
    const samples = [];
    const frameTimes = [];
    await page.evaluate(() => {
      window.__frames = [];
      let last = performance.now();
      const tick = (now) => {
        window.__frames.push(now - last);
        last = now;
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
    for (let minute = 0; minute < 6; minute++) {
      await page.waitForTimeout(30000);
      const snapshot = await page.evaluate(() => {
        const s = window.__METRO_DASH__.debugState();
        const frames = window.__frames.splice(0);
        return {
          frames,
          distance: s.distance,
          speed: s.speed,
          entities: s.entities,
          geometries: s.renderer.geometries,
          textures: s.renderer.textures,
          heap: performance.memory?.usedJSHeapSize ?? 0,
          crashes: window.__crashes,
          pool: s.pool,
        };
      });
      frameTimes.push(...snapshot.frames);
      delete snapshot.frames;
      samples.push(snapshot);
    }
    const avgFps = 1000 / (frameTimes.reduce((a, b) => a + b, 0) / frameTimes.length);
    const sorted = [...frameTimes].sort((a, b) => a - b);
    const p99 = sorted[Math.floor(sorted.length * 0.99)];
    for (const [i, s] of samples.entries()) {
      console.log(
        `    t=${(i + 1) * 30}s distance ${s.distance} m · speed ${s.speed.toFixed(1)} · entities ${s.entities} · geo ${s.geometries} · tex ${s.textures} · heap ${(s.heap / 1e6).toFixed(1)} MB · crashes ${s.crashes} · pooled ${s.pool.obstaclesCreated}+${s.pool.collectiblesCreated}`,
      );
    }
    console.log(`    avg ${avgFps.toFixed(1)} fps · p99 frame ${p99.toFixed(1)} ms`);
    const first = samples[1];
    const last = samples[samples.length - 1];
    // CI runners render in software; they set E2E_MIN_FPS lower than a real GPU needs.
    const minFps = Number(process.env.E2E_MIN_FPS ?? 45);
    assert(avgFps > minFps, `average fps too low: ${avgFps.toFixed(1)} (minimum ${minFps})`);
    assert(last.distance > 3500, `runner did not keep running (${last.distance} m)`);
    assert(last.entities < 500, `entity leak: ${last.entities}`);
    assert(last.geometries - first.geometries < 20, `GPU geometries keep growing: ${first.geometries} → ${last.geometries}`);
    assert(last.textures - first.textures < 10, `textures keep growing: ${first.textures} → ${last.textures}`);
    assert(last.heap === 0 || last.heap - first.heap < 30e6, "heap grew by more than 30 MB");
    assert(last.pool.obstaclesCreated < 250 && last.pool.collectiblesCreated < 700, "entity pools are not recycling");
  }));

await test("responsive: phone portrait and landscape layouts fit the viewport", async () => {
  for (const viewport of [
    { width: 390, height: 844, name: "portrait" },
    { width: 844, height: 390, name: "landscape" },
  ]) {
    await withPage(
      { viewport: { width: viewport.width, height: viewport.height }, context: { hasTouch: true, isMobile: viewport.name === "portrait" } },
      async (page) => {
        await page.waitForTimeout(600);
        await page.screenshot({ path: `${artifacts}e2e-${viewport.name}-menu.png` });
        const overflow = await page.evaluate(
          () => document.documentElement.scrollWidth > window.innerWidth || document.documentElement.scrollHeight > window.innerHeight,
        );
        assert(!overflow, `${viewport.name}: page overflows`);
        for (const selector of [".tap-to-play", "button[aria-label='Runners']", "button[aria-label='Settings']", ".mode-toggle"]) {
          const box = await page.locator(`.screen.visible ${selector}`).first().boundingBox();
          assert(
            box && box.x >= 0 && box.y >= 0 && box.x + box.width <= viewport.width + 1 && box.y + box.height <= viewport.height + 1,
            `${viewport.name}: ${selector} off-screen ${JSON.stringify(box)}`,
          );
        }
        await clickVisible(page, "button[aria-label='Runners']");
        await page.waitForTimeout(500);
        await page.screenshot({ path: `${artifacts}e2e-${viewport.name}-characters.png` });
        await clickVisible(page, "button[aria-label='Back']");
        await page.locator(".tap-to-play").click({ force: true });
        await page.waitForTimeout(1500);
        await page.screenshot({ path: `${artifacts}e2e-${viewport.name}-hud.png` });
        // Touch swipe input.
        await page.evaluate(() => {
          const surface = document.getElementById("app");
          const fire = (type, x, y) =>
            surface.dispatchEvent(new PointerEvent(type, { pointerId: 7, pointerType: "touch", clientX: x, clientY: y, bubbles: true }));
          fire("pointerdown", 200, 300);
          fire("pointermove", 120, 305);
          fire("pointerup", 120, 305);
        });
        await page.waitForTimeout(100);
        assert((await state(page)).lane === -1, `${viewport.name}: swipe left failed`);
      },
    );
  }
});

await server.close();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} e2e tests passed`);
process.exit(failed.length ? 1 : 0);
