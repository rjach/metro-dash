import * as THREE from "three";
import { Random } from "../core/math";

/**
 * Procedural physically-based texture sets. Each surface is painted as an
 * albedo image plus a height field; normal maps are derived from the height
 * with a Sobel filter and roughness maps are painted alongside. All artwork is
 * generated at runtime — no external image assets.
 */

export interface PbrSet {
  map: THREE.CanvasTexture;
  normalMap?: THREE.Texture;
  roughnessMap?: THREE.CanvasTexture;
  metalnessMap?: THREE.CanvasTexture;
  emissiveMap?: THREE.CanvasTexture;
}

type Ctx = CanvasRenderingContext2D;

export interface PbrPainters {
  albedo: (ctx: Ctx, w: number, h: number, rng: Random) => void;
  /** Grey-scale height (white = high). */
  height?: (ctx: Ctx, w: number, h: number, rng: Random) => void;
  /** Grey-scale roughness (white = rough). */
  roughness?: (ctx: Ctx, w: number, h: number, rng: Random) => void;
  metalness?: (ctx: Ctx, w: number, h: number, rng: Random) => void;
  emissive?: (ctx: Ctx, w: number, h: number, rng: Random) => void;
}

const cache = new Map<string, PbrSet>();
let anisotropy = 8;

export const setPbrAnisotropy = (value: number) => {
  anisotropy = value;
};

const canvas = (w: number, h: number): [HTMLCanvasElement, Ctx] => {
  const element = document.createElement("canvas");
  element.width = w;
  element.height = h;
  const ctx = element.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Canvas 2D context unavailable for procedural texture painting");
  return [element, ctx];
};

const toTexture = (element: HTMLCanvasElement, color: boolean): THREE.CanvasTexture => {
  const texture = new THREE.CanvasTexture(element);
  texture.colorSpace = color ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  return texture;
};

/** Tangent-space normal map from a height canvas (Sobel operator, wrap-around sampling). */
const normalFromHeight = (heightCtx: Ctx, w: number, h: number, strength: number): THREE.DataTexture => {
  const source = heightCtx.getImageData(0, 0, w, h).data;
  const out = new Uint8Array(w * h * 4);
  const height = (x: number, y: number) => source[(((y + h) % h) * w + ((x + w) % w)) * 4]! / 255;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = height(x + 1, y - 1) + 2 * height(x + 1, y) + height(x + 1, y + 1) - (height(x - 1, y - 1) + 2 * height(x - 1, y) + height(x - 1, y + 1));
      const dy = height(x - 1, y + 1) + 2 * height(x, y + 1) + height(x + 1, y + 1) - (height(x - 1, y - 1) + 2 * height(x, y - 1) + height(x + 1, y - 1));
      let nx = -dx * strength;
      let ny = dy * strength;
      let nz = 1;
      const length = Math.hypot(nx, ny, nz);
      nx /= length;
      ny /= length;
      nz /= length;
      const i = (y * w + x) * 4;
      out[i] = (nx * 0.5 + 0.5) * 255;
      out[i + 1] = (ny * 0.5 + 0.5) * 255;
      out[i + 2] = (nz * 0.5 + 0.5) * 255;
      out[i + 3] = 255;
    }
  }
  const texture = new THREE.DataTexture(out, w, h, THREE.RGBAFormat);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.anisotropy = anisotropy;
  texture.generateMipmaps = true;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

/**
 * Paints (once) and caches a PBR texture set.
 *
 * @param key - Cache key
 * @param size - Canvas size in pixels ([w, h])
 * @param painters - Albedo plus optional height/roughness/metalness/emissive painters
 * @param normalStrength - Bump intensity of the derived normal map
 */
