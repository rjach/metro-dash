import type { AudioEngine } from "../audio/AudioEngine";
import { findBoard } from "../content/boards";
import { POWER_UPS } from "../content/powerups";
import type { GameSession, MysteryReward } from "../game/GameSession";
import type { SaveStore } from "../persistence/SaveStore";
import type { GameRenderer } from "../render/GameRenderer";
import type { HudScreen } from "../ui/screens/HudScreen";

/**
 * Turns simulation events into player feedback: sound, particles, camera
 * shake and HUD toasts. Consumables gained or spent mid-run (keys,
 * hoverboards, headstarts) are written to the profile immediately.
 */
export class SessionFeedback {
  constructor(
    private readonly session: GameSession,
    private readonly audio: AudioEngine,
    private readonly renderer: GameRenderer,
    private readonly hud: HudScreen,
    private readonly save: SaveStore,
  ) {
    this.wire();
  }

  private wire(): void {
    const { session, audio, renderer, hud, save } = this;
    const events = session.events;
    const boardGlow = () => findBoard(save.data.selectedBoard).glow;

    events.on("coin", ({ x, y, z }) => {
      audio.play("coin");
      renderer.coinBurst(x, y, z, session.player.z);
    });
    events.on("jump", (event) => audio.play(event.super ? "superJump" : "jump"));
    events.on("roll", () => audio.play("roll"));
    events.on("land", ({ hard }) => {
      if (!hard) return;
      audio.play("land");
      renderer.landingDust();
    });
    events.on("laneChange", () => audio.play("swipe"));
    events.on("edgeBump", () => {
      audio.play("bump");
      renderer.impact(0.08);
    });
    events.on("stumble", ({ caught }) => {
      audio.play("stumble");
      renderer.impact(0.25);
      if (!caught) hud.toast("Watch out!", "warn");
    });
    events.on("crash", ({ cause }) => {
      audio.play("crash");
      // Muffle rather than cut the music: the crash lands, the groove keeps breathing.
      audio.setMusicMood("paused");
      renderer.impact(0.6);
      hud.toast(cause === "caught" ? "Busted!" : "Ouch!", "warn");
    });
    events.on("powerUpStart", ({ kind }) => {
      audio.play("powerUp");
      renderer.pickupBurst(POWER_UPS[kind].color);
      hud.toast(POWER_UPS[kind].name);
    });
    events.on("powerUpEnd", () => audio.play("powerDown"));
    events.on("mysteryBox", (reward) => this.onMysteryReward(reward));
    events.on("key", () => {
      audio.play("key");
      renderer.pickupBurst("#39c5ff");
      hud.toast("+1 Key");
      save.update((draft) => {
        draft.keys += 1;
      });
    });
    events.on("hoverboardStart", () => {
      audio.play("hoverboard");
      renderer.pickupBurst(boardGlow());
      save.update((draft) => {
        draft.hoverboards = Math.max(0, draft.hoverboards - 1);
      });
      hud.toast("Hoverboard!");
    });
    events.on("hoverboardBreak", () => {
      audio.play("boardBreak");
      renderer.boardShatter(boardGlow());
      hud.toast("Board saved you!", "info");
    });
    events.on("hoverboardEnd", () => audio.play("powerDown"));
    events.on("trainIncoming", () => audio.play("horn"));
    events.on("headstartStart", () => {
      audio.play("superJump");
      audio.play("powerUp");
      renderer.pickupBurst("#ff9f1c");
      renderer.impact(0.2);
      hud.toast("Headstart!");
      save.update((draft) => {
        draft.headstarts = Math.max(0, draft.headstarts - 1);
      });
    });
    events.on("headstartEnd", () => audio.play("powerDown"));
  }

  private onMysteryReward(reward: MysteryReward): void {
    this.audio.play("mystery");
    this.renderer.pickupBurst("#c77dff");
    switch (reward.kind) {
      case "coins":
        this.hud.toast(`+${reward.amount} coins`);
        return;
      case "hoverboard":
        this.hud.toast("+1 Hoverboard");
        this.save.update((draft) => {
          draft.hoverboards += reward.amount;
        });
        return;
      case "key":
        this.hud.toast("+1 Key");
        this.save.update((draft) => {
          draft.keys += reward.amount;
        });
        return;
      case "powerUp":
        // Announced by the power-up's own start event.
        return;
    }
  }
}
