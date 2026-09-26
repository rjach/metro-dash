export type BoardPattern = "stripes" | "flames" | "stars" | "checker" | "bolt" | "waves";

export type BoardPerk =
  | { kind: "none" }
  | { kind: "jumpBoost"; multiplier: number }
  | { kind: "longRide"; bonusSeconds: number }
  | { kind: "magnet"; radius: number }
  | { kind: "glide"; gravityScale: number };

export interface BoardDef {
  id: string;
  name: string;
  description: string;
  price: number;
  deck: string;
  accent: string;
  glow: string;
  pattern: BoardPattern;
  perk: BoardPerk;
}

/**
 * Skateboards act as hoverboards: activating one protects the runner from a
 * single crash for its duration. Each board adds a perk while riding.
 */
export const BOARDS: readonly BoardDef[] = [
  {
    id: "starter",
    name: "Street Deck",
    description: "Reliable. Absorbs one crash.",
    price: 0,
    deck: "#2f7de1",
    accent: "#ffd23f",
    glow: "#6fd3ff",
    pattern: "stripes",
    perk: { kind: "none" },
  },
  {
    id: "hopper",
    name: "Hopper",
    description: "Bouncy trucks: higher jumps while riding.",
    price: 2000,
    deck: "#2bd46b",
    accent: "#0f5132",
    glow: "#b6ff6f",
    pattern: "waves",
    perk: { kind: "jumpBoost", multiplier: 1.4 },
  },
  {
    id: "marathon",
    name: "Long Haul",
    description: "Extra-large battery: +12 s ride time.",
    price: 3500,
    deck: "#ff7a1a",
    accent: "#fff3e0",
    glow: "#ffb870",
    pattern: "checker",
    perk: { kind: "longRide", bonusSeconds: 12 },
  },
  {
    id: "magneto",
    name: "Magneto",
    description: "Pulls nearby coins while riding.",
    price: 6000,
    deck: "#d7263d",
    accent: "#f5f5f5",
    glow: "#ff6b81",
    pattern: "bolt",
    perk: { kind: "magnet", radius: 4.5 },
  },
  {
    id: "feather",
    name: "Feather",
    description: "Floaty landings: slower falls while riding.",
    price: 9000,
    deck: "#8e3bd6",
    accent: "#ffc6ff",
    glow: "#e0a3ff",
    pattern: "stars",
    perk: { kind: "glide", gravityScale: 0.6 },
  },
  {
    id: "inferno",
    name: "Inferno",
    description: "Hot rod: +6 s ride and higher jumps.",
    price: 15000,
    deck: "#1b1b1b",
    accent: "#ff4b1f",
    glow: "#ffae00",
    pattern: "flames",
    perk: { kind: "jumpBoost", multiplier: 1.25 },
  },
];

export const DEFAULT_BOARD_ID = BOARDS[0]!.id;

export const findBoard = (id: string): BoardDef => BOARDS.find((board) => board.id === id) ?? BOARDS[0]!;

export const boardJumpMultiplier = (board: BoardDef): number => (board.perk.kind === "jumpBoost" ? board.perk.multiplier : 1);

export const boardBonusSeconds = (board: BoardDef): number => {
  if (board.perk.kind === "longRide") return board.perk.bonusSeconds;
  if (board.id === "inferno") return 6;
  return 0;
};

export const boardMagnetRadius = (board: BoardDef): number => (board.perk.kind === "magnet" ? board.perk.radius : 0);

export const boardGravityScale = (board: BoardDef): number => (board.perk.kind === "glide" ? board.perk.gravityScale : 1);