export const pbrSet = (key: string, size: [number, number], painters: PbrPainters, normalStrength = 2, seed = 1): PbrSet => {
  const existing = cache.get(key);
  if (existing) return existing;
  const [w, h] = size;
  const paint = (painter: PbrPainters[keyof PbrPainters] | undefined, color: boolean) => {
    if (!painter) return undefined;
    const [element, ctx] = canvas(w, h);
    painter(ctx, w, h, new Random(seed));
    return { element, ctx, texture: toTexture(element, color) };
  };
  const albedo = paint(painters.albedo, true)!;
  const height = painters.height ? paint(painters.height, false) : undefined;
  const set: PbrSet = {
    map: albedo.texture,
    ...(height ? { normalMap: normalFromHeight(height.ctx, w, h, normalStrength) } : {}),
    ...(painters.roughness ? { roughnessMap: paint(painters.roughness, false)!.texture } : {}),
    ...(painters.metalness ? { metalnessMap: paint(painters.metalness, false)!.texture } : {}),
    ...(painters.emissive ? { emissiveMap: paint(painters.emissive, true)!.texture } : {}),
  };
  cache.set(key, set);
  return set;
};

// ─── Painting helpers ────────────────────────────────────────────────────────

const grey = (v: number) => `rgb(${v},${v},${v})`;

/** Soft value noise speckle, the base of most weathered surfaces. */
export const speckle = (
  ctx: Ctx,
  w: number,
  h: number,
  rng: Random,
  count: number,
  min: number,
  max: number,
  alpha = 0.25,
  size: [number, number] = [1, 3],
) => {
  for (let i = 0; i < count; i++) {
    const v = Math.floor(rng.range(min, max));
    ctx.fillStyle = `rgba(${v},${v},${v},${alpha})`;
    const s = rng.range(size[0], size[1]);
    ctx.fillRect(rng.range(0, w), rng.range(0, h), s, s);
  }
};

/** Large blotches for grime, water stains and colour variation. */
export const blotches = (ctx: Ctx, w: number, h: number, rng: Random, count: number, color: string, radius: [number, number], alpha: [number, number]) => {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, w);
    const y = rng.range(0, h);
    const r = rng.range(radius[0], radius[1]);
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
    gradient.addColorStop(0, color.replace("ALPHA", String(rng.range(alpha[0], alpha[1]))));
    gradient.addColorStop(1, color.replace("ALPHA", "0"));
    ctx.fillStyle = gradient;
    // Draw wrapped copies so the texture stays seamless.
    for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) ctx.fillRect(x - r + ox, y - r + oy, r * 2, r * 2);
  }
};

/** Vertical rain streaks running down concrete. */
export const streaks = (ctx: Ctx, w: number, h: number, rng: Random, count: number, color: string) => {
  for (let i = 0; i < count; i++) {
    const x = rng.range(0, w);
    const length = rng.range(h * 0.2, h * 0.9);
    const y = rng.range(0, h * 0.3);
    const gradient = ctx.createLinearGradient(0, y, 0, y + length);
    gradient.addColorStop(0, color.replace("ALPHA", String(rng.range(0.08, 0.2))));
    gradient.addColorStop(1, color.replace("ALPHA", "0"));
    ctx.fillStyle = gradient;
    ctx.fillRect(x, y, rng.range(2, 7), length);
  }
};

// ─── Surface library ─────────────────────────────────────────────────────────

/** Railway ballast: angular granite stones with dark gaps. */
export const ballastSet = () =>
  pbrSet(
    "ballast",
    [512, 512],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = "#3b3632";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const r = rng.range(4, 11);
          const tone = rng.range(0, 1);
          const base = tone < 0.6 ? [128, 122, 114] : tone < 0.85 ? [150, 140, 126] : [98, 92, 88];
          const k = rng.range(0.75, 1.15);
          ctx.fillStyle = `rgb(${base[0]! * k},${base[1]! * k},${base[2]! * k})`;
          ctx.beginPath();
          const sides = rng.int(5, 7);
          for (let s = 0; s < sides; s++) {
            const a = (s / sides) * Math.PI * 2 + rng.range(-0.3, 0.3);
            const rr = r * rng.range(0.65, 1.1);
            ctx.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
          }
          ctx.fill();
        }
        blotches(ctx, w, h, rng, 14, "rgba(70,45,25,ALPHA)", [40, 120], [0.15, 0.3]);
      },
      height: (ctx, w, h, rng) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 2600; i++) {
          const x = rng.range(0, w);
          const y = rng.range(0, h);
          const r = rng.range(4, 11);
          const gradient = ctx.createRadialGradient(x, y, 0, x, y, r);
          gradient.addColorStop(0, grey(Math.floor(rng.range(170, 255))));
          gradient.addColorStop(1, "#111");
          ctx.fillStyle = gradient;
          ctx.beginPath();
          ctx.arc(x, y, r, 0, Math.PI * 2);
          ctx.fill();
        }
      },
      roughness: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(235);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 3000, 160, 255, 0.4);
      },
    },
    3,
    11,
  );

