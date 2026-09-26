# Changelog

## 1.1.0

- Back to the original stylised look (cartoon runners, bright city), now with a cloud skyline, eye highlights, landing squash, train roof details, shop awnings, fuller trees and kicked hoverboard decks.
- Hoverboard "down" is now a crouch-and-grab on the board instead of rolling off it.
- Performance: pose detection moved to a Web Worker, dynamic resolution scaling added, and the in-game camera preview draws at quarter size. Retina laptops now hold 60 fps in every mode (previously 30–45 fps with stalls), and memory use is about 3× lower.

## 1.0.0

- Three-lane endless runner: trains (static and oncoming), ramps to train roofs, jump/slide barriers, buffer stops, coins, keys and five power-ups.
- Procedural infinite track with a reachability validator that rejects unfair layouts.
- Keyboard, touch-swipe and camera controls through one input abstraction.
- Camera mode: on-device MediaPipe pose tracking; hand-raise lane changes (or lean/step), jump, crouch-to-slide, both hands up for the hoverboard; calibration, preview, auto-pause on lost tracking and keyboard fallback.
- Realistic rendering: physically based materials, physical sky and image-based lighting, soft shadows, ambient occlusion, bloom, cinematic grading.
- Realistic runners with biomechanical animation, secondary physics and a physics-based crash fall.
- Hoverboards with perks, headstarts, Save-me revives, missions and a permanent score multiplier.
- Easy / Normal / Hard difficulty (Easy by default).
- Procedural soundtrack with song sections, effects and moods.
- Persistence, responsive layouts, and unit, soak and end-to-end suites.
