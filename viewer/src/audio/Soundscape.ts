/**
 * The harbour, heard: a soundscape synthesised with Web Audio (no audio files to download).
 *
 * - waves lapping at the quay: brown noise through a low-pass, its level swelling slowly
 * - a low city hum, quieter at night
 * - rain, when the weather has it: high-passed white noise scaled by the rain intensity
 * - a ship's horn now and then while ships are on the water (a long low fifth)
 * - gulls in daylight, a few calls at a time, panned around the listener
 *
 * Browsers only allow sound after a gesture, so it starts from the sound button and stays
 * off by default. It suspends itself while the tab is hidden.
 */

export interface SoundSceneInput {
  /** 0..1 from the live or chosen weather. */
  rainIntensity: number;
  /** Sun altitude in degrees: gulls fly by day, the city hums lower at night. */
  sunAltitudeDeg: number;
  /** Ships on the water right now (0 silences the horns). */
  shipCount: number;
  /** 0 (whole city in view) .. 1 (down at street level): nearer is louder. */
  closeness: number;
  /** 0..1 harbor sea mist intensity (increases foghorn cadence). */
  mistIntensity?: number;
}

type Ctx = AudioContext;

function noiseBuffer(ctx: Ctx, seconds: number, kind: "white" | "brown"): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * seconds);
  const buf = ctx.createBuffer(2, len, ctx.sampleRate);
  for (let ch = 0; ch < 2; ch++) {
    const data = buf.getChannelData(ch);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const w = Math.random() * 2 - 1;
      if (kind === "white") {
        data[i] = w;
      } else {
        last = (last + 0.02 * w) / 1.02;
        data[i] = last * 3.5;
      }
    }
    // cross-fade the loop point so it does not click
    const fade = Math.min(len >> 3, ctx.sampleRate >> 4);
    for (let i = 0; i < fade; i++) {
      const k = i / fade;
      data[i] = data[i]! * k + data[len - fade + i]! * (1 - k);
    }
  }
  return buf;
}

export class Soundscape {
  private ctx: Ctx | null = null;
  private master: GainNode | null = null;
  private waves: GainNode | null = null;
  private hum: GainNode | null = null;
  private rain: GainNode | null = null;
  private timers: number[] = [];
  private on = false;
  private scene: SoundSceneInput = {
    rainIntensity: 0,
    sunAltitudeDeg: 30,
    shipCount: 0,
    closeness: 0.5,
  };

  static isSupported(): boolean {
    return typeof window !== "undefined" && ("AudioContext" in window || "webkitAudioContext" in window);
  }

  get enabled(): boolean {
    return this.on;
  }

  /** Must be called from a user gesture (a click on the sound button). */
  async enable(): Promise<boolean> {
    if (!Soundscape.isSupported()) return false;
    if (!this.ctx) this.build();
    const ctx = this.ctx!;
    try {
      await ctx.resume();
    } catch {
      return false;
    }
    this.on = true;
    this.master!.gain.cancelScheduledValues(ctx.currentTime);
    this.master!.gain.setTargetAtTime(0.9, ctx.currentTime, 0.6);
    this.applyScene();
    this.scheduleSwell();
    this.scheduleHorn(6 + Math.random() * 10);
    this.scheduleGulls(3 + Math.random() * 6);
    document.addEventListener("visibilitychange", this.onVisibility);
    return true;
  }

  disable(): void {
    this.on = false;
    for (const id of this.timers) window.clearTimeout(id);
    this.timers = [];
    document.removeEventListener("visibilitychange", this.onVisibility);
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(0, ctx.currentTime, 0.25);
    window.setTimeout(() => {
      if (!this.on) void ctx.suspend().catch(() => {});
    }, 1200);
  }

  update(scene: SoundSceneInput): void {
    this.scene = scene;
    if (this.on) this.applyScene();
  }

  private readonly onVisibility = (): void => {
    if (!this.ctx) return;
    if (document.hidden) void this.ctx.suspend().catch(() => {});
    else if (this.on) void this.ctx.resume().catch(() => {});
  };

  private later(sec: number, fn: () => void): void {
    const id = window.setTimeout(() => {
      this.timers = this.timers.filter((t) => t !== id);
      if (this.on) fn();
    }, sec * 1000);
    this.timers.push(id);
  }

  private build(): void {
    const AC =
      (window as unknown as { AudioContext?: typeof AudioContext }).AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    const ctx = new AC();
    this.ctx = ctx;

    const master = ctx.createGain();
    master.gain.value = 0;
    // a gentle limiter, so a horn over rain never clips
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    master.connect(comp).connect(ctx.destination);
    this.master = master;

    const brown = noiseBuffer(ctx, 6, "brown");
    const white = noiseBuffer(ctx, 3, "white");

    const loop = (buf: AudioBuffer, rate = 1) => {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.playbackRate.value = rate;
      src.start();
      return src;
    };

    // waves
    {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 520;
      lp.Q.value = 0.4;
      const g = ctx.createGain();
      g.gain.value = 0;
      loop(brown).connect(lp).connect(g).connect(master);
      this.waves = g;
    }
    // city hum
    {
      const lp = ctx.createBiquadFilter();
      lp.type = "lowpass";
      lp.frequency.value = 160;
      const g = ctx.createGain();
      g.gain.value = 0;
      loop(brown, 0.6).connect(lp).connect(g).connect(master);
      this.hum = g;
    }
    // rain
    {
      const hp = ctx.createBiquadFilter();
      hp.type = "highpass";
      hp.frequency.value = 1400;
      const peak = ctx.createBiquadFilter();
      peak.type = "peaking";
      peak.frequency.value = 4200;
      peak.gain.value = 4;
      const g = ctx.createGain();
      g.gain.value = 0;
      loop(white).connect(hp).connect(peak).connect(g).connect(master);
      this.rain = g;
    }
  }

