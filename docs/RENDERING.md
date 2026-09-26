# Rendering

Metro Dash uses a bright, stylised look: chunky cartoon runners, painted trains and a sunny city railway, all generated procedurally. Performance comes first: the game targets a locked 60 fps on laptop GPUs, including at retina resolutions and while camera tracking runs.

## Look

- **Curved world:** every material is patched with a vertex bend (`curve.ts`), so the track drops away over the horizon and drifts gently sideways on long straights.
- **Lighting:** a hemisphere sky/ground light plus a warm sun, soft blob shadows under characters, and distance fog that matches the sky. Tunnels dim the light and fog.
- **Materials:** cel-shaded (four-band toon) characters; Lambert/Phong scenery; canvas-painted textures for graffiti walls, building facades, train liveries, gravel, sleepers and board decks.
- **Backdrop:** a gradient sky with a painted cloud-and-skyline plane pinned to the horizon.
- **Effects:** coin sparkles, pickup bursts, landing dust, board shatter and speed streaks, all in one instanced particle mesh.

## Characters

`CharacterModel` builds each runner from a jointed rig: big head, hoodie, sneakers, and per-character hair and accessories. Procedural animation blends target poses for idle, run, jump, fall, roll, jetpack, stumble and crash. It adds:

- a springy landing squash;
- a surf stance on the hoverboard;
- a crouch-and-grab when you go "down" while riding, so the board stays under your feet.

The hoverboard rides on a damped spring above the track and banks into lane changes.

## Performance

| Technique                                                  | Why                                                                                                                                                                  |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dynamic resolution (`ResolutionGovernor`)                  | Lowers the render scale when frames run slow and raises it when there's headroom. Graphics quality sets the ceiling (Low 0.75×, Medium 1×, High 1.5× device pixels). |
| Scenery chunks merged per material and prebuilt at boot    | A 30 m chunk costs a handful of draw calls and never allocates mid-run.                                                                                              |
| Pooled obstacle/pickup meshes cloned from shared templates | Geometry and materials are shared; no GPU uploads during play.                                                                                                       |
| Instanced coins, sleepers and particles                    | One draw call each.                                                                                                                                                  |
| Boot warm-up render                                        | Every shader compiles and every buffer uploads behind the loading screen.                                                                                            |
| Pose detection in a Web Worker                             | Camera tracking never blocks a render frame (see [Camera controls](CAMERA_CONTROLS.md)).                                                                             |

Measured at 1512×945 @2× (retina laptop): menu, keyboard runs and camera runs all hold 60 fps, with a worst frame of about 17 ms.
