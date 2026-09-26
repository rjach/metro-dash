import * as THREE from "three";
import { Random } from "../core/math";

/**
 * Procedurally painted canvas textures. Everything visual is generated at
 * runtime so the game ships no third-party artwork.
 */

type Painter = (ctx: CanvasRenderingContext2D, width: number, height: number, rng: Random) => void;

const cache = new Map<string, THREE.CanvasTexture>();

let maxAnisotropy = 4;
export const setMaxAnisotropy = (value: number) => {
  maxAnisotropy = value;
};

export const paintTexture = (key: string, width: number, height: number, painter: Painter, seed = 1): THREE.CanvasTexture => {
  const existing = cache.get(key);
  if (existing) return existing;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error(`Canvas 2D context unavailable while painting texture "${key}"`);
  painter(ctx, width, height, new Random(seed));
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.anisotropy = maxAnisotropy;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  cache.set(key, texture);
  return texture;
};

const GRAFFITI_COLORS = ["#ff3d7f", "#ffd23f", "#3ddc97", "#2f7de1", "#ff7a1a", "#8e3bd6", "#18c1c9", "#ffffff"];
const TAG_WORDS = ["DASH", "RUN", "METRO", "YO!", "ZAP", "FLY", "GO", "WOW", "BOOM", "HYPE", "JAM", "RAD", "KRU", "VIBE"];

