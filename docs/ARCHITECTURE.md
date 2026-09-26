# Architecture

Metro Dash is a static TypeScript app (Vite + Three.js). The main idea: **the simulation knows nothing about pixels, sound or devices**. Everything else observes it or feeds it commands.

```
            ┌──────────── InputManager ────────────┐
Keyboard ─┐ │                                      │
Touch ────┼─┤  GameAction: left | right | jump |   ├──► GameSession (pure simulation, 120 Hz fixed step)
Camera ───┘ │            roll | hoverboard         │         │ typed events (coin, crash, powerUpStart…)
            └──────────────────────────────────────┘         ▼
                                                 ┌── SessionFeedback → AudioEngine, particles, HUD toasts
                                                 ├── MissionCoordinator → missions, SaveStore
                                                 └── GameRenderer (reads state every frame)
App (composition root) owns the run lifecycle, screens (UIManager) and persistence (SaveStore).
```

## Layers

| Folder            | Responsibility                                                                                                                  | May depend on                   |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- | ------------------------------- |
| `src/core`        | Tuning (`config.ts`), math/RNG, typed `EventBus`, object `Pool`                                                                 | nothing                         |
| `src/game`        | Simulation: `GameSession`, `Player`, `CollisionSystem`, `TrackGenerator`, `LayoutValidator`, `PowerUpSystem`, missions, `World` | core, content                   |
| `src/content`     | Data: runners, boards, power-up tables                                                                                          | core                            |
| `src/input`       | `InputManager`, keyboard, touch, camera pipeline                                                                                | core, game (action types only)  |
| `src/render`      | Three.js scene, materials, models, environment, post-processing                                                                 | core, game (read-only), content |
| `src/audio`       | Synthesised SFX and the procedural soundtrack                                                                                   | —                               |
| `src/persistence` | Versioned, validated save data over an injectable store                                                                         | core, content, game types       |
| `src/ui`          | DOM screens and components; talk to the app only through `UiController`                                                         | ui, content                     |
| `src/app`         | Composition root, run lifecycle, economy, feedback wiring                                                                       | everything                      |

## Simulation

- **Fixed step.** `GameSession.update` accumulates real time and advances 1/120 s steps, so collisions are frame-rate independent and a runner never tunnels through a 0.4 m barrier.
- **Coordinates.** Metres; the runner moves toward +z. The renderer draws every entity at `z − playerZ`, which avoids float precision loss after kilometres.
- **Collisions.** `CollisionSystem` resolves the floor (roofs, ramps) and classifies hits: head-on → crash (or a stumble on Easy for barriers); side contact or a mid-lane-change graze → stumble and bounce back. Two stumbles while the guard is close → caught.
- **Difficulty.** `DIFFICULTIES` in `config.ts` controls the speed curve, pattern spacing and forgiveness. The session receives it through its `RunLoadout`.

## Procedural track

`TrackGenerator` appends segments ahead of the runner. For each segment it:

1. picks a weighted pattern for the current difficulty (`patterns.ts`), laid out against a random lane permutation;
2. resolves coin heights (arcs over barriers, rails on roofs) in `SegmentBuilder`;
3. proves the layout survivable with `LayoutValidator`. This is a dynamic program over (lane, ground/roof) states that models lane-change time, barrier reaction zones, ramps, roof hopping and lanes reserved by oncoming trains;
4. rejects and retries unfair candidates, then commits entities to the pooled `World`.

Oncoming trains are materialised lazily at a fixed lead distance so they meet the runner where the pattern intended.

## Performance

- Entities (`World`) and meshes (`WorldView`) are pooled. Obstacle meshes are cloned from per-look templates that share geometry and materials.
- Scenery chunks are merged by material and prebuilt at boot. A warm-up render uploads every geometry and compiles every shader behind the loading screen.
- All coins are drawn with one `InstancedMesh`; sleepers and rail clips are instanced per chunk.
- MediaPipe is loaded only when camera mode is used, and runs in a Web Worker so inference never costs render time.
- The renderer scales its resolution dynamically to hold 60 fps.

The long-session e2e test asserts 60 fps and flat heap, geometry and texture counts over a 3-minute autopilot run.
