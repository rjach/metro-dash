# Rendering

The goal is a believable late-afternoon city railway, built entirely from procedural geometry and textures.

## Lighting

- **Physical sky** (`three/examples/jsm/objects/Sky`) with a warm sun about 33° up on the left, slightly behind the runner. Wall shadows shade one lane, not all three.
- **Image-based lighting**: the sky (without the sun disc) is baked into a PMREM environment map. Glass, chrome, painted steel and gold coins reflect the same sky.
- **Sun shadows**: PCF-soft 2048² on High, with the frustum fitted just ahead of the runner.
- **Exposure** is set for the physical sky's HDR range (ACES filmic). Tunnels dim the sun and environment and open up the exposure, like eye adaptation.

## Materials

`materials.ts` exposes named physically based materials. `pbrTextures.ts` paints albedo, height and roughness canvases at runtime and derives normal maps from height with a Sobel filter. The library covers:

- ballast
- concrete with formwork seams and rain streaks
- brick facades whose windows are glossy in the roughness map and lit at random in the emissive map
- curtain-wall glass
- ribbed stainless steel
- tread plate, rust, denim, fleece, hair, carbon fibre
- embossed gold

## Post-processing (`PostFX`)

| Quality | Pipeline                                                            |
| ------- | ------------------------------------------------------------------- |
| Low     | Direct render, tone mapping, no shadows                             |
| Medium  | Bloom, grading, 2× MSAA, 1024² shadows                              |
| High    | GTAO ambient occlusion, bloom, grading, 4× MSAA, 2048² soft shadows |

Bloom's threshold is set in HDR units, so only real emitters glow: lamps, headlights, signals, LED signs and thrusters. The grade adds split toning, contrast, a vignette and fine grain.

## Characters (`HumanModel`)

- **Body:** adult proportions (~1.75 m, 7.5 heads). Limbs are lathe-turned from radius profiles, and joints are capped.
- **Head and hands:** a skull sculpted from a displaced sphere; eyes with iris, pupil and blinking lids; fingers.
- **Clothing:** physically based skin, fleece, denim and leather.
- **Motion:**
  - A phase-locked sprint cycle: hip, knee and ankle curves, pelvis bounce and twist, counter-rotating arms.
  - An athletic jump with a sprung landing, and a baseball slide for "down".
  - A surf stance on the hoverboard with a crouch-and-grab for "down".
  - Jetpack flight, a stumble lurch, and a toppling-pendulum fall on crash.
- **Secondary springs:** the ponytail, backpack, landing compression and lean.

## Hoverboard physics

The deck rides on a damped spring about 0.3 m above the ground: landings compress it, and it banks with lateral velocity and pitches with vertical motion. Thruster nacelles light the track with a point light in the board's colour.
