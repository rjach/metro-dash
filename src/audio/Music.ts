/**
 * Procedural soundtrack: a small composer and synth rack on the Web Audio API.
 *
 * The song is arranged in sections (intro, verse, build, chorus, break) with
 * their own chord progressions, drum patterns and instrumentation, so it keeps
 * evolving instead of looping one bar. Everything is synthesised; no samples.
 */

export type MusicMood = "menu" | "run" | "paused";

type SectionName = "intro" | "verseA" | "build" | "chorusA" | "break" | "verseB" | "chorusB";

interface Section {
  name: SectionName;
  bars: number;
  /** Chord roots per bar as semitones above A (minor/major quality from `chords`). */
  chords: readonly string[];
  drums: "none" | "light" | "groove" | "full" | "roll";
  bass: boolean;
  lead: boolean;
  arp: "none" | "soft" | "full";
  /** Pad brightness 0..1 (low-pass cutoff). */
  brightness: number;
}

const BPM = 104;
const STEPS_PER_BAR = 16;
const LOOKAHEAD = 0.15;
const TICK_MS = 25;

/** Chord symbol → intervals in semitones relative to A2 (110 Hz). */
const CHORDS: Record<string, readonly number[]> = {
  Am: [0, 3, 7],
  F: [-4, 0, 3],
  C: [3, 7, 10],
  G: [-2, 2, 5],
  Dm: [5, 8, 12],
  E: [7, 11, 14],
  Em: [7, 10, 14],
  Bb: [1, 5, 8],
};

const ROOTS: Record<string, number> = { Am: 0, F: -4, C: 3, G: -2, Dm: 5, E: 7, Em: 7, Bb: 1 };

const SONG: readonly Section[] = [
  { name: "intro", bars: 4, chords: ["Am", "F", "C", "G"], drums: "none", bass: false, lead: false, arp: "soft", brightness: 0.25 },
  { name: "verseA", bars: 8, chords: ["Am", "F", "C", "G", "Am", "F", "C", "E"], drums: "groove", bass: true, lead: false, arp: "soft", brightness: 0.45 },
  { name: "build", bars: 4, chords: ["F", "G", "Em", "E"], drums: "roll", bass: true, lead: false, arp: "full", brightness: 0.6 },
  { name: "chorusA", bars: 8, chords: ["F", "G", "Am", "Am", "F", "G", "C", "E"], drums: "full", bass: true, lead: true, arp: "full", brightness: 1 },
  { name: "break", bars: 4, chords: ["Dm", "Am", "Bb", "E"], drums: "light", bass: false, lead: true, arp: "soft", brightness: 0.35 },
  { name: "verseB", bars: 8, chords: ["Dm", "Am", "F", "E", "Dm", "Am", "Bb", "E"], drums: "groove", bass: true, lead: false, arp: "full", brightness: 0.55 },
  { name: "chorusB", bars: 8, chords: ["F", "G", "Am", "C", "F", "G", "E", "E"], drums: "full", bass: true, lead: true, arp: "full", brightness: 1 },
];

/** Menu groove: laid-back, pads and arp over light drums. */
const MENU_SECTION: Section = {
  name: "break",
  bars: 8,
  chords: ["Am", "F", "C", "G", "Dm", "Am", "F", "E"],
  drums: "light",
  bass: true,
  lead: false,
  arp: "soft",
  brightness: 0.4,
};

/** Lead motifs (scale degrees in A minor pentatonic, null = rest), one per bar, rotated per chorus. */
const PENTATONIC = [0, 3, 5, 7, 10, 12, 15, 17, 19];
const MOTIFS: readonly (readonly (number | null)[])[] = [
  [4, null, 5, null, 6, 5, 4, null],
  [3, null, 4, 3, 2, null, null, null],
  [4, 5, 6, null, 7, null, 6, 5],
  [5, null, 4, null, 3, null, 2, null],
  [2, 3, 4, null, 4, 3, 2, 0],
  [6, null, 7, 8, 7, null, 6, null],
];

const midiToFreq = (semitonesFromA2: number) => 110 * 2 ** (semitonesFromA2 / 12);

export class Music {
  private readonly input: GainNode;
  private readonly filter: BiquadFilterNode;
  private readonly reverbSend: GainNode;
  private readonly delaySend: GainNode;
  private readonly noise: AudioBuffer;
  private mood: MusicMood = "menu";
  private playing = false;
  private timer: number | null = null;
  private nextStepTime = 0;
  private step = 0;
  private sectionIndex = 0;
  private barInSection = 0;
  private chorusCount = 0;

