# Security Policy

## Supported versions

Only the latest release on `main` receives fixes.

## Reporting a vulnerability

Please **do not open a public issue**. Report it privately through [private vulnerability reporting](https://github.com/rjach/metro-dash/security/advisories/new) with steps to reproduce and the impact you expect. You should get an acknowledgement within a few days.

## Automated safeguards

- CodeQL code scanning on every pull request, and weekly.
- Dependency review blocks PRs that add dependencies with known high-severity vulnerabilities or incompatible licenses.
- Dependabot security and version updates.
- Secret scanning with push protection.

## Privacy model

Metro Dash is a static, client-only web app:

- Camera frames are processed on-device by MediaPipe (WebAssembly/WebGL). Frames and landmarks are never recorded, stored or sent anywhere.
- The pose runtime and models are served from the app's own origin. The end-to-end suite asserts that a camera session makes no cross-origin and no non-GET requests.
- Progress and settings stay in the browser's `localStorage`. There are no accounts, analytics or backend.

A report that breaks these guarantees is treated as a security issue.