/** Weathered cast concrete with formwork seams, rain streaks and grime. */
export const concreteSet = (tone = 0, panels = true) =>
  pbrSet(
    `concrete-${tone}-${panels}`,
    [512, 512],
    {
      albedo: (ctx, w, h, rng) => {
        const bases = ["#9c9892", "#8a8781", "#aba59b", "#77746f"];
        ctx.fillStyle = bases[tone % bases.length]!;
        ctx.fillRect(0, 0, w, h);
        blotches(ctx, w, h, rng, 30, "rgba(60,58,54,ALPHA)", [30, 110], [0.05, 0.16]);
        blotches(ctx, w, h, rng, 16, "rgba(200,196,188,ALPHA)", [30, 90], [0.05, 0.12]);
        speckle(ctx, w, h, rng, 9000, 40, 220, 0.12);
        streaks(ctx, w, h, rng, 26, "rgba(40,36,30,ALPHA)");
        ctx.fillStyle = "rgba(40,38,34,0.35)";
        ctx.fillRect(0, h - 26, w, 26);
        if (panels) {
          ctx.fillStyle = "rgba(30,30,30,0.5)";
          ctx.fillRect(0, 0, 4, h);
          ctx.fillRect(w / 2, 0, 3, h);
        }
      },
      height: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(140);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 12000, 90, 190, 0.35, [1, 2]);
        for (let i = 0; i < 40; i++) {
          ctx.fillStyle = grey(Math.floor(rng.range(60, 110)));
          ctx.beginPath();
          ctx.arc(rng.range(0, w), rng.range(0, h), rng.range(1, 3), 0, Math.PI * 2);
          ctx.fill();
        }
        if (panels) {
          ctx.fillStyle = grey(20);
          ctx.fillRect(0, 0, 5, h);
          ctx.fillRect(w / 2, 0, 4, h);
        }
      },
      roughness: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(225);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 4000, 170, 255, 0.3, [2, 6]);
      },
    },
    1.6,
    23 + tone,
  );

const BRICK_TONES = [
  ["#8e4b37", "#a2573f", "#7a3f2e"],
  ["#b0785a", "#c08a68", "#9a6649"],
  ["#6e5a4e", "#7f695c", "#5e4d43"],
  ["#a8a095", "#bab2a5", "#958c80"],
] as const;

/** Brick facade with windows; glass is glossy in the roughness map and some rooms are lit. */
export const facadeSet = (variant: number) =>
  pbrSet(
    `facade-${variant}`,
    [512, 1024],
    {
      albedo: (ctx, w, h, rng) => {
        const tones = BRICK_TONES[variant % BRICK_TONES.length]!;
        ctx.fillStyle = "#6b6259";
        ctx.fillRect(0, 0, w, h);
        const bw = 32;
        const bh = 12;
        for (let row = 0; row * bh < h; row++) {
          for (let col = -1; col * bw < w; col++) {
            ctx.fillStyle = tones[rng.int(0, 2)]!;
            const x = col * bw + (row % 2) * (bw / 2);
            ctx.fillRect(x + 1, row * bh + 1, bw - 2, bh - 2);
          }
        }
        blotches(ctx, w, h, rng, 20, "rgba(30,25,20,ALPHA)", [40, 140], [0.08, 0.2]);
        paintWindows(ctx, w, h, rng, "albedo");
      },
      height: (ctx, w, h) => {
        ctx.fillStyle = grey(200);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = grey(90);
        for (let y = 0; y < h; y += 12) ctx.fillRect(0, y, w, 2);
        for (let row = 0; row * 12 < h; row++) for (let x = (row % 2) * 16; x < w; x += 32) ctx.fillRect(x, row * 12, 2, 12);
        paintWindows(ctx, w, h, new Random(5), "height");
      },
      roughness: (ctx, w, h) => {
        ctx.fillStyle = grey(235);
        ctx.fillRect(0, 0, w, h);
        paintWindows(ctx, w, h, new Random(5), "roughness");
      },
      emissive: (ctx, w, h) => {
        ctx.fillStyle = "#000";
        ctx.fillRect(0, 0, w, h);
        paintWindows(ctx, w, h, new Random(5 + variant), "emissive");
      },
    },
    2.5,
    31 + variant,
  );