  constructor(
    private readonly ctx: AudioContext,
    output: AudioNode,
  ) {
    this.noise = this.createNoise();
    // Mix bus: instruments → low-pass (pause muffling) → compressor → output, with reverb and delay sends.
    this.input = ctx.createGain();
    this.filter = ctx.createBiquadFilter();
    this.filter.type = "lowpass";
    this.filter.frequency.value = 18000;
    const compressor = ctx.createDynamicsCompressor();
    compressor.threshold.value = -18;
    compressor.ratio.value = 3.5;
    compressor.attack.value = 0.01;
    compressor.release.value = 0.2;
    this.input.connect(this.filter).connect(compressor).connect(output);

    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.9;
    const reverb = ctx.createConvolver();
    reverb.buffer = this.createImpulse(2.4);
    this.reverbSend.connect(reverb).connect(this.filter);

    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.8;
    const delay = ctx.createDelay(1);
    delay.delayTime.value = (60 / BPM) * 0.75;
    const feedback = ctx.createGain();
    feedback.gain.value = 0.35;
    const delayTone = ctx.createBiquadFilter();
    delayTone.type = "lowpass";
    delayTone.frequency.value = 3200;
    this.delaySend.connect(delay).connect(delayTone).connect(feedback).connect(delay);
    delayTone.connect(this.filter);
  }

  start(): void {
    if (this.playing) return;
    this.playing = true;
    this.nextStepTime = this.ctx.currentTime + 0.06;
    this.step = 0;
    this.timer = window.setInterval(() => this.schedule(), TICK_MS);
  }

  stop(): void {
    this.playing = false;
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
  }

  get isPlaying(): boolean {
    return this.playing;
  }

  /** Menu = chill loop, run = full arrangement from the top, paused = muffled. */
  setMood(mood: MusicMood): void {
    const previous = this.mood;
    this.mood = mood;
    const now = this.ctx.currentTime;
    this.filter.frequency.cancelScheduledValues(now);
    this.filter.frequency.setTargetAtTime(mood === "paused" ? 650 : 18000, now, 0.15);
    if (mood === "run" && previous === "menu") {
      this.sectionIndex = 0;
      this.barInSection = 0;
      this.step = 0;
      this.chorusCount = 0;
    }
  }

  private get section(): Section {
    return this.mood === "menu" ? MENU_SECTION : SONG[this.sectionIndex]!;
  }

  private schedule(): void {
    if (!this.playing) return;
    const stepDuration = 60 / BPM / 4;
    while (this.nextStepTime < this.ctx.currentTime + LOOKAHEAD) {
      this.playStep(this.nextStepTime, stepDuration);
      this.nextStepTime += stepDuration;
      this.advance();
    }
  }

  private advance(): void {
    this.step = (this.step + 1) % STEPS_PER_BAR;
    if (this.step !== 0) return;
    this.barInSection++;
    if (this.barInSection < this.section.bars) return;
    this.barInSection = 0;
    if (this.mood === "menu") return;
    if (this.section.name.startsWith("chorus")) this.chorusCount++;
    // After the first pass skip the intro so the loop stays energetic.
    this.sectionIndex = this.sectionIndex + 1 >= SONG.length ? 1 : this.sectionIndex + 1;
  }

  private playStep(time: number, stepDuration: number): void {
    const section = this.section;
    const step = this.step;
    const chordName = section.chords[this.barInSection % section.chords.length]!;
    const chord = CHORDS[chordName]!;
    const root = ROOTS[chordName]!;
    const lastBar = this.barInSection === section.bars - 1;
    const firstStep = this.barInSection === 0 && step === 0;

    if (step === 0) this.pad(time, chord, stepDuration * 16, section.brightness);
    if (firstStep && (section.name.startsWith("chorus") || section.name === "verseB")) this.crash(time);
    if (section.name === "build" && lastBar && step === 0) this.riser(time, stepDuration * 16);

    this.drums(section, step, time, lastBar);
    if (section.bass) this.bassLine(section, step, time, root, stepDuration);
    this.arpeggio(section, step, time, chord, stepDuration);
    if (section.lead && step % 2 === 0) this.leadLine(step, time, stepDuration);
  }

  // ─── Parts ────────────────────────────────────────────────────────────────

