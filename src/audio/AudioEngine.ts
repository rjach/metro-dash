import { Music, type MusicMood } from "./Music";

export type SoundEffect =
  | "coin"
  | "jump"
  | "superJump"
  | "roll"
  | "swipe"
  | "land"
  | "bump"
  | "stumble"
  | "crash"
  | "powerUp"
  | "powerDown"
  | "hoverboard"
  | "boardBreak"
  | "key"
  | "mystery"
  | "horn"
  | "click"
  | "countdown"
  | "go"
  | "purchase"
  | "error"
  | "newRecord";

/**
 * Fully synthesized audio (Web Audio API): punchy SFX and a looping
 * hip-hop-style backing track, with no external sound files.
 */
export class AudioEngine {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private musicBus: GainNode | null = null;
  private sfxBus: GainNode | null = null;
  private noiseBuffer: AudioBuffer | null = null;
  private musicVolume = 0.55;
  private sfxVolume = 0.8;
  private muted = false;
  private music: Music | null = null;
  private mood: MusicMood = "menu";
  private lastCoinTime = 0;
  private coinPitchStep = 0;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (!this.context) {
      const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.context = new Ctor();
      this.master = this.context.createGain();
      this.master.connect(this.context.destination);
      this.musicBus = this.context.createGain();
      this.musicBus.connect(this.master);
      this.sfxBus = this.context.createGain();
      this.sfxBus.connect(this.master);
      this.noiseBuffer = this.createNoise();
      this.music = new Music(this.context, this.musicBus);
      this.music.setMood(this.mood);
      this.applyVolumes();
    }
    if (this.context.state === "suspended") void this.context.resume();
  }

  setVolumes(music: number, sfx: number, muted: boolean): void {
    this.musicVolume = music;
    this.sfxVolume = sfx;
    this.muted = muted;
    this.applyVolumes();
  }

  startMusic(): void {
    this.music?.start();
  }

  stopMusic(): void {
    this.music?.stop();
  }

  /** Switches the arrangement: chill menu loop, full in-run song, or muffled while paused. */
  setMusicMood(mood: MusicMood): void {
    this.mood = mood;
    this.music?.setMood(mood);
  }

  suspend(): void {
    void this.context?.suspend();
  }

  resume(): void {
    if (this.context?.state === "suspended") void this.context.resume();
  }

  play(effect: SoundEffect): void {
    const ctx = this.context;
    if (!ctx || !this.sfxBus || this.muted) return;
    const t = ctx.currentTime;
    switch (effect) {
      case "coin": {
        // Rapid pickups climb in pitch, like a combo.
        this.coinPitchStep = t - this.lastCoinTime < 0.35 ? Math.min(this.coinPitchStep + 1, 7) : 0;
        this.lastCoinTime = t;
        const base = 1318 * 2 ** (this.coinPitchStep / 24);
        this.tone("square", base, t, 0.05, 0.12);
        this.tone("square", base * 1.5, t + 0.05, 0.09, 0.1);
        break;
      }
      case "jump":
        this.sweep("triangle", 300, 720, t, 0.16, 0.28);
        this.noise(t, 0.12, 0.08, 2000, 6000);
        break;
      case "superJump":
        this.sweep("triangle", 260, 1200, t, 0.3, 0.3);
        this.sweep("sine", 520, 2400, t + 0.02, 0.28, 0.14);
        break;
      case "roll":
        this.noise(t, 0.25, 0.18, 400, 1600);
        this.sweep("sine", 220, 110, t, 0.2, 0.18);
        break;
      case "swipe":
        this.noise(t, 0.1, 0.1, 1500, 5000);
        break;
      case "land":
        this.sweep("sine", 160, 60, t, 0.1, 0.25);
        this.noise(t, 0.06, 0.08, 200, 900);
        break;
      case "bump":
        this.sweep("square", 180, 90, t, 0.08, 0.12);
        break;
      case "stumble":
        this.sweep("sawtooth", 260, 120, t, 0.22, 0.18);
        this.noise(t, 0.18, 0.16, 300, 1500);
        break;
      case "crash":
        this.noise(t, 0.6, 0.55, 80, 2400);
        this.sweep("sawtooth", 220, 40, t, 0.5, 0.35);
        this.sweep("square", 110, 30, t + 0.05, 0.45, 0.2);
        break;
      case "powerUp":
        [0, 4, 7, 12, 16].forEach((semi, i) => this.tone("square", 523 * 2 ** (semi / 12), t + i * 0.06, 0.1, 0.1));
        break;
      case "powerDown":
        [12, 7, 3, 0].forEach((semi, i) => this.tone("triangle", 523 * 2 ** (semi / 12), t + i * 0.07, 0.1, 0.12));
        break;
      case "hoverboard":
        this.sweep("sawtooth", 200, 900, t, 0.35, 0.14);
        this.sweep("sine", 400, 1800, t, 0.35, 0.12);
        break;
      case "boardBreak":
        this.noise(t, 0.4, 0.4, 600, 6000);
        this.sweep("square", 900, 120, t, 0.35, 0.18);
        break;
      case "key":
        [0, 7, 12, 19].forEach((semi, i) => this.tone("sine", 880 * 2 ** (semi / 12), t + i * 0.07, 0.18, 0.14));
        break;
      case "mystery":
        [0, 3, 7, 10, 12, 15].forEach((semi, i) => this.tone("square", 440 * 2 ** (semi / 12), t + i * 0.05, 0.08, 0.08));
        break;
      case "horn":
        this.tone("sawtooth", 311, t, 0.7, 0.12);
        this.tone("sawtooth", 392, t, 0.7, 0.1);
        break;
      case "click":
        this.tone("square", 900, t, 0.04, 0.08);
        break;
      case "countdown":
        this.tone("square", 660, t, 0.14, 0.14);
        break;
      case "go":
        this.tone("square", 990, t, 0.3, 0.14);
        this.tone("square", 1320, t, 0.3, 0.08);
        break;
      case "purchase":
        [0, 4, 7, 12].forEach((semi, i) => this.tone("triangle", 660 * 2 ** (semi / 12), t + i * 0.05, 0.14, 0.16));
        break;
      case "error":
        this.tone("square", 180, t, 0.18, 0.14);
        this.tone("square", 150, t + 0.12, 0.2, 0.14);
        break;
      case "newRecord":
        [0, 4, 7, 12, 7, 12, 16, 19].forEach((semi, i) => this.tone("square", 523 * 2 ** (semi / 12), t + i * 0.08, 0.14, 0.1));
        break;
    }
  }

  private applyVolumes(): void {
    if (!this.context || !this.master || !this.musicBus || !this.sfxBus) return;
    const now = this.context.currentTime;
    this.master.gain.setTargetAtTime(this.muted ? 0 : 1, now, 0.05);
    this.musicBus.gain.setTargetAtTime(this.musicVolume * 0.55, now, 0.1);
    this.sfxBus.gain.setTargetAtTime(this.sfxVolume * 0.6, now, 0.02);
  }

  private tone(type: OscillatorType, frequency: number, start: number, duration: number, volume: number, bus: AudioNode | null = this.sfxBus): void {
    const ctx = this.context!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, start);
    gain.gain.setValueAtTime(0, start);
    gain.gain.linearRampToValueAtTime(volume, start + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(bus!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private sweep(type: OscillatorType, from: number, to: number, start: number, duration: number, volume: number): void {
    const ctx = this.context!;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(from, start);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(20, to), start + duration);
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    oscillator.connect(gain).connect(this.sfxBus!);
    oscillator.start(start);
    oscillator.stop(start + duration + 0.02);
  }

  private noise(start: number, duration: number, volume: number, lowHz: number, highHz: number, bus: AudioNode | null = this.sfxBus): void {
    const ctx = this.context!;
    const source = ctx.createBufferSource();
    source.buffer = this.noiseBuffer;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = Math.sqrt(lowHz * highHz);
    filter.Q.value = Math.max(0.3, Math.sqrt(lowHz * highHz) / (highHz - lowHz));
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(volume, start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter).connect(gain).connect(bus!);
    source.start(start);
    source.stop(start + duration + 0.02);
  }

  private createNoise(): AudioBuffer {
    const ctx = this.context!;
    const buffer = ctx.createBuffer(1, ctx.sampleRate, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }
}
