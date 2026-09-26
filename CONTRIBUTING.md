# Contributing to Metro Dash

Thanks for helping. This guide covers setup, the rules every change must pass, and how we review.

## Setup

```bash
nvm use            # Node 24 (see .nvmrc); Node 20+ works
npm install        # also downloads the MediaPipe runtime and pose models into public/mediapipe
npm run dev        # http://localhost:5173
```

## Ground rules

1. **Game logic stays pure.** Anything under `src/game/` must not touch the DOM, Three.js, Web Audio or input devices. It consumes `GameAction`s and emits typed events. Presentation (`render/`, `ui/`, `audio/`) reads state and listens to events; it never changes game rules.
2. **Input is device-agnostic.** New controls are an `InputSource` that emits `GameAction`s through `InputManager`. Never call `GameSession` from a device.
3. **Camera data never leaves the device.** No network calls from camera code. The runtime and models are served from the app's own origin. The e2e suite fails if a camera session makes any cross-origin or non-GET request.
4. **Generated tracks must be fair.** New obstacle patterns go in `src/game/patterns.ts`, and every candidate is checked by `LayoutValidator`. Keep the autopilot soak tests passing.
5. **No per-frame allocation in hot paths.** Reuse objects, use the pools in `World`/`WorldView`, and prebuild meshes. The long-session e2e test checks that heap, geometry and texture counts stay flat.
6. **Original assets only.** No third-party characters, logos, textures or sounds. Everything is procedural.
7. **Tuning lives in `src/core/config.ts`.** No magic numbers scattered through systems.

## Checks

Every PR must pass:

```bash
npm run lint           # ESLint (typescript-eslint)
npm run format:check   # Prettier
npm run typecheck      # tsc --noEmit (strict)
npm test               # Vitest unit + soak tests
npm run build          # production bundle
```

`npm run check` runs the first four. If you touch rendering, input, UI flow or performance-sensitive code, also run:

```bash
npm run e2e            # Playwright end-to-end suite (starts its own dev server)
npm run tour           # screenshots of every screen for visual review → e2e/artifacts/
```

## Tests to add

| Change                         | Add or update                                               |
| ------------------------------ | ----------------------------------------------------------- |
| Game rules, physics, power-ups | `tests/session.test.ts`                                     |
| Obstacle patterns / generator  | `tests/generator.test.ts` (fairness + soak must stay green) |
| Gesture recognition            | `tests/gestures.test.ts` (synthetic landmark streams)       |
| Save data / settings           | `tests/persistence.test.ts` (validation and migration)      |
| UI flows, camera flows         | `e2e/run.mjs`                                               |

## Commits and pull requests

- Fork (or branch, for maintainers) from `main`, keep PRs focused, and use a [Conventional Commits](https://www.conventionalcommits.org) title (`feat: …`, `fix: …`, `perf: …`, `docs: …`, `test: …`, `chore: …`). The PR title becomes the squash-commit message.
- Fill in the PR template: what changed, why, and how you verified it. Add screenshots for visual changes.

## Repository rules

`main` is protected by a repository ruleset:

| Rule                  | Detail                                                                                                                                                |
| --------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Pull request required | No direct pushes. One approving review from a code owner is required; new pushes dismiss earlier approvals, and every review thread must be resolved. |
| Required checks       | `Lint, typecheck, test, build`, `Analyze (javascript-typescript)` (CodeQL) and `Dependency review` must pass on an up-to-date branch.                 |
| History               | Squash merges only (linear history). Force-pushes and branch deletion are blocked.                                                                    |
| Tags                  | Release tags (`v*`) can't be moved or deleted.                                                                                                        |

Workflows from first-time contributors need a maintainer's approval before they run. Merged branches are deleted automatically.

## Releases

Maintainers tag `vX.Y.Z` on `main` and publish a GitHub release; notes are generated from PR labels (`.github/release.yml`). Update `CHANGELOG.md` and the `version` in `package.json` in the release PR.

## Reporting bugs

Use the issue templates. For camera problems, include your browser, OS, camera model and what the setup screen said. Never attach video of yourself; describe the movement instead.
