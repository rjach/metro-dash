import type { TimedPowerUp } from "../game/types";

export interface PowerUpDef {
  kind: TimedPowerUp;
  name: string;
  description: string;
  color: string;
  baseDuration: number;
  durationPerLevel: number;
}

export const MAX_UPGRADE_LEVEL = 5;
export const UPGRADE_COSTS: readonly number[] = [500, 1200, 2500, 5000, 10000];

export const POWER_UPS: Record<TimedPowerUp, PowerUpDef> = {
  magnet: { kind: "magnet", name: "Coin Magnet", description: "Pulls every nearby coin to you.", color: "#ff3b3b", baseDuration: 10, durationPerLevel: 2.5 },
  jetpack: { kind: "jetpack", name: "Jetpack", description: "Fly high above the trains.", color: "#ffb300", baseDuration: 7, durationPerLevel: 1.5 },
  sneakers: {
    kind: "sneakers",
    name: "Super Sneakers",
    description: "Jump onto trains in one leap.",
    color: "#2bd46b",
    baseDuration: 10,
    durationPerLevel: 2.5,
  },
  multiplier: {
    kind: "multiplier",
    name: "2x Multiplier",
    description: "Doubles your score multiplier.",
    color: "#2f7de1",
    baseDuration: 12,
    durationPerLevel: 3,
  },
};

export const powerUpDuration = (kind: TimedPowerUp, level: number): number => {
  const def = POWER_UPS[kind];
  return def.baseDuration + def.durationPerLevel * Math.max(0, Math.min(MAX_UPGRADE_LEVEL, level));
};

export const SHOP_ITEMS = {
  hoverboardPack: { name: "Hoverboards ×3", quantity: 3, price: 450 },
  key: { name: "Key", quantity: 1, price: 1800 },
  headstart: { name: "Headstart", quantity: 1, price: 2000 },
} as const;