  private drums(section: Section, step: number, time: number, lastBar: boolean): void {
    if (section.drums === "none") return;
    if (section.drums === "roll") {
      // Snare roll that doubles in density across the build.
      const density = this.barInSection < 2 ? 4 : this.barInSection < 3 ? 2 : 1;
      if (step % density === 0) this.snare(time, 0.25 + (this.barInSection / section.bars) * 0.5);
      if (step % 4 === 0) this.kick(time, 0.9);
      return;
    }
    const fill = lastBar && step >= 12;
    const kickPattern = section.drums === "light" ? [0, 10] : section.name === "verseB" ? [0, 3, 8, 11, 14] : [0, 6, 8, 10];
    if (kickPattern.includes(step) && !fill) this.kick(time, 1);
    if (step === 4 || step === 12) {
      this.snare(time, section.drums === "light" ? 0.35 : 0.7);
      if (section.drums === "full") this.clap(time);
    }
    if (fill) this.snare(time, 0.35 + (step - 12) * 0.12);
    if (section.drums !== "light" || step % 4 === 2) {
      const open = section.drums === "full" && step % 4 === 2;
      if (step % 2 === 0 || section.drums === "full") this.hat(time, open, step % 4 === 2 ? 0.28 : 0.15);
    }
  }

  private bassLine(section: Section, step: number, time: number, root: number, stepDuration: number): void {
    // Syncopated root/octave/fifth pattern; the chorus pushes eighths.
    const pattern: Record<number, number> = section.drums === "full" ? { 0: 0, 3: 0, 6: 12, 8: 0, 10: 7, 12: 0, 14: 12 } : { 0: 0, 6: 0, 8: 12, 11: 7, 14: 0 };
    const offset = pattern[step];
    if (offset === undefined) return;
    this.bass(time, midiToFreq(root - 12 + offset), stepDuration * 1.8);
  }

  private arpeggio(section: Section, step: number, time: number, chord: readonly number[], stepDuration: number): void {
    if (section.arp === "none") return;
    if (section.arp === "soft" && step % 2 === 1) return;
    const order = [0, 1, 2, 1, 2, 3, 2, 1];
    const index = order[(step / (section.arp === "soft" ? 2 : 1)) % order.length]! % 4;
    const note = index === 3 ? chord[0]! + 12 : chord[index]!;
    this.pluck(time, midiToFreq(note + 12), stepDuration * 1.5, section.arp === "soft" ? 0.05 : 0.07);
  }

  private leadLine(step: number, time: number, stepDuration: number): void {
    const motif = MOTIFS[(this.barInSection + this.chorusCount * 2) % MOTIFS.length]!;
    const degree = motif[step / 2];
    if (degree === null || degree === undefined) return;
    this.lead(time, midiToFreq(PENTATONIC[degree]! + 12), stepDuration * 1.9);
  }

  // ─── Instruments ─────────────────────────────────────────────────────────

  private envelope(start: number, attack: number, peak: number, release: number, destination: AudioNode): GainNode {
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(peak, start + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + attack + release);
    gain.connect(destination);
    return gain;
  }

  private kick(time: number, level: number): void {
    const osc = this.ctx.createOscillator();
    osc.frequency.setValueAtTime(150, time);
    osc.frequency.exponentialRampToValueAtTime(42, time + 0.12);
    osc.connect(this.envelope(time, 0.004, 0.95 * level, 0.28, this.input));
    osc.start(time);
    osc.stop(time + 0.32);
    this.noiseBurst(time, 0.015, 0.25 * level, "highpass", 2500, this.input);
  }

  private snare(time: number, level: number): void {
    const body = this.ctx.createOscillator();
    body.type = "triangle";
    body.frequency.setValueAtTime(210, time);
    body.frequency.exponentialRampToValueAtTime(140, time + 0.08);
    body.connect(this.envelope(time, 0.002, 0.35 * level, 0.1, this.input));
    body.start(time);
    body.stop(time + 0.14);
    const noise = this.noiseBurst(time, 0.18, 0.6 * level, "bandpass", 2600, this.input);
    noise.connect(this.reverbSend);
  }

  private clap(time: number): void {
    for (const offset of [0, 0.011, 0.023]) this.noiseBurst(time + offset, 0.09, 0.28, "bandpass", 1500, this.input).connect(this.reverbSend);
  }

  private hat(time: number, open: boolean, level: number): void {
    this.noiseBurst(time, open ? 0.22 : 0.035, level, "highpass", 8000, this.input);
  }

  private crash(time: number): void {
    this.noiseBurst(time, 1.6, 0.22, "highpass", 5200, this.input).connect(this.reverbSend);
  }

