# Metro Dash

[![CI](https://github.com/rjach/metro-dash/actions/workflows/ci.yml/badge.svg)](https://github.com/rjach/metro-dash/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A browser endless runner in a realistic, cinematic city railway. Play it with the **keyboard**, **touch swipes**, or **your body through a webcam**: raise a hand to change lanes, jump to jump, crouch to slide. Pose tracking runs entirely on your device; no video ever leaves the browser.

All characters, trains, buildings, textures, icons, music and sound effects are original and generated procedurally at runtime.

## Quick start

```bash
npm install          # also downloads the MediaPipe runtime + pose models into public/mediapipe
npm run dev          # http://localhost:5173
```

| Command                             | Purpose                                               |
| ----------------------------------- | ----------------------------------------------------- |
| `npm run build` / `npm run preview` | Type-checked production bundle / serve it             |
| `npm test`                          | Unit, fairness and soak tests (Vitest)                |
| `npm run e2e`                       | End-to-end suite (Playwright; starts its own server)  |
| `npm run tour`                      | Screenshots of every screen in landscape and portrait |
| `npm run check`                     | Lint + format check + typecheck + unit tests          |

If the model download fails during install (offline machine), run `npm run setup:assets` later. Camera mode shows a clear error until the models are present.

## Controls

| Action                     | Keyboard  | Touch          | Camera (default)                                          |
| -------------------------- | --------- | -------------- | --------------------------------------------------------- |
| Change lane                | ← → / A D | swipe          | raise your left/right hand to chest height, then lower it |
| Jump                       | ↑ / W     | swipe up       | jump                                                      |
| Slide (slams down mid-air) | ↓ / S     | swipe down     | crouch                                                    |
| Hoverboard                 | Space     | double tap     | both hands above your head                                |
| Headstart (first 5 s)      | H         | tap the button | tap the button                                            |
| Pause                      | Esc / P   | pause button   | auto-pauses when you step out of view                     |

The keyboard always works as a backup in camera mode. Settings offer _Lean / step_ lanes instead of hand raises, camera sensitivity, and **Easy / Normal / Hard** difficulty (Easy is the default: slower, roomier, and barriers only trip you up).

## Features

- **Gameplay:**
  - Three lanes of parked and oncoming trains, ramps up to train roofs, jump and slide barriers, and buffer stops.
  - Coins, keys, Coin Magnet, Jetpack, Super Sneakers, 2x Multiplier and Mystery Boxes.
  - Hoverboards with perks, headstarts and "Save me!" revives.
  - A guard and his dog who catch you after two stumbles.
  - Missions that raise a permanent score multiplier.
- **Fair infinite track:** every generated segment is proven survivable by a reachability solver before it is placed.
- **Realistic rendering:**
  - Physically based materials with procedural normal and roughness maps, and a physical sky with image-based lighting.
  - Soft sun shadows, ambient occlusion, bloom and a cinematic grade.
  - A detailed railway: ballast, sleepers, rails, catenary, brick and glass buildings, overpasses and tunnels.
- **Realistic runners:**
  - Adult proportions with sculpted faces and clothing materials.
  - Biomechanical run, jump and slide animation.
  - Hoverboard stances with suspension physics, spring-driven hair and gear, and a physics crash fall.
- **Soundtrack:** a procedural composer with song sections, chord progressions, fills, reverb and delay, and moods for the menu, the run and pause.
- **Persistence:** records, coins, unlocks, upgrades, missions, settings and camera calibration survive refreshes.
- **Responsive:** desktop, tablet and phone, in portrait and landscape.

## Documentation

- [Architecture](docs/ARCHITECTURE.md): layers, simulation, procedural track, performance.
- [Camera controls](docs/CAMERA_CONTROLS.md): gestures, pipeline, accuracy and failure handling.
- [Rendering](docs/RENDERING.md): lighting, materials, post-processing, characters.
- [Testing](docs/TESTING.md): unit, soak and end-to-end suites, and the camera fixture.

## Privacy

Camera frames are processed on-device and discarded. The pose runtime and models are served from this app's own origin, and the end-to-end suite fails if a camera session makes any cross-origin or non-GET request. Progress is stored only in your browser. See [SECURITY.md](SECURITY.md).

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) and the [Code of Conduct](CODE_OF_CONDUCT.md). `main` is protected: CI must pass and history stays linear.

## Browser support

Recent Chrome, Edge, Firefox and Safari with WebGL 2. Camera mode needs HTTPS or `localhost`.

## License

[MIT](LICENSE). The MediaPipe runtime and models downloaded at install time are Apache 2.0 (Google).
