import type { SaveData } from "../../persistence/SaveData";
import { formatNumber, h } from "../dom";
import { icon } from "../icons";
import { Screen } from "../Screen";
import type { PurchaseResult, UiController } from "../controller";
import { currencyBar } from "./MainMenuScreen";

export interface CollectionItem {
  id: string;
  name: string;
  description: string;
  price: number;
  swatch: [string, string];
}

export interface CollectionAdapter {
  /** Stable identifier, also used as a CSS hook (`<id>-screen`). */
  id: string;
  title: string;
  items: readonly CollectionItem[];
  owned: (save: SaveData) => readonly string[];
  selected: (save: SaveData) => string;
  preview: (id: string) => void;
  purchase: (id: string) => PurchaseResult;
  select: (id: string) => void;
  perkLabel?: (id: string) => string;
}

/**
 * Shared layout for the runner and board collections: the 3D showcase stays
 * visible on the left while the right panel lists items to preview, buy or equip.
 */
export class CollectionScreen extends Screen {
  private focused: string;
  private readonly list = h("div", { class: "list scroll" });
  private readonly name = h("div", { class: "detail-name display" });
  private readonly description = h("div", { class: "detail-desc" });
  private readonly perk = h("div", { class: "stat-chip", style: "align-self:flex-start" });
  private readonly actionSlot = h("div", { class: "row", style: "justify-content:flex-start" });
  private readonly currency = currencyBar();
  private readonly cards = new Map<string, HTMLElement>();

  constructor(
    ui: UiController,
    private readonly adapter: CollectionAdapter,
  ) {
    super(ui, `collection-screen ${adapter.id}-screen`);
    this.focused = adapter.selected(ui.save.data);
    for (const item of adapter.items) {
      const card = h(
        "button",
        { class: "card", type: "button", "aria-label": item.name },
        h("div", { class: "swatch", style: `background: linear-gradient(135deg, ${item.swatch[0]} 50%, ${item.swatch[1]} 50%)` }),
        h("div", {}, item.name),
      );
      card.addEventListener("click", () => {
        ui.sfx("click");
        this.focus(item.id);
      });
      this.cards.set(item.id, card);
      this.list.append(card);
    }
    this.root.append(
      h(
        "div",
        { class: "header-bar" },
        h(
          "div",
          { class: "row" },
          this.button(icon("arrowLeft"), "icon", () => ui.back(), { "aria-label": "Back" }),
          h("div", { class: "display title" }, adapter.title),
        ),
        this.currency.root,
      ),
      h(
        "div",
        { class: "collection", style: "flex:1; margin-top: 1em" },
        h("div", { class: "preview-space" }),
        h(
          "div",
          { class: "panel details slide-up" },
          this.name,
          this.description,
          adapter.perkLabel ? this.perk : null,
          this.actionSlot,
          h("div", { class: "scroll", style: "flex:1; min-height: 6em" }, this.list),
        ),
      ),
    );
    ui.save.events.on("change", () => this.visible && this.refresh());
  }

  protected override onShow(): void {
    this.focused = this.adapter.selected(this.ui.save.data);
    this.refresh();
    this.adapter.preview(this.focused);
  }

  protected override onHide(): void {
    // Restore the equipped item in the 3D scene if the player only browsed.
    this.adapter.preview(this.adapter.selected(this.ui.save.data));
  }

  private focus(id: string): void {
    this.focused = id;
    this.adapter.preview(id);
    this.refresh();
  }

  private refresh(): void {
    const save = this.ui.save.data;
    const owned = this.adapter.owned(save);
    const selected = this.adapter.selected(save);
    const item = this.adapter.items.find((candidate) => candidate.id === this.focused) ?? this.adapter.items[0]!;
    this.currency.update(save);
    this.name.textContent = item.name;
    this.description.textContent = item.description;
    if (this.adapter.perkLabel) this.perk.textContent = this.adapter.perkLabel(item.id);

    for (const candidate of this.adapter.items) {
      const card = this.cards.get(candidate.id)!;
      card.classList.toggle("selected", candidate.id === this.focused);
      card.querySelector(".equipped")?.remove();
      card.querySelector(".price")?.remove();
      card.querySelector(".lock")?.remove();
      if (candidate.id === selected) card.append(h("span", { class: "equipped" }, "ON"));
      if (!owned.includes(candidate.id)) {
        card.append(h("div", { class: "price", html: icon("coin") }, formatNumber(candidate.price)));
        card.append(h("span", { class: "lock", html: icon("lock") }));
      }
    }

    let action: HTMLButtonElement;
    if (!owned.includes(item.id)) {
      action = this.button(`${icon("coin")}${formatNumber(item.price)}`, "green big", () => {
        const result = this.adapter.purchase(item.id);
        if (!result.ok) this.shake(action);
      });
      action.setAttribute("aria-label", `Buy ${item.name} for ${item.price} coins`);
      if (save.coins < item.price) action.classList.remove("green");
    } else if (item.id === selected) {
      action = this.button(`${icon("check")}Equipped`, "yellow big", () => this.ui.back());
    } else {
      action = this.button("Select", "green big", () => this.adapter.select(item.id));
    }
    this.actionSlot.replaceChildren(action);
  }

  private shake(element: HTMLElement): void {
    element.animate([{ transform: "translateX(0)" }, { transform: "translateX(-0.4em)" }, { transform: "translateX(0.4em)" }, { transform: "translateX(0)" }], {
      duration: 260,
    });
  }
}
