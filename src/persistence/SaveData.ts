import { BOARDS, DEFAULT_BOARD_ID } from "../content/boards";
import { CHARACTERS, DEFAULT_CHARACTER_ID } from "../content/characters";
import { MAX_UPGRADE_LEVEL } from "../content/powerups";
import { initialMissionState, sanitizeMissionState, type MissionState } from "../game/missions";
import type { TimedPowerUp } from "../game/types";

export const SAVE_VERSION = 1;

export type InputMode = "keyboard" | "camera";
export type GraphicsQuality = "low" | "medium" | "high";

export interface CalibrationProfile {
  centerX: number;
  shoulderY: number;
  hipY: number;
  shoulderWidth: number;
  torsoLength: number;
  /** Relaxed hand heights (torso lengths above the hips) captured during calibration. */
  leftHandRest: number;
  rightHandRest: number;
  capturedAt: number;
}

export type LaneGesture = "hands" | "lean";
export type Difficulty = "easy" | "normal" | "hard";

export interface Settings {
  musicVolume: number;
  sfxVolume: number;
  muted: boolean;
  inputMode: InputMode;
  /** How lane changes are made in camera mode: raising a hand, or leaning/stepping. */
  laneGesture: LaneGesture;
  difficulty: Difficulty;
  cameraSensitivity: number;
  showCameraPreview: boolean;
  graphicsQuality: GraphicsQuality;
  reducedMotion: boolean;
  showFps: boolean;
}

export interface SaveData {
  version: number;
  highScore: number;
  bestDistance: number;
  bestCoinsInRun: number;
  coins: number;
  keys: number;
  hoverboards: number;
  headstarts: number;
  totalRuns: number;
  totalCoinsCollected: number;
  totalDistance: number;
  ownedCharacters: string[];
  ownedBoards: string[];
  selectedCharacter: string;
  selectedBoard: string;
  upgrades: Record<TimedPowerUp, number>;
  /** Mission sets; completing a set raises the permanent score multiplier (1 + level). */
  missions: MissionState;
  settings: Settings;
  calibration: CalibrationProfile | null;
  tutorialSeen: boolean;
}

export const DEFAULT_SETTINGS: Settings = {
  musicVolume: 0.55,
  sfxVolume: 0.8,
  muted: false,
  inputMode: "keyboard",
  laneGesture: "hands",
  difficulty: "easy",
  cameraSensitivity: 1,
  showCameraPreview: true,
  graphicsQuality: "high",
  reducedMotion: false,
  showFps: false,
};

export const createDefaultSave = (): SaveData => ({
  version: SAVE_VERSION,
  highScore: 0,
  bestDistance: 0,
  bestCoinsInRun: 0,
  coins: 0,
  keys: 1,
  hoverboards: 3,
  headstarts: 1,
  totalRuns: 0,
  totalCoinsCollected: 0,
  totalDistance: 0,
  ownedCharacters: [DEFAULT_CHARACTER_ID],
  ownedBoards: [DEFAULT_BOARD_ID],
  selectedCharacter: DEFAULT_CHARACTER_ID,
  selectedBoard: DEFAULT_BOARD_ID,
  upgrades: { magnet: 0, jetpack: 0, sneakers: 0, multiplier: 0 },
  missions: initialMissionState(),
  settings: { ...DEFAULT_SETTINGS },
  calibration: null,
  tutorialSeen: false,
});

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

const num = (value: unknown, fallback: number, min = 0, max = Number.MAX_SAFE_INTEGER): number =>
  typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(min, value)) : fallback;

const bool = (value: unknown, fallback: boolean): boolean => (typeof value === "boolean" ? value : fallback);

const oneOf = <T extends string>(value: unknown, allowed: readonly T[], fallback: T): T =>
  typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;

const idList = (value: unknown, known: readonly string[], required: string): string[] => {
  const list = Array.isArray(value) ? value.filter((id): id is string => typeof id === "string" && known.includes(id)) : [];
  return Array.from(new Set([required, ...list]));
};

