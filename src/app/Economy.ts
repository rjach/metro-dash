import { boardBonusSeconds, boardGravityScale, boardJumpMultiplier, boardMagnetRadius, findBoard } from "../content/boards";
import { findCharacter } from "../content/characters";
import { MAX_UPGRADE_LEVEL, powerUpDuration, SHOP_ITEMS, UPGRADE_COSTS } from "../content/powerups";
import { DIFFICULTIES, HOVERBOARD } from "../core/config";
import type { RunLoadout } from "../game/GameSession";
import type { TimedPowerUp } from "../game/types";
import type { SaveData } from "../persistence/SaveData";
import type { SaveStore } from "../persistence/SaveStore";
import type { PurchaseResult, ShopItem } from "../ui/controller";

/** Hoverboard ride length for the equipped board. */
export const hoverboardDuration = (save: Readonly<SaveData>): number => HOVERBOARD.baseDuration + boardBonusSeconds(findBoard(save.selectedBoard));

/** Translates the persistent profile into the per-run modifiers the simulation understands. */
export const buildLoadout = (save: Readonly<SaveData>): RunLoadout => {
  const board = findBoard(save.selectedBoard);
  return {
    powerUpDuration: (kind) => powerUpDuration(kind, save.upgrades[kind]),
    baseMultiplier: 1 + save.missions.level,
    hoverboards: save.hoverboards,
    hoverboardDuration: hoverboardDuration(save),
    boardJumpMultiplier: boardJumpMultiplier(board),
    boardMagnetRadius: boardMagnetRadius(board),
    boardGravityScale: boardGravityScale(board),
    difficulty: DIFFICULTIES[save.settings.difficulty],
  };
};

/**
 * All coin spending. Every purchase is validated against the current profile
 * and applied atomically through the SaveStore.
 */
export class Economy {
  constructor(
    private readonly save: SaveStore,
    private readonly onResult: (ok: boolean) => void,
  ) {}

  purchaseCharacter(id: string): PurchaseResult {
    const character = findCharacter(id);
    return this.purchase(character.price, this.save.data.ownedCharacters.includes(id), (draft) => {
      draft.ownedCharacters.push(id);
      draft.selectedCharacter = id;
    });
  }

  purchaseBoard(id: string): PurchaseResult {
    const board = findBoard(id);
    return this.purchase(board.price, this.save.data.ownedBoards.includes(id), (draft) => {
      draft.ownedBoards.push(id);
      draft.selectedBoard = id;
    });
  }

  purchaseUpgrade(kind: TimedPowerUp): PurchaseResult {
    const level = this.save.data.upgrades[kind];
    if (level >= MAX_UPGRADE_LEVEL) return { ok: false, reason: "max-level" };
    return this.purchase(UPGRADE_COSTS[level]!, false, (draft) => {
      draft.upgrades[kind] = level + 1;
    });
  }

  purchaseItem(item: ShopItem): PurchaseResult {
    const def = SHOP_ITEMS[item];
    return this.purchase(def.price, false, (draft) => {
      if (item === "hoverboardPack") draft.hoverboards += def.quantity;
      else if (item === "headstart") draft.headstarts += def.quantity;
      else draft.keys += def.quantity;
    });
  }

  private purchase(price: number, alreadyOwned: boolean, apply: (draft: SaveData) => void): PurchaseResult {
    if (alreadyOwned) return { ok: false, reason: "already-owned" };
    if (this.save.data.coins < price) {
      this.onResult(false);
      return { ok: false, reason: "insufficient-funds" };
    }
    this.save.update((draft) => {
      draft.coins -= price;
      apply(draft);
    });
    this.onResult(true);
    return { ok: true };
  }
}