/** Window grid shared by every facade layer so glass, frames and lit rooms line up. */
const paintWindows = (ctx: Ctx, w: number, h: number, rng: Random, layer: "albedo" | "height" | "roughness" | "emissive") => {
  const cols = 3;
  const rows = 6;
  const cw = w / cols;
  const rh = h / rows;
  const lit = new Random(97);
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      const x = c * cw + cw * 0.2;
      const y = r * rh + rh * 0.22;
      const ww = cw * 0.6;
      const wh = rh * 0.56;
      const isLit = lit.chance(0.28);
      switch (layer) {
        case "albedo": {
          ctx.fillStyle = "#d8d2c6";
          ctx.fillRect(x - 6, y + wh, ww + 12, 8);
          ctx.fillStyle = "#2a2e33";
          ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6);
          const gradient = ctx.createLinearGradient(x, y, x + ww, y + wh);
          gradient.addColorStop(0, "#3d5570");
          gradient.addColorStop(1, "#1c2833");
          ctx.fillStyle = gradient;
          ctx.fillRect(x, y, ww, wh);
          ctx.fillStyle = "#2a2e33";
          ctx.fillRect(x + ww / 2 - 2, y, 4, wh);
          ctx.fillRect(x, y + wh * 0.35, ww, 4);
          if (rng.chance(0.25)) {
            ctx.fillStyle = "rgba(230,225,210,0.55)";
            ctx.fillRect(x, y, ww, wh * rng.range(0.2, 0.6));
          }
          break;
        }
        case "height":
          ctx.fillStyle = grey(40);
          ctx.fillRect(x - 3, y - 3, ww + 6, wh + 6);
          ctx.fillStyle = grey(255);
          ctx.fillRect(x - 6, y + wh, ww + 12, 8);
          break;
        case "roughness":
          ctx.fillStyle = grey(18);
          ctx.fillRect(x, y, ww, wh);
          break;
        case "emissive":
          if (isLit) {
            const glow = ctx.createLinearGradient(x, y, x, y + wh);
            glow.addColorStop(0, "#ffd9a0");
            glow.addColorStop(1, "#c98a42");
            ctx.fillStyle = glow;
            ctx.fillRect(x, y, ww, wh);
          }
          break;
      }
    }
  }
};

/** Glass curtain wall for office towers: mirror-like panes with mullions. */
export const curtainWallSet = (variant: number) =>
  pbrSet(
    `curtain-${variant}`,
    [256, 512],
    {
      albedo: (ctx, w, h, rng) => {
        const tints = ["#6f8ea8", "#5b7a78", "#86909c"];
        ctx.fillStyle = tints[variant % tints.length]!;
        ctx.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            ctx.fillStyle = `rgba(255,255,255,${rng.range(0, 0.12)})`;
            ctx.fillRect(x, y, 32, 32);
          }
        }
        ctx.fillStyle = "#2d3136";
        for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
        for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 5);
      },
      height: (ctx, w, h) => {
        ctx.fillStyle = grey(120);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = grey(255);
        for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
        for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 5);
      },
      roughness: (ctx, w, h) => {
        ctx.fillStyle = grey(14);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = grey(160);
        for (let x = 0; x < w; x += 32) ctx.fillRect(x, 0, 3, h);
        for (let y = 0; y < h; y += 64) ctx.fillRect(0, y, w, 5);
      },
      metalness: (ctx, w, h) => {
        ctx.fillStyle = grey(150);
        ctx.fillRect(0, 0, w, h);
      },
    },
    1.2,
    41 + variant,
  );

