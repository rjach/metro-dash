import type { SoundEffect } from "../audio/AudioEngine";
import type { TimedPowerUp } from "../game/types";
import type { CameraInput } from "../input/camera/CameraInput";
import type { InputMode, Settings } from "../persistence/SaveData";
import type { SaveStore } from "../persistence/SaveStore";

export type ScreenId = "menu" | "hud" | "pause" | "saveMe" | "results" | "characters" | "boards" | "shop" | "settings" | "cameraSetup";

export type PurchaseResult = { ok: true } | { ok: false; reason: "insufficient-funds" | "max-level" | "already-owned" };

export type ShopItem = "hoverboardPack" | "key" | "headstart";

/**
 * Everything the UI may ask the application to do. Screens depend on this
 * interface only, never on the game session, renderer or input devices.
 */
export interface UiController {
  readonly save: SaveStore;
  readonly camera: CameraInput;
  play(): void;
  open(screen: ScreenId): void;
  back(): void;
  pause(): void;
  resume(): void;
  restartRun(): void;
  quitToMenu(): void;
  revive(): void;
  skipRevive(): void;
  setInputMode(mode: InputMode): void;
  previewCharacter(id: string): void;
  purchaseCharacter(id: string): PurchaseResult;
  selectCharacter(id: string): void;
  previewBoard(id: string): void;
  purchaseBoard(id: string): PurchaseResult;
  selectBoard(id: string): void;
  purchaseUpgrade(kind: TimedPowerUp): PurchaseResult;
  purchaseItem(item: ShopItem): PurchaseResult;
  updateSettings(patch: Partial<Settings>): void;
  resetProgress(): void;
  startCameraSetup(): void;
  recalibrate(): void;
  finishCameraSetup(): void;
  cancelCameraSetup(): void;
  retryCamera(): void;
  activateHoverboard(): void;
  useHeadstart(): void;
  sfx(effect: SoundEffect): void;
}
