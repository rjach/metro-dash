# Camera controls

Camera mode turns your body into the controller. Everything runs **in the browser**: frames go from the webcam to MediaPipe (WebAssembly/WebGL) and are discarded. Nothing is recorded or uploaded.

## Gestures

| Action            | Gesture (default: hand-raise lanes)                                                                              |
| ----------------- | ---------------------------------------------------------------------------------------------------------------- |
| Move left / right | Keep both hands relaxed. Raise your **left or right hand to chest height**, then lower it. One raise = one lane. |
| Jump              | Jump (shoulders rise quickly).                                                                                   |
| Slide             | Crouch / squat.                                                                                                  |
| Hoverboard        | Both hands above your head, held briefly.                                                                        |

Settings → _Camera lane gesture_ switches lanes to **Lean / step** instead (body offset or spine tilt), and _Camera sensitivity_ scales every threshold.

## Pipeline

1. `CameraService` opens the webcam (`getUserMedia`) and maps failures to specific, user-facing errors: permission denied, no camera, camera busy, insecure context, unsupported browser, unplugged mid-run.
2. `MediaPipePoseEstimator` loads the **full** Pose Landmarker model on the GPU, falling back to the lite model and the CPU. Inference is paced by `requestVideoFrameCallback` at ~30 Hz.
3. `extractFeatures` converts 33 landmarks into mirrored body measurements: centre, shoulder height, spine tilt, torso length and per-hand height above the hips (in torso lengths). **Hands are assigned by which side of the body they are on, not by the model's labels.** Pose models regularly swap left/right wrist labels for a hand raised toward the camera.
4. `Calibrator` guides framing (too far, too close, off-centre, hips hidden) and captures a still, neutral stance: centre, shoulder height, torso length and relaxed hand heights.
5. `GestureRecognizer` runs one small state machine per gesture:
   - **One Euro filtering** on every signal (low jitter at rest, low lag when moving);
   - **scale awareness**: offsets are in torso lengths (shoulder width is too noisy), with perspective compensation so walking toward or away from the camera never fires a move;
   - **confidence gating** and **temporal confirmation** (a condition must hold for consecutive frames);
   - **hysteresis and re-arming**: a raised hand must come back down, and a lean must return to centre, before it can fire again, so one movement is one action;
   - **cooldowns**, **landing-dip and stand-up suppression**, and hands evaluated after the body so an arm swing during a jump never changes lanes;
   - slow **baseline drift correction** while idle.
6. `CameraInput` emits the resulting `GameAction`s into the same `InputManager` as the keyboard.

## Failure handling in play

- Leaving the frame for ~1 s auto-pauses the run with a "Can't see you!" prompt, then resumes with a 3-2-1 countdown when you return.
- If the camera stops mid-run (unplugged, revoked, taken by another app), the game pauses, switches to the keyboard and says so.
- The keyboard always works as a backup.

## Verifying accuracy

The e2e suite renders a mannequin performing a scripted routine into a video, streams it to Chromium as a fake webcam, and runs the real MediaPipe pipeline. It asserts that one pass yields exactly `right → left → jump → roll → hoverboard`, with no false triggers.