  private riser(time: number, duration: number): void {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    source.loop = true;
    const filter = this.ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = 4;
    filter.frequency.setValueAtTime(400, time);
    filter.frequency.exponentialRampToValueAtTime(9000, time + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.0001, time);
    gain.gain.exponentialRampToValueAtTime(0.25, time + duration * 0.95);
    gain.gain.exponentialRampToValueAtTime(0.0001, time + duration);
    source.connect(filter).connect(gain).connect(this.input);
    gain.connect(this.reverbSend);
    source.start(time);
    source.stop(time + duration + 0.05);
  }

  private bass(time: number, frequency: number, duration: number): void {
    const saw = this.ctx.createOscillator();
    saw.type = "sawtooth";
    saw.frequency.setValueAtTime(frequency, time);
    const sub = this.ctx.createOscillator();
    sub.frequency.setValueAtTime(frequency, time);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.Q.value = 6;
    filter.frequency.setValueAtTime(1400, time);
    filter.frequency.exponentialRampToValueAtTime(180, time + duration * 0.8);
    const amp = this.envelope(time, 0.006, 0.32, duration, this.input);
    saw.connect(filter).connect(amp);
    sub.connect(this.envelope(time, 0.006, 0.35, duration, this.input));
    for (const osc of [saw, sub]) {
      osc.start(time);
      osc.stop(time + duration + 0.05);
    }
  }

  private pad(time: number, chord: readonly number[], duration: number, brightness: number): void {
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(500 + brightness * 2600, time);
    const amp = this.ctx.createGain();
    amp.gain.setValueAtTime(0.0001, time);
    amp.gain.linearRampToValueAtTime(0.045, time + duration * 0.25);
    amp.gain.linearRampToValueAtTime(0.035, time + duration * 0.8);
    amp.gain.linearRampToValueAtTime(0.0001, time + duration * 1.05);
    filter.connect(amp).connect(this.input);
    amp.connect(this.reverbSend);
    for (const note of chord) {
      for (const detune of [-9, 7]) {
        const osc = this.ctx.createOscillator();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(midiToFreq(note + 12), time);
        osc.detune.value = detune;
        osc.connect(filter);
        osc.start(time);
        osc.stop(time + duration * 1.1);
      }
    }
  }

  private pluck(time: number, frequency: number, duration: number, level: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "square";
    osc.frequency.setValueAtTime(frequency, time);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(4200, time);
    filter.frequency.exponentialRampToValueAtTime(600, time + duration);
    const amp = this.envelope(time, 0.003, level, duration, this.input);
    osc.connect(filter).connect(amp);
    amp.connect(this.delaySend);
    osc.start(time);
    osc.stop(time + duration + 0.05);
  }

  private lead(time: number, frequency: number, duration: number): void {
    const osc = this.ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.setValueAtTime(frequency, time);
    // Gentle delayed vibrato for a sung quality.
    const vibrato = this.ctx.createOscillator();
    vibrato.frequency.value = 5.5;
    const depth = this.ctx.createGain();
    depth.gain.setValueAtTime(0, time);
    depth.gain.linearRampToValueAtTime(frequency * 0.008, time + duration * 0.6);
    vibrato.connect(depth).connect(osc.frequency);
    const filter = this.ctx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 2400;
    filter.Q.value = 2;
    const amp = this.envelope(time, 0.02, 0.07, duration, this.input);
    osc.connect(filter).connect(amp);
    amp.connect(this.delaySend);
    amp.connect(this.reverbSend);
    for (const node of [osc, vibrato]) {
      node.start(time);
      node.stop(time + duration + 0.1);
    }
  }

  private noiseBurst(time: number, duration: number, level: number, type: BiquadFilterType, frequency: number, destination: AudioNode): GainNode {
    const source = this.ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = frequency;
    const amp = this.envelope(time, 0.002, level, duration, destination);
    source.connect(filter).connect(amp);
    source.start(time, Math.random() * 0.5);
    source.stop(time + duration + 0.05);
    return amp;
  }

  private createNoise(): AudioBuffer {
    const buffer = this.ctx.createBuffer(1, this.ctx.sampleRate, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  /** Exponentially decaying stereo noise: a cheap, smooth hall reverb impulse. */
  private createImpulse(seconds: number): AudioBuffer {
    const length = Math.floor(this.ctx.sampleRate * seconds);
    const buffer = this.ctx.createBuffer(2, length, this.ctx.sampleRate);
    for (let channel = 0; channel < 2; channel++) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / length) ** 3;
    }
    return buffer;
  }
}
