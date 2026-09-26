import type { MissionState } from "../game/missions";
import { formatNumber, h } from "./dom";
import { icon } from "./icons";

/** Current mission set with progress bars, shown on the menu, pause and results screens. */
export class MissionsPanel {
  readonly root = h("div", { class: "missions panel light", role: "region", "aria-label": "Missions" });

  render(state: MissionState): void {
    const multiplier = 1 + state.level;
    this.root.replaceChildren(
      h(
        "div",
        { class: "missions-head" },
        h("span", { class: "display" }, "Missions"),
        h("span", { class: "missions-reward", title: "Complete all three to raise your multiplier" }, `x${multiplier} → x${multiplier + 1}`),
      ),
      ...state.missions.map((mission) =>
        h(
          "div",
          { class: `mission ${mission.done ? "done" : ""}` },
          h("span", { class: "check", html: mission.done ? icon("check") : "" }),
          h(
            "div",
            { class: "mission-body" },
            h("div", { class: "mission-text" }, mission.description),
            h(
              "div",
              { class: "mission-bar", role: "progressbar", "aria-valuemin": 0, "aria-valuemax": mission.target, "aria-valuenow": Math.floor(mission.progress) },
              h("div", { style: `transform: scaleX(${Math.min(1, mission.progress / mission.target)})` }),
            ),
          ),
          h("span", { class: "mission-count" }, `${formatNumber(Math.min(mission.progress, mission.target))}/${formatNumber(mission.target)}`),
        ),
      ),
    );
  }
}
