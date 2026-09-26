import { BOARDS, findBoard } from "../content/boards";
import { CHARACTERS } from "../content/characters";
import { HOVERBOARD } from "../core/config";
import { boardBonusSeconds } from "../content/boards";
import type { UiController } from "../ui/controller";
import { CollectionScreen } from "../ui/screens/CollectionScreen";

export const createCharacterScreen = (ui: UiController): CollectionScreen =>
  new CollectionScreen(ui, {
    id: "characters",
    title: "Runners",
    items: CHARACTERS.map((character) => ({
      id: character.id,
      name: character.name,
      description: character.tagline,
      price: character.price,
      swatch: [character.palette.top, character.palette.hair],
    })),
    owned: (save) => save.ownedCharacters,
    selected: (save) => save.selectedCharacter,
    preview: (id) => ui.previewCharacter(id),
    purchase: (id) => ui.purchaseCharacter(id),
    select: (id) => ui.selectCharacter(id),
  });

export const createBoardScreen = (ui: UiController): CollectionScreen =>
  new CollectionScreen(ui, {
    id: "boards",
    title: "Hoverboards",
    items: BOARDS.map((board) => ({ id: board.id, name: board.name, description: board.description, price: board.price, swatch: [board.deck, board.accent] })),
    owned: (save) => save.ownedBoards,
    selected: (save) => save.selectedBoard,
    preview: (id) => ui.previewBoard(id),
    purchase: (id) => ui.purchaseBoard(id),
    select: (id) => ui.selectBoard(id),
    perkLabel: (id) => {
      const board = findBoard(id);
      const seconds = HOVERBOARD.baseDuration + boardBonusSeconds(board);
      return `${seconds}s ride · ${board.perk.kind === "none" ? "Crash shield" : board.description.split(":")[0]!.replace(".", "")}`;
    },
  });
