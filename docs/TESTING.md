# Testing

| Suite         | Command        | What it proves                                                                                                                                                                                                                                                                                                                                                                                                    |
| ------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit and soak | `npm test`     | Game rules, physics, power-ups, difficulty, headstart; generator fairness; gesture recognition from synthetic landmark streams (hands and lean, label swaps, distance changes, jitter, tracking loss); missions; save validation and migration. A planning autopilot survives 4-minute runs on every seed, and a 10-minute run keeps pools flat.                                                                  |
| End-to-end    | `npm run e2e`  | Real browser. Boot, keyboard controls, pause and countdown, crash → Save me → results, revive, refresh persistence, purchases, camera permission errors, the **full camera pipeline** (exact gesture sequence, auto-pause on lost tracking, unplug fallback, same-origin-only network), a 3-minute autopilot performance soak (FPS, heap, GPU resources), and phone portrait/landscape layouts with touch swipes. |
| Visual tour   | `npm run tour` | Screenshots of every screen and key game state in both orientations, for design review.                                                                                                                                                                                                                                                                                                                           |

## The camera fixture

`e2e/pose-harness.html` renders an adult mannequin in scripted poses. `e2e/make-performance.mjs` turns a timeline into an MJPEG that Chromium plays as a fake webcam (`--use-file-for-fake-video-capture`). The timeline is: stand still, right hand up, left hand up, jump, crouch, both hands up, then walk out of frame. The suite renders it automatically on first run.

## CI

- `.github/workflows/ci.yml` runs lint, format check, typecheck, unit tests and the build on every push and PR.
- `.github/workflows/e2e.yml` runs the Playwright suite on demand and weekly. `E2E_MIN_FPS` is lowered there because GitHub runners render WebGL in software.
