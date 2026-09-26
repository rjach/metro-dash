export type HairStyle = "capBack" | "ponytail" | "beanie" | "buns" | "spiky" | "afroPuff";
export type Accessory = "none" | "headphones" | "goggles" | "backpack" | "headband";

export interface CharacterPalette {
  skin: string;
  hair: string;
  top: string;
  topAccent: string;
  bottom: string;
  shoes: string;
  shoesAccent: string;
  hat: string;
}

export interface CharacterDef {
  id: string;
  name: string;
  tagline: string;
  price: number;
  palette: CharacterPalette;
  hairStyle: HairStyle;
  accessory: Accessory;
}

/** All characters are original designs; they differ cosmetically only. */
export const CHARACTERS: readonly CharacterDef[] = [
  {
    id: "jett",
    name: "Jett",
    tagline: "Tags walls faster than trains leave.",
    price: 0,
    palette: {
      skin: "#f1c09b",
      hair: "#3b2a1f",
      top: "#2f7de1",
      topAccent: "#ffd23f",
      bottom: "#27416b",
      shoes: "#ffffff",
      shoesAccent: "#ff4b3e",
      hat: "#ff4b3e",
    },
    hairStyle: "capBack",
    accessory: "none",
  },
  {
    id: "nova",
    name: "Nova",
    tagline: "Never met a roof she couldn't reach.",
    price: 1500,
    palette: {
      skin: "#c98b62",
      hair: "#8e3bd6",
      top: "#ffc629",
      topAccent: "#ff5d8f",
      bottom: "#1f1f2e",
      shoes: "#ff5d8f",
      shoesAccent: "#ffffff",
      hat: "#8e3bd6",
    },
    hairStyle: "ponytail",
    accessory: "headband",
  },
  {
    id: "dex",
    name: "Dex",
    tagline: "Beats in his ears, rails under his feet.",
    price: 3000,
    palette: {
      skin: "#8d5a3b",
      hair: "#1c1c1c",
      top: "#ff7a1a",
      topAccent: "#2b2b2b",
      bottom: "#4a5a2c",
      shoes: "#2bd46b",
      shoesAccent: "#101010",
      hat: "#1f9e5a",
    },
    hairStyle: "beanie",
    accessory: "headphones",
  },
  {
    id: "kiki",
    name: "Kiki",
    tagline: "Double buns, double speed.",
    price: 5000,
    palette: {
      skin: "#ffd9bf",
      hair: "#ff6fb5",
      top: "#18c1c9",
      topAccent: "#ffffff",
      bottom: "#6d3fd1",
      shoes: "#ffffff",
      shoesAccent: "#18c1c9",
      hat: "#ff6fb5",
    },
    hairStyle: "buns",
    accessory: "backpack",
  },
  {
    id: "bolt",
    name: "Bolt",
    tagline: "Goggles on. Brakes off.",
    price: 8000,
    palette: {
      skin: "#e8b48c",
      hair: "#ffcf2e",
      top: "#d7263d",
      topAccent: "#1b1b1b",
      bottom: "#2b2d42",
      shoes: "#1b1b1b",
      shoesAccent: "#ffcf2e",
      hat: "#d7263d",
    },
    hairStyle: "spiky",
    accessory: "goggles",
  },
  {
    id: "mara",
    name: "Mara",
    tagline: "Runs the city like it owes her.",
    price: 12000,
    palette: {
      skin: "#6b412a",
      hair: "#241712",
      top: "#3ddc97",
      topAccent: "#0b3d2e",
      bottom: "#ececec",
      shoes: "#ff9f1c",
      shoesAccent: "#ffffff",
      hat: "#ff9f1c",
    },
    hairStyle: "afroPuff",
    accessory: "headband",
  },
];

export const DEFAULT_CHARACTER_ID = CHARACTERS[0]!.id;

export const findCharacter = (id: string): CharacterDef => CHARACTERS.find((character) => character.id === id) ?? CHARACTERS[0]!;
