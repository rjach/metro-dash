import { MAX_UPGRADE_LEVEL, POWER_UPS, powerUpDuration, SHOP_ITEMS, UPGRADE_COSTS } from "../../content/powerups";
import type { TimedPowerUp } from "../../game/types";
import { formatNumber, h } from "../dom";
import { icon, type IconName } from "../icons";
import { Screen } from "../Screen";
import type { PurchaseResult, ShopItem, UiController } from "../controller";
import { currencyBar } from "./MainMenuScreen";

const UPGRADE_ICONS: Record<TimedPowerUp, IconName> = { magnet: "magnet", jetpack: "jetpack", sneakers: "sneakers", multiplier: "multiplier" };

/** Spend coins on longer power-ups, a higher base multiplier and consumables. */
export class ShopScreen extends Screen {
  private readonly listEl = h("div", { class: "upgrade-list" });
  private readonly currency = currencyBar();

  constructor(ui: UiController) {
    super(ui, "shop-screen dim");
    this.root.append(
      h(
        "div",
        { class: "header-bar" },
        h(
          "div",
          { class: "row" },
          this.button(icon("arrowLeft"), "icon", () => ui.back(), { "aria-label": "Back" }),
          h("div", { class: "display title" }, "Shop"),
        ),
        this.currency.root,
      ),
      h("div", { class: "panel slide-up scroll", style: "margin: 1em auto 0; width: min(96vw, 40em); flex: 1; min-height: 0" }, this.listEl),
    );
    ui.save.events.on("change", () => this.visible && this.refresh());
  }

  protected override onShow(): void {
    this.refresh();
  }

  private refresh(): void {
    const save = this.ui.save.data;
    this.currency.update(save);
    const rows: HTMLElement[] = [h("div", { class: "setting-group" }, "Power-up upgrades")];
    for (const kind of Object.keys(POWER_UPS) as TimedPowerUp[]) {
      const def = POWER_UPS[kind];
      const level = save.upgrades[kind];
      const maxed = level >= MAX_UPGRADE_LEVEL;
      rows.push(
        this.upgradeRow(
          UPGRADE_ICONS[kind],
          def.color,
          def.name,
          `${def.description} ${powerUpDuration(kind, level).toFixed(1)}s${maxed ? "" : ` → ${powerUpDuration(kind, level + 1).toFixed(1)}s`}`,
          level,
          MAX_UPGRADE_LEVEL,
          maxed ? null : UPGRADE_COSTS[level]!,
          () => this.ui.purchaseUpgrade(kind),
        ),
      );
    }
    rows.push(h("div", { class: "setting-group" }, "Items"));
    rows.push(this.itemRow("board", "#2f7de1", SHOP_ITEMS.hoverboardPack.name, `Absorb a crash for 30s. You own ${save.hoverboards}.`, "hoverboardPack"));
    rows.push(this.itemRow("key", "#1b9ad6", SHOP_ITEMS.key.name, `Revive after a crash. You own ${save.keys}.`, "key"));
    rows.push(
      this.itemRow(
        "rocket",
        "#ff7a1a",
        SHOP_ITEMS.headstart.name,
        `Blast through the first 750 m. Use at the start of a run (H). You own ${save.headstarts}.`,
        "headstart",
      ),
    );
    this.listEl.replaceChildren(...rows);
  }

  private upgradeRow(
    iconName: IconName,
    colour: string,
    name: string,
    description: string,
    level: number,
    max: number,
    cost: number | null,
    buy: () => PurchaseResult,
  ): HTMLElement {
    const pips = h(
      "div",
      { class: "pips", "aria-label": `Level ${level} of ${max}` },
      ...Array.from({ length: max }, (_, i) => h("span", { class: i < level ? "on" : "" })),
    );
    const action =
      cost === null
        ? h("div", { class: "stat-chip" }, "MAX")
        : this.button(`${icon("coin")}${formatNumber(cost)}`, this.ui.save.data.coins >= cost ? "green" : "", () => this.attempt(buy), {
            "aria-label": `Upgrade ${name} for ${cost} coins`,
          });
    return h(
      "div",
      { class: "upgrade" },
      h("div", { class: "icon", style: `background:${colour}`, html: icon(iconName) }),
      h("div", {}, h("div", { class: "name" }, name), h("div", { class: "desc" }, description), pips),
      action,
    );
  }

  private itemRow(iconName: IconName, colour: string, name: string, description: string, item: ShopItem): HTMLElement {
    const price = SHOP_ITEMS[item].price;
    return h(
      "div",
      { class: "upgrade" },
      h("div", { class: "icon", style: `background:${colour}`, html: icon(iconName) }),
      h("div", {}, h("div", { class: "name" }, name), h("div", { class: "desc" }, description)),
      this.button(
        `${icon("coin")}${formatNumber(price)}`,
        this.ui.save.data.coins >= price ? "green" : "",
        () => this.attempt(() => this.ui.purchaseItem(item)),
        {
          "aria-label": `Buy ${name} for ${price} coins`,
        },
      ),
    );
  }

  private attempt(buy: () => PurchaseResult): void {
    const result = buy();
    if (!result.ok) {
      this.root
        .querySelector(".panel")
        ?.animate([{ transform: "translateX(-0.3em)" }, { transform: "translateX(0.3em)" }, { transform: "none" }], { duration: 200 });
    }
  }
}