const parseCalibration = (value: unknown): CalibrationProfile | null => {
  if (!isRecord(value)) return null;
  const profile: CalibrationProfile = {
    centerX: num(value.centerX, NaN, 0, 1),
    shoulderY: num(value.shoulderY, NaN, 0, 1),
    hipY: num(value.hipY, NaN, 0, 2),
    shoulderWidth: num(value.shoulderWidth, NaN, 0.01, 1),
    torsoLength: num(value.torsoLength, NaN, 0.01, 2),
    // Older profiles predate hand gestures; assume relaxed arms.
    leftHandRest: num(value.leftHandRest, 0, -1, 1.5),
    rightHandRest: num(value.rightHandRest, 0, -1, 1.5),
    capturedAt: num(value.capturedAt, 0),
  };
  return Object.values(profile).every(Number.isFinite) ? profile : null;
};

/**
 * Validates untrusted persisted JSON field-by-field. Anything malformed falls
 * back to defaults instead of crashing the game or wiping valid progress.
 */
export const sanitizeSave = (raw: unknown): SaveData => {
  const defaults = createDefaultSave();
  if (!isRecord(raw)) return defaults;
  const characterIds = CHARACTERS.map((character) => character.id);
  const boardIds = BOARDS.map((board) => board.id);
  const ownedCharacters = idList(raw.ownedCharacters, characterIds, DEFAULT_CHARACTER_ID);
  const ownedBoards = idList(raw.ownedBoards, boardIds, DEFAULT_BOARD_ID);
  const upgrades = isRecord(raw.upgrades) ? raw.upgrades : {};
  const settings = isRecord(raw.settings) ? raw.settings : {};
  const selectedCharacter = oneOf(raw.selectedCharacter, ownedCharacters, DEFAULT_CHARACTER_ID);
  const selectedBoard = oneOf(raw.selectedBoard, ownedBoards, DEFAULT_BOARD_ID);
  const level = (value: unknown) => Math.round(num(value, 0, 0, MAX_UPGRADE_LEVEL));

  return {
    version: SAVE_VERSION,
    highScore: Math.floor(num(raw.highScore, 0)),
    bestDistance: Math.floor(num(raw.bestDistance, 0)),
    bestCoinsInRun: Math.floor(num(raw.bestCoinsInRun, 0)),
    coins: Math.floor(num(raw.coins, defaults.coins)),
    keys: Math.floor(num(raw.keys, defaults.keys)),
    hoverboards: Math.floor(num(raw.hoverboards, defaults.hoverboards)),
    headstarts: Math.floor(num(raw.headstarts, defaults.headstarts)),
    totalRuns: Math.floor(num(raw.totalRuns, 0)),
    totalCoinsCollected: Math.floor(num(raw.totalCoinsCollected, 0)),
    totalDistance: Math.floor(num(raw.totalDistance, 0)),
    ownedCharacters,
    ownedBoards,
    selectedCharacter,
    selectedBoard,
    upgrades: {
      magnet: level(upgrades.magnet),
      jetpack: level(upgrades.jetpack),
      sneakers: level(upgrades.sneakers),
      multiplier: level(upgrades.multiplier),
    },
    // Older saves stored the multiplier level directly; carry it over as the mission level.
    missions: sanitizeMissionState(raw.missions, Math.round(num(raw.scoreMultiplierLevel, 0, 0, 29))),
    settings: {
      musicVolume: num(settings.musicVolume, DEFAULT_SETTINGS.musicVolume, 0, 1),
      sfxVolume: num(settings.sfxVolume, DEFAULT_SETTINGS.sfxVolume, 0, 1),
      muted: bool(settings.muted, DEFAULT_SETTINGS.muted),
      inputMode: oneOf(settings.inputMode, ["keyboard", "camera"] as const, DEFAULT_SETTINGS.inputMode),
      laneGesture: oneOf(settings.laneGesture, ["hands", "lean"] as const, DEFAULT_SETTINGS.laneGesture),
      difficulty: oneOf(settings.difficulty, ["easy", "normal", "hard"] as const, DEFAULT_SETTINGS.difficulty),
      cameraSensitivity: num(settings.cameraSensitivity, DEFAULT_SETTINGS.cameraSensitivity, 0.5, 1.5),
      showCameraPreview: bool(settings.showCameraPreview, DEFAULT_SETTINGS.showCameraPreview),
      graphicsQuality: oneOf(settings.graphicsQuality, ["low", "medium", "high"] as const, DEFAULT_SETTINGS.graphicsQuality),
      reducedMotion: bool(settings.reducedMotion, DEFAULT_SETTINGS.reducedMotion),
      showFps: bool(settings.showFps, DEFAULT_SETTINGS.showFps),
    },
    calibration: parseCalibration(raw.calibration),
    tutorialSeen: bool(raw.tutorialSeen, false),
  };
};