/** Bubble-letter tag with outline and highlight, the staple of the genre's walls and trains. */
export const drawTag = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number, rng: Random) => {
  const word = rng.pick(TAG_WORDS);
  const fill = rng.pick(GRAFFITI_COLORS);
  let outline = rng.pick(GRAFFITI_COLORS);
  if (outline === fill) outline = "#1b1b2f";
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rng.range(-0.18, 0.18));
  ctx.font = `900 ${size}px "Lilita One", "Arial Black", sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.lineJoin = "round";
  ctx.lineWidth = size * 0.28;
  ctx.strokeStyle = "#141421";
  ctx.strokeText(word, 0, 0);
  ctx.lineWidth = size * 0.14;
  ctx.strokeStyle = outline;
  ctx.strokeText(word, 0, 0);
  ctx.fillStyle = fill;
  ctx.fillText(word, 0, 0);
  ctx.globalAlpha = 0.35;
  ctx.fillStyle = "#ffffff";
  ctx.fillText(word, -size * 0.05, -size * 0.08);
  ctx.restore();
};

const drawSplat = (ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, rng: Random) => {
  ctx.fillStyle = rng.pick(GRAFFITI_COLORS);
  ctx.beginPath();
  const points = 12;
  for (let i = 0; i <= points; i++) {
    const angle = (i / points) * Math.PI * 2;
    const r = radius * rng.range(0.6, 1.15);
    ctx.lineTo(x + Math.cos(angle) * r, y + Math.sin(angle) * r);
  }
  ctx.fill();
};

export const gravelTexture = () =>
  paintTexture("gravel", 256, 256, (ctx, w, h, rng) => {
    ctx.fillStyle = "#8a7560";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 2600; i++) {
      const shade = rng.int(90, 170);
      ctx.fillStyle = `rgb(${shade + 10},${shade - 5},${shade - 25})`;
      const size = rng.range(1, 4);
      ctx.fillRect(rng.range(0, w), rng.range(0, h), size, size);
    }
  });

export const sleeperTexture = () =>
  paintTexture("sleeper", 64, 16, (ctx, w, h, rng) => {
    ctx.fillStyle = "#6b4a2f";
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      ctx.fillStyle = `rgba(40,25,10,${rng.range(0.1, 0.35)})`;
      ctx.fillRect(0, rng.range(0, h), w, 1);
    }
  });

export const graffitiWallTexture = (variant: number) =>
  paintTexture(
    `wall-${variant}`,
    512,
    256,
    (ctx, w, h, rng) => {
      const bases = ["#c9b8a6", "#b7c3c9", "#d6c29a", "#bfb2c9"];
      ctx.fillStyle = bases[variant % bases.length]!;
      ctx.fillRect(0, 0, w, h);
      // Concrete panels.
      ctx.strokeStyle = "rgba(0,0,0,0.12)";
      ctx.lineWidth = 3;
      for (let x = 0; x < w; x += 128) ctx.strokeRect(x, 0, 128, h);
      for (let i = 0; i < 5; i++) drawSplat(ctx, rng.range(0, w), rng.range(h * 0.3, h), rng.range(18, 50), rng);
      for (let i = 0; i < 3; i++) drawTag(ctx, rng.range(70, w - 70), rng.range(h * 0.35, h * 0.8), rng.range(48, 76), rng);
      ctx.fillStyle = "rgba(0,0,0,0.18)";
      ctx.fillRect(0, h - 18, w, 18);
    },
    variant * 97 + 3,
  );

export const buildingTexture = (variant: number) =>
  paintTexture(
    `building-${variant}`,
    256,
    512,
    (ctx, w, h, rng) => {
      const facades = ["#e8a87c", "#85c1e9", "#f7dc6f", "#c39bd3", "#76d7c4", "#f1948a", "#f0b27a"];
      ctx.fillStyle = facades[variant % facades.length]!;
      ctx.fillRect(0, 0, w, h);
      const cols = 4;
      const rows = 9;
      const cw = w / cols;
      const rh = h / rows;
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const lit = rng.chance(0.3);
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(c * cw + 10, r * rh + 12, cw - 20, rh - 18);
          ctx.fillStyle = lit ? "#fff4c2" : "#5d8aa8";
          ctx.fillRect(c * cw + 13, r * rh + 14, cw - 26, rh - 24);
          ctx.fillStyle = "rgba(255,255,255,0.35)";
          ctx.fillRect(c * cw + 13, r * rh + 14, (cw - 26) * 0.4, rh - 24);
        }
      }
      ctx.fillStyle = "rgba(0,0,0,0.15)";
      ctx.fillRect(0, 0, w, 10);
    },
    variant * 13 + 5,
  );

export const TRAIN_LIVERIES = [
  { body: "#f2c230", stripe: "#e6392f", roof: "#b5b5b5" },
  { body: "#2f7de1", stripe: "#ffffff", roof: "#9aa5b1" },
  { body: "#d7263d", stripe: "#ffd23f", roof: "#a8a8a8" },
  { body: "#c7d3dd", stripe: "#1f9e5a", roof: "#8d99a6" },
] as const;

export const trainSideTexture = (variant: number) =>
  paintTexture(
    `train-side-${variant}`,
    1024,
    256,
    (ctx, w, h, rng) => {
      const livery = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length]!;
      ctx.fillStyle = livery.body;
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = livery.stripe;
      ctx.fillRect(0, h * 0.62, w, h * 0.1);
      // Windows and doors.
      for (let i = 0; i < 6; i++) {
        const x = 40 + i * 165;
        if (i % 3 === 1) {
          ctx.fillStyle = "rgba(0,0,0,0.25)";
          ctx.fillRect(x - 4, h * 0.14, 94, h * 0.8);
          ctx.fillStyle = "#34495e";
          ctx.fillRect(x, h * 0.18, 40, h * 0.38);
          ctx.fillRect(x + 46, h * 0.18, 40, h * 0.38);
        } else {
          ctx.fillStyle = "#1f2d3a";
          ctx.beginPath();
          ctx.roundRect(x, h * 0.16, 120, h * 0.36, 14);
          ctx.fill();
          ctx.fillStyle = "rgba(160,220,255,0.55)";
          ctx.beginPath();
          ctx.roundRect(x + 6, h * 0.19, 108, h * 0.3, 10);
          ctx.fill();
          ctx.fillStyle = "rgba(255,255,255,0.4)";
          ctx.fillRect(x + 14, h * 0.21, 26, h * 0.26);
        }
      }
      if (rng.chance(0.85)) drawTag(ctx, rng.range(200, w - 200), h * 0.78, rng.range(56, 80), rng);
      ctx.fillStyle = "rgba(0,0,0,0.3)";
      ctx.fillRect(0, h - 14, w, 14);
      ctx.fillRect(0, 0, w, 6);
    },
    variant * 31 + 7,
  );

export const trainFrontTexture = (variant: number) =>
  paintTexture(`train-front-${variant}`, 256, 256, (ctx, w, h) => {
    const livery = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length]!;
    ctx.fillStyle = livery.body;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = "#1f2d3a";
    ctx.beginPath();
    ctx.roundRect(28, 30, w - 56, 92, 16);
    ctx.fill();
    ctx.fillStyle = "rgba(160,220,255,0.6)";
    ctx.beginPath();
    ctx.roundRect(36, 38, w - 72, 76, 12);
    ctx.fill();
    ctx.fillStyle = livery.stripe;
    ctx.fillRect(0, 150, w, 22);
    for (const x of [48, w - 48]) {
      ctx.fillStyle = "#fffbe0";
      ctx.beginPath();
      ctx.arc(x, 205, 18, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = "#333";
      ctx.lineWidth = 5;
      ctx.stroke();
    }
    ctx.fillStyle = "#222";
    ctx.fillRect(w / 2 - 30, 190, 60, 36);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "bold 26px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(String(10 + variant * 7), w / 2, 218);
  });

/**
 * Single atlas per livery so a whole train is one material: top half = side
 * panel, bottom row = front | roof | underside quads.
 */
export const trainAtlasTexture = (variant: number) =>
  paintTexture(`train-atlas-${variant}`, 1024, 512, (ctx) => {
    const side = trainSideTexture(variant).image as HTMLCanvasElement;
    const front = trainFrontTexture(variant).image as HTMLCanvasElement;
    const livery = TRAIN_LIVERIES[variant % TRAIN_LIVERIES.length]!;
    ctx.drawImage(side, 0, 0, 1024, 256);
    ctx.drawImage(front, 0, 256, 256, 256);
    ctx.fillStyle = livery.roof;
    ctx.fillRect(256, 256, 256, 256);
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    for (let i = 0; i < 4; i++) ctx.fillRect(256 + 40 + i * 50, 300, 26, 170);
    ctx.fillStyle = "#2b2b2b";
    ctx.fillRect(512, 256, 256, 256);
  });

export const stripeTexture = (key: string, a: string, b: string, stripes = 6, diagonal = true) =>
  paintTexture(key, 128, 128, (ctx, w, h) => {
    ctx.fillStyle = a;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = b;
    const step = w / stripes;
    for (let i = -stripes; i < stripes * 2; i += 2) {
      ctx.beginPath();
      if (diagonal) {
        ctx.moveTo(i * step, 0);
        ctx.lineTo((i + 1) * step, 0);
        ctx.lineTo((i + 1) * step - h, h);
        ctx.lineTo(i * step - h, h);
      } else {
        ctx.rect(i * step, 0, step, h);
      }
      ctx.fill();
    }
  });

export const coinTexture = () =>
  paintTexture("coin", 128, 128, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w * 0.4, h * 0.35, 4, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "#fff6b0");
    gradient.addColorStop(0.55, "#ffcc1f");
    gradient.addColorStop(1, "#d98c00");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#b36b00";
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, w * 0.36, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "#c27a00";
    ctx.font = "900 58px 'Lilita One', 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("M", w / 2, h / 2 + 3);
  });

export const mysteryTexture = () =>
  paintTexture("mystery", 128, 128, (ctx, w, h) => {
    ctx.fillStyle = "#8e3bd6";
    ctx.fillRect(0, 0, w, h);
    ctx.strokeStyle = "#ffd23f";
    ctx.lineWidth = 10;
    ctx.strokeRect(5, 5, w - 10, h - 10);
    ctx.fillStyle = "#ffd23f";
    ctx.font = "900 86px 'Lilita One', 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineWidth = 8;
    ctx.strokeStyle = "#3b1466";
    ctx.strokeText("?", w / 2, h / 2 + 4);
    ctx.fillText("?", w / 2, h / 2 + 4);
  });

export const labelTexture = (key: string, text: string, fill: string, stroke: string) =>
  paintTexture(key, 128, 128, (ctx, w, h) => {
    ctx.clearRect(0, 0, w, h);
    ctx.font = "900 70px 'Lilita One', 'Arial Black', sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.lineJoin = "round";
    ctx.lineWidth = 14;
    ctx.strokeStyle = stroke;
    ctx.strokeText(text, w / 2, h / 2 + 4);
    ctx.fillStyle = fill;
    ctx.fillText(text, w / 2, h / 2 + 4);
  });

export const glowTexture = () =>
  paintTexture("glow", 64, 64, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(255,255,255,1)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.55)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });

export const shadowTexture = () =>
  paintTexture("shadow", 64, 64, (ctx, w, h) => {
    const gradient = ctx.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gradient.addColorStop(0, "rgba(0,0,0,0.55)");
    gradient.addColorStop(0.6, "rgba(0,0,0,0.3)");
    gradient.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });

export const skyTexture = () =>
  paintTexture("sky", 16, 256, (ctx, w, h) => {
    const gradient = ctx.createLinearGradient(0, 0, 0, h);
    gradient.addColorStop(0, "#3d9be9");
    gradient.addColorStop(0.55, "#8fd0ff");
    gradient.addColorStop(0.8, "#d8f1ff");
    gradient.addColorStop(1, "#fdf3d8");
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  });

export const boardDeckTexture = (key: string, deck: string, accent: string, pattern: string) =>
  paintTexture(key, 256, 64, (ctx, w, h, rng) => {
    ctx.fillStyle = deck;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = accent;
    ctx.strokeStyle = accent;
    switch (pattern) {
      case "stripes":
        for (let x = 20; x < w; x += 44) ctx.fillRect(x, 0, 16, h);
        break;
      case "checker":
        for (let x = 0; x < w; x += 16) for (let y = 0; y < h; y += 16) if (((x + y) / 16) % 2 === 0) ctx.fillRect(x, y, 16, 16);
        break;
      case "stars":
        for (let i = 0; i < 12; i++) {
          const cx = rng.range(10, w - 10);
          const cy = rng.range(8, h - 8);
          ctx.beginPath();
          for (let p = 0; p < 10; p++) {
            const r = p % 2 === 0 ? 9 : 4;
            const a = (p / 10) * Math.PI * 2 - Math.PI / 2;
            ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
          }
          ctx.fill();
        }
        break;
      case "flames":
        for (let x = 0; x < w; x += 36) {
          ctx.beginPath();
          ctx.moveTo(x, h);
          ctx.quadraticCurveTo(x + 10, h * 0.3, x + 28, 4);
          ctx.quadraticCurveTo(x + 20, h * 0.5, x + 36, h);
          ctx.fill();
        }
        break;
      case "bolt":
        ctx.beginPath();
        ctx.moveTo(30, h * 0.5);
        ctx.lineTo(110, 8);
        ctx.lineTo(100, h * 0.45);
        ctx.lineTo(226, h * 0.5);
        ctx.lineTo(146, h - 8);
        ctx.lineTo(156, h * 0.55);
        ctx.closePath();
        ctx.fill();
        break;
      default:
        ctx.lineWidth = 6;
        for (let y = 10; y < h; y += 18) {
          ctx.beginPath();
          for (let x = 0; x <= w; x += 8) ctx.lineTo(x, y + Math.sin(x / 16) * 5);
          ctx.stroke();
        }
    }
  });

export const disposeTextureCache = () => {
  for (const texture of cache.values()) texture.dispose();
  cache.clear();
};