/** Ribbed stainless steel for subway car bodies. */
export const ribbedSteelSet = () =>
  pbrSet(
    "ribbed-steel",
    [256, 256],
    {
      albedo: (ctx, w, h, rng) => {
        const gradient = ctx.createLinearGradient(0, 0, 0, h);
        gradient.addColorStop(0, "#c9ccd0");
        gradient.addColorStop(1, "#b3b6ba");
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 2000, 120, 230, 0.08);
        streaks(ctx, w, h, rng, 12, "rgba(70,60,50,ALPHA)");
      },
      height: (ctx, w, h) => {
        for (let x = 0; x < w; x++) {
          const v = 128 + Math.sin((x / w) * Math.PI * 2 * 16) * 110;
          ctx.fillStyle = grey(Math.round(v));
          ctx.fillRect(x, 0, 1, h);
        }
      },
      roughness: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(90);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 1500, 60, 160, 0.3, [2, 8]);
      },
    },
    1.4,
    51,
  );

/** Diamond tread plate (ramps, walkways). */
export const treadPlateSet = () =>
  pbrSet(
    "tread-plate",
    [256, 256],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = "#8f9397";
        ctx.fillRect(0, 0, w, h);
        blotches(ctx, w, h, rng, 10, "rgba(90,60,30,ALPHA)", [20, 60], [0.1, 0.25]);
        speckle(ctx, w, h, rng, 1500, 80, 200, 0.15);
      },
      height: (ctx, w, h) => {
        ctx.fillStyle = grey(60);
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = grey(255);
        for (let y = 0; y < h; y += 32) {
          for (let x = 0; x < w; x += 32) {
            ctx.save();
            ctx.translate(x + ((y / 32) % 2) * 16 + 8, y + 8);
            ctx.rotate(((y / 32) % 2 === 0 ? 1 : -1) * 0.7);
            ctx.fillRect(-9, -2, 18, 4);
            ctx.restore();
          }
        }
      },
      roughness: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(110);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 1200, 80, 200, 0.3, [3, 9]);
      },
    },
    3,
    61,
  );

/** Rusted, pitted steel (rail webs, old fittings). */
export const rustSet = () =>
  pbrSet(
    "rust",
    [256, 256],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = "#5a3a26";
        ctx.fillRect(0, 0, w, h);
        blotches(ctx, w, h, rng, 26, "rgba(140,70,30,ALPHA)", [10, 50], [0.2, 0.5]);
        blotches(ctx, w, h, rng, 20, "rgba(40,30,25,ALPHA)", [10, 40], [0.2, 0.4]);
        speckle(ctx, w, h, rng, 3000, 40, 160, 0.2);
      },
      height: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(128);
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 5000, 60, 220, 0.5, [1, 4]);
      },
    },
    2,
    71,
  );

/** Denim twill for jeans. */
export const denimSet = (color: string) =>
  pbrSet(
    `denim-${color}`,
    [128, 128],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = "rgba(255,255,255,0.08)";
        for (let i = -h; i < w; i += 3) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + h, h);
          ctx.stroke();
        }
        blotches(ctx, w, h, rng, 6, "rgba(255,255,255,ALPHA)", [10, 30], [0.03, 0.08]);
      },
      height: (ctx, w, h) => {
        ctx.fillStyle = grey(120);
        ctx.fillRect(0, 0, w, h);
        ctx.strokeStyle = grey(220);
        ctx.lineWidth = 1.2;
        for (let i = -h; i < w; i += 3) {
          ctx.beginPath();
          ctx.moveTo(i, 0);
          ctx.lineTo(i + h, h);
          ctx.stroke();
        }
      },
    },
    1.5,
    81,
  );