  private applyScene(): void {
    const ctx = this.ctx;
    if (!ctx) return;
    const now = ctx.currentTime;
    const s = this.scene;
    const near = 0.55 + 0.45 * Math.max(0, Math.min(1, s.closeness));
    const night = Math.max(0, Math.min(1, (2 - s.sunAltitudeDeg) / 10));
    this.hum?.gain.setTargetAtTime((0.16 - 0.08 * night) * near, now, 1.2);
    this.rain?.gain.setTargetAtTime(Math.min(0.5, s.rainIntensity * 0.55), now, 1.5);
  }

  /** The water never sits still: every few seconds the waves rise or fall a little. */
  private scheduleSwell(): void {
    const ctx = this.ctx;
    if (!ctx || !this.waves) return;
    const near = 0.55 + 0.45 * Math.max(0, Math.min(1, this.scene.closeness));
    const level = (0.18 + Math.random() * 0.3) * near;
    this.waves.gain.setTargetAtTime(level, ctx.currentTime, 1.1 + Math.random());
    this.later(2.5 + Math.random() * 3.5, () => this.scheduleSwell());
  }

  private scheduleHorn(inSec: number): void {
    this.later(inSec, () => {
      const foggy = (this.scene.mistIntensity ?? 0) > 0.4;
      if ((this.scene.shipCount > 0 || foggy) && !document.hidden) {
        this.horn(foggy || Math.random() < 0.35);
      }
      this.scheduleHorn(foggy ? 22 + Math.random() * 26 : 35 + Math.random() * 50);
    });
  }

  private horn(twoBlasts: boolean): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const pan = ctx.createStereoPanner();
    pan.pan.value = Math.random() * 1.2 - 0.6;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 520;
    lp.Q.value = 1.2;
    // a large ship's horn is far off: a touch of echo off the warehouses
    const delay = ctx.createDelay(1);
    delay.delayTime.value = 0.38;
    const fb = ctx.createGain();
    fb.gain.value = 0.28;
    delay.connect(fb).connect(delay);
    const env = ctx.createGain();
    env.gain.value = 0;
    env.connect(lp).connect(pan).connect(this.master);
    lp.connect(delay).connect(pan);

    const t0 = ctx.currentTime + 0.05;
    const blasts = twoBlasts ? [[0, 1.6], [2.2, 0.9]] : [[0, 2.6]];
    const end = t0 + blasts.reduce((m, [s, d]) => Math.max(m, s! + d!), 0) + 2.5;
    for (const f of [87, 130.5, 174]) {
      const o = ctx.createOscillator();
      o.type = "sawtooth";
      o.frequency.value = f;
      o.detune.value = Math.random() * 8 - 4;
      const g = ctx.createGain();
      g.gain.value = f > 150 ? 0.12 : 0.22;
      o.connect(g).connect(env);
      o.start(t0);
      o.stop(end);
    }
    for (const [s, d] of blasts) {
      const a = t0 + s!;
      env.gain.setTargetAtTime(0.32, a, 0.08);
      env.gain.setTargetAtTime(0, a + d!, 0.35);
    }
  }

  private scheduleGulls(inSec: number): void {
    this.later(inSec, () => {
      if (this.scene.sunAltitudeDeg > -2 && this.scene.rainIntensity < 0.4 && !document.hidden) {
        const calls = 2 + Math.floor(Math.random() * 3);
        const pan = Math.random() * 1.6 - 0.8;
        for (let i = 0; i < calls; i++) this.gull(i * (0.32 + Math.random() * 0.12), pan);
      }
      this.scheduleGulls(9 + Math.random() * 22);
    });
  }

  /** One "kyow": a reedy tone that jumps up and slides down, through a narrow band-pass. */
  private gull(offsetSec: number, panValue: number): void {
    const ctx = this.ctx;
    if (!ctx || !this.master) return;
    const t0 = ctx.currentTime + 0.05 + offsetSec;
    const dur = 0.24 + Math.random() * 0.1;
    const base = 1250 + Math.random() * 350;
    const o = ctx.createOscillator();
    o.type = "sawtooth";
    o.frequency.setValueAtTime(base * 0.8, t0);
    o.frequency.linearRampToValueAtTime(base * 1.5, t0 + dur * 0.25);
    o.frequency.exponentialRampToValueAtTime(base * 0.85, t0 + dur);
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = base * 1.6;
    bp.Q.value = 5;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0, t0);
    env.gain.linearRampToValueAtTime(0.06, t0 + 0.03);
    env.gain.setTargetAtTime(0, t0 + dur * 0.6, 0.06);
    const pan = ctx.createStereoPanner();
    pan.pan.value = panValue;
    o.connect(bp).connect(env).connect(pan).connect(this.master);
    o.start(t0);
    o.stop(t0 + dur + 0.4);
  }
}