/** Knit/fleece fabric for hoodies and jackets. */
export const fabricSet = (color: string) =>
  pbrSet(
    `fabric-${color}`,
    [128, 128],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        speckle(ctx, w, h, rng, 1400, 0, 255, 0.05, [1, 2]);
      },
      height: (ctx, w, h) => {
        for (let y = 0; y < h; y += 2) {
          for (let x = 0; x < w; x += 2) {
            ctx.fillStyle = grey(((x + y) / 2) % 2 === 0 ? 170 : 110);
            ctx.fillRect(x, y, 2, 2);
          }
        }
      },
    },
    0.8,
    91,
  );

/** Short hair strands (normal detail + subtle colour variation). */
export const hairSet = (color: string) =>
  pbrSet(
    `hair-${color}`,
    [128, 128],
    {
      albedo: (ctx, w, h, rng) => {
        ctx.fillStyle = color;
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 600; i++) {
          ctx.strokeStyle = `rgba(${rng.chance(0.5) ? "255,255,255" : "0,0,0"},${rng.range(0.04, 0.12)})`;
          ctx.beginPath();
          const x = rng.range(0, w);
          ctx.moveTo(x, 0);
          ctx.lineTo(x + rng.range(-6, 6), h);
          ctx.stroke();
        }
      },
      height: (ctx, w, h, rng) => {
        ctx.fillStyle = grey(128);
        ctx.fillRect(0, 0, w, h);
        for (let i = 0; i < 500; i++) {
          ctx.strokeStyle = grey(Math.floor(rng.range(60, 230)));
          ctx.beginPath();
          const x = rng.range(0, w);
          ctx.moveTo(x, 0);
          ctx.lineTo(x + rng.range(-4, 4), h);
          ctx.stroke();
        }
      },
    },
    1.2,
    101,
  );

/** Woven carbon fibre (hoverboard decks). */
export const carbonSet = () =>
  pbrSet(
    "carbon",
    [128, 128],
    {
      albedo: (ctx, w, h) => {
        for (let y = 0; y < h; y += 8) {
          for (let x = 0; x < w; x += 8) {
            const even = ((x + y) / 8) % 2 === 0;
            const gradient = even ? ctx.createLinearGradient(x, y, x + 8, y) : ctx.createLinearGradient(x, y, x, y + 8);
            gradient.addColorStop(0, "#1a1c1f");
            gradient.addColorStop(0.5, "#3a3e44");
            gradient.addColorStop(1, "#1a1c1f");
            ctx.fillStyle = gradient;
            ctx.fillRect(x, y, 8, 8);
          }
        }
      },
      height: (ctx, w, h) => {
        for (let y = 0; y < h; y += 8) {
          for (let x = 0; x < w; x += 8) {
            ctx.fillStyle = grey(((x + y) / 8) % 2 === 0 ? 200 : 90);
            ctx.fillRect(x, y, 8, 8);
          }
        }
      },
    },
    1,
    111,
  );

/** Embossed gold coin face. */
export const coinFaceSet = () =>
  pbrSet(
    "coin-face",
    [256, 256],
    {
      albedo: (ctx, w, h) => {
        ctx.fillStyle = "#e8b43a";
        ctx.fillRect(0, 0, w, h);
      },
      height: (ctx, w, h) => {
        const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
        gradient.addColorStop(0, grey(120));
        gradient.addColorStop(0.8, grey(120));
        gradient.addColorStop(0.86, grey(240));
        gradient.addColorStop(0.95, grey(240));
        gradient.addColorStop(1, grey(60));
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, w, h);
        ctx.fillStyle = grey(255);
        ctx.font = "900 150px 'Lilita One', 'Arial Black', sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText("M", w / 2, h / 2 + 8);
      },
    },
    5,
    121,
  );

const SPRAY_COLORS = ["#e8413c", "#f2b134", "#3e8ed0", "#2fb58a", "#c04fc1", "#f2f2f2", "#1f1f1f", "#ff7b2e"];
const SPRAY_WORDS = ["RUSH", "NOVA", "DXT", "KRU", "LOOP", "AERO", "VEX", "MIRA", "ZENO", "OKAY", "BLOK"];

/**
 * Spray-paint graffiti decal on a transparent canvas: soft overspray, thin
 * outlines, highlights and drips, so it reads as paint on concrete rather
 * than a cartoon sticker.
 */
export const graffitiDecal = (variant: number): THREE.CanvasTexture => {
  const key = `graffiti-${variant}`;
  const existing = cache.get(key);
  if (existing) return existing.map;
  const [element, ctx] = canvas(1024, 384);
  const rng = new Random(variant * 131 + 7);
  const w = element.width;
  const h = element.height;
  const fill = rng.pick(SPRAY_COLORS.slice(0, 5));
  const second = rng.pick(SPRAY_COLORS.filter((c) => c !== fill));
  const outline = rng.pick(["#141414", "#f2f2f2", "#1b2a4a"]);
  const word = rng.pick(SPRAY_WORDS);
  ctx.save();
  ctx.translate(w / 2, h / 2 + 10);
  ctx.rotate(rng.range(-0.08, 0.08));
  ctx.font = `italic 900 ${rng.int(170, 210)}px "Arial Black", Impact, sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  // Overspray halo and a drop-shadow block.
  ctx.shadowColor = "rgba(0,0,0,0.55)";
  ctx.shadowBlur = 18;
  ctx.fillStyle = outline;
  ctx.fillText(word, 10, 10);
  ctx.shadowBlur = 6;
  ctx.shadowColor = outline;
  ctx.lineWidth = 16;
  ctx.strokeStyle = outline;
  ctx.strokeText(word, 0, 0);
  const gradient = ctx.createLinearGradient(0, -90, 0, 90);
  gradient.addColorStop(0, fill);
  gradient.addColorStop(0.55, fill);
  gradient.addColorStop(0.62, second);
  gradient.addColorStop(1, second);
  ctx.fillStyle = gradient;
  ctx.shadowBlur = 3;
  ctx.fillText(word, 0, 0);
  ctx.shadowBlur = 0;
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.font = ctx.font.replace(/\d+px/, (m) => m);
  ctx.fillText(word, -4, -6);
  ctx.restore();
  // Paint drips.
  ctx.fillStyle = fill;
  for (let i = 0; i < 14; i++) {
    const x = rng.range(w * 0.2, w * 0.8);
    const y = rng.range(h * 0.55, h * 0.7);
    const length = rng.range(15, 70);
    ctx.globalAlpha = 0.7;
    ctx.fillRect(x, y, rng.range(2, 4), length);
    ctx.beginPath();
    ctx.arc(x + 1.5, y + length, 3, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
  // Weathering: fade patches so the paint looks old.
  ctx.globalCompositeOperation = "destination-out";
  for (let i = 0; i < 400; i++) {
    ctx.fillStyle = `rgba(0,0,0,${rng.range(0.05, 0.3)})`;
    ctx.fillRect(rng.range(0, w), rng.range(0, h), rng.range(2, 12), rng.range(2, 12));
  }
  ctx.globalCompositeOperation = "source-over";
  const texture = toTexture(element, true);
  texture.wrapS = THREE.ClampToEdgeWrapping;
  texture.wrapT = THREE.ClampToEdgeWrapping;
  cache.set(key, { map: texture });
  return texture;
};

/** Lit window glow (warm) or LED panel texture for small emissive details. */
export const signTexture = (key: string, text: string, color: string, background = "#101010"): THREE.CanvasTexture => {
  const existing = cache.get(`sign-${key}`);
  if (existing) return existing.map;
  const [element, ctx] = canvas(512, 128);
  ctx.fillStyle = background;
  ctx.fillRect(0, 0, 512, 128);
  ctx.fillStyle = color;
  ctx.font = "700 76px 'Arial Narrow', Arial, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(text, 256, 68);
  const texture = toTexture(element, true);
  cache.set(`sign-${key}`, { map: texture });
  return texture;
};
