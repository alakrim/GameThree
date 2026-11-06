/**
 * Procedural sound effects for Frost & Hearthfire.
 *
 * Nothing is loaded from disk: every sound is synthesized with the Web Audio API
 * from oscillators, filtered noise and envelopes. The AudioContext is created lazily
 * on unlock(), so this module is safe to import before any user gesture.
 */

export type SfxName =
  | 'swing'
  | 'hit'
  | 'hitMetal'
  | 'cast'
  | 'frostBolt'
  | 'iceShatter'
  | 'dash'
  | 'horn'
  | 'towerShot'
  | 'explosion'
  | 'death'
  | 'levelUp'
  | 'footstep'
  | 'uiClick'
  | 'victory'
  | 'defeat';

export interface Vec3Like {
  x: number;
  y: number;
  z: number;
}

type NoiseKind = 'white' | 'pink' | 'brown';
type NoiseBuffers = Record<NoiseKind, AudioBuffer>;

const FLOOR = 0.0001;
const MAX_VOICES = 24;
const MAX_DISTANCE = 70;
const MIN_GAP_MS = 30;

/** Working state for one sound while its graph is being built. */
interface Build {
  ctx: AudioContext;
  bufs: NoiseBuffers;
  /** Per-sound bus: carries the sound's level and randomized volume. */
  out: GainNode;
  /** Every node created for this sound; disconnected once it has finished. */
  nodes: AudioNode[];
  /** Start time on the AudioContext clock. */
  t: number;
  /** Latest stop time on the AudioContext clock. */
  end: number;
  /** Frequency multiplier (opts.pitch times a random +-6%). */
  p: number;
  rnd: () => number;
}

interface SoundDef {
  level: number;
  build(b: Build): void;
}

function createContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return null;
  try {
    return new Ctor();
  } catch {
    return null;
  }
}

function scale(v: number | undefined, lo: number, hi: number): number {
  if (v === undefined || !Number.isFinite(v)) return 1;
  return Math.min(hi, Math.max(lo, v));
}

function makeNoise(ctx: AudioContext, kind: NoiseKind): AudioBuffer {
  const len = Math.floor(ctx.sampleRate * 2);
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const d = buf.getChannelData(0);
  // Paul Kellet's economy pink-noise filter state.
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;
  let brown = 0;
  let peak = 0;
  for (let i = 0; i < len; i++) {
    const w = Math.random() * 2 - 1;
    let s: number;
    if (kind === 'white') {
      s = w;
    } else if (kind === 'pink') {
      b0 = 0.99886 * b0 + w * 0.0555179;
      b1 = 0.99332 * b1 + w * 0.0750759;
      b2 = 0.969 * b2 + w * 0.153852;
      b3 = 0.8665 * b3 + w * 0.3104856;
      b4 = 0.55 * b4 + w * 0.5329522;
      b5 = -0.7616 * b5 - w * 0.016898;
      s = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362) * 0.11;
      b6 = w * 0.115926;
    } else {
      brown = (brown + 0.02 * w) / 1.02;
      s = brown * 3.5;
    }
    d[i] = s;
    const a = Math.abs(s);
    if (a > peak) peak = a;
  }
  if (peak > 0) {
    const k = 0.9 / peak;
    for (let i = 0; i < len; i++) d[i] = (d[i] ?? 0) * k;
  }
  return buf;
}

function track<T extends AudioNode>(b: Build, node: T): T {
  b.nodes.push(node);
  return node;
}

function reach(b: Build, t: number): void {
  if (t > b.end) b.end = t;
}

/** Connects nodes[0] -> nodes[1] -> ... in order. */
function link(...nodes: AudioNode[]): void {
  for (let i = 0; i + 1 < nodes.length; i++) {
    const a = nodes[i];
    const c = nodes[i + 1];
    if (a && c) a.connect(c);
  }
}

function gain(b: Build, value: number): GainNode {
  const g = track(b, b.ctx.createGain());
  g.gain.value = value;
  return g;
}

function biquad(b: Build, type: BiquadFilterType, freq: number, q = 0.707): BiquadFilterNode {
  const f = track(b, b.ctx.createBiquadFilter());
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  return f;
}

/** Filter whose frequency glides exponentially from `from` to `to`. */
function sweep(
  b: Build,
  type: BiquadFilterType,
  from: number,
  to: number,
  dur: number,
  q = 0.707,
  at = 0,
): BiquadFilterNode {
  const f = biquad(b, type, from, q);
  const t0 = b.t + at;
  f.frequency.setValueAtTime(from, t0);
  f.frequency.exponentialRampToValueAtTime(to, t0 + dur);
  return f;
}

/**
 * Amplitude envelope: exponential attack to `peak`, optional hold, then exponential
 * release to silence. Starts `at` seconds after the sound's start time.
 */
function env(
  b: Build,
  peak: number,
  attack: number,
  hold: number,
  release: number,
  at = 0,
): GainNode {
  const g = gain(b, FLOOR);
  const t0 = b.t + at;
  const tA = t0 + Math.max(attack, 0.002);
  const tH = tA + hold;
  const tR = tH + Math.max(release, 0.01);
  const pk = Math.max(peak, FLOOR);
  g.gain.setValueAtTime(FLOOR, t0);
  g.gain.exponentialRampToValueAtTime(pk, tA);
  if (hold > 0) g.gain.setValueAtTime(pk, tH);
  g.gain.exponentialRampToValueAtTime(FLOOR, tR);
  reach(b, tR);
  return g;
}

/** Oscillator at `freq` (scaled by pitch), optionally gliding to `glideTo`. */
function tone(
  b: Build,
  type: OscillatorType,
  freq: number,
  at: number,
  dur: number,
  glideTo?: number,
): OscillatorNode {
  const o = track(b, b.ctx.createOscillator());
  const t0 = b.t + at;
  o.type = type;
  o.frequency.setValueAtTime(freq * b.p, t0);
  if (glideTo !== undefined) o.frequency.exponentialRampToValueAtTime(glideTo * b.p, t0 + dur);
  o.start(t0);
  o.stop(t0 + dur);
  reach(b, t0 + dur);
  return o;
}

/** Slow modulator in Hz (not affected by pitch); route it into a gain for depth. */
function lfo(b: Build, hz: number, dur: number): OscillatorNode {
  const o = track(b, b.ctx.createOscillator());
  o.frequency.value = hz;
  o.start(b.t);
  o.stop(b.t + dur);
  reach(b, b.t + dur);
  return o;
}

/** Looping noise segment from a random point in the cached buffer. */
function noise(b: Build, kind: NoiseKind, dur: number, at = 0): AudioBufferSourceNode {
  const s = track(b, b.ctx.createBufferSource());
  const t0 = b.t + at;
  s.buffer = b.bufs[kind];
  s.loop = true;
  s.playbackRate.value = b.p;
  s.start(t0, b.rnd());
  s.stop(t0 + dur);
  reach(b, t0 + dur);
  return s;
}

/** Low thump: sine dropping 120 -> 50 Hz. */
function thump(b: Build, at: number, peak: number, dur: number): void {
  const o = tone(b, 'sine', 120, at, dur, 50);
  link(o, env(b, peak, 0.004, 0, dur - 0.004, at), b.out);
}

/** Short high noise crack. */
function crack(b: Build, at: number, peak: number): void {
  const n = noise(b, 'white', 0.04, at);
  link(n, biquad(b, 'highpass', 1800, 0.7), env(b, peak, 0.002, 0, 0.035, at), b.out);
}

const SOUNDS: Record<SfxName, SoundDef> = {
  swing: {
    level: 0.5,
    build: (b) => {
      const n = noise(b, 'white', 0.22);
      const bp = sweep(b, 'bandpass', 600, 2500, 0.2, 1.2);
      link(n, bp, env(b, 1, 0.04, 0, 0.18), b.out);
    },
  },

  hit: {
    level: 0.8,
    build: (b) => {
      thump(b, 0, 0.9, 0.18);
      crack(b, 0, 0.4);
    },
  },

  hitMetal: {
    level: 0.55,
    build: (b) => {
      thump(b, 0, 0.8, 0.18);
      crack(b, 0, 0.35);
      // Inharmonic partials spread over ~1.2k-3.4k Hz, each slightly detuned, ringing out.
      const base = 1200 * (1 + (b.rnd() - 0.5) * 0.06);
      const partials = [
        { r: 1, a: 0.16 },
        { r: 1.93, a: 0.11 },
        { r: 2.81, a: 0.07 },
      ];
      for (const pt of partials) {
        const f = base * pt.r * (1 + (b.rnd() - 0.5) * 0.03);
        link(tone(b, 'sine', f, 0, 0.42), env(b, pt.a, 0.002, 0, 0.4), b.out);
      }
    },
  },

  cast: {
    level: 0.4,
    build: (b) => {
      const dur = 0.5;
      const n = noise(b, 'white', dur);
      link(n, sweep(b, 'bandpass', 800, 3000, dur, 1.8), env(b, 0.6, 0.12, 0.05, 0.3), b.out);
      // Rising sine glissando with a quieter octave partial for shimmer.
      const e1 = env(b, 0.3, 0.1, 0.05, 0.33);
      const e2 = env(b, 0.12, 0.12, 0.05, 0.33);
      link(tone(b, 'sine', 400, 0, dur, 1200), e1, b.out);
      link(tone(b, 'sine', 800, 0, dur, 2400), e2, b.out);
    },
  },

  frostBolt: {
    level: 0.4,
    build: (b) => {
      const dur = 0.35;
      const n = noise(b, 'white', dur);
      const e = env(b, 0.6, 0.05, 0.05, 0.25);
      link(n, biquad(b, 'highpass', 3000, 0.7), e);
      e.connect(b.out);
      // Slight chorus: a delayed copy whose delay time is wobbled by a slow LFO.
      const dl = track(b, b.ctx.createDelay(0.05));
      dl.delayTime.value = 0.018;
      const mod = lfo(b, 4.5, dur);
      const depth = gain(b, 0.004);
      mod.connect(depth);
      depth.connect(dl.delayTime);
      link(e, dl, gain(b, 0.7), b.out);
    },
  },

  iceShatter: {
    level: 0.5,
    build: (b) => {
      const n = noise(b, 'white', 0.09);
      link(n, biquad(b, 'highpass', 4000, 0.7), env(b, 1, 0.002, 0, 0.08), b.out);
      // Crystalline pings at random high pitches and times.
      const pings = 5 + Math.floor(b.rnd() * 4);
      for (let i = 0; i < pings; i++) {
        const at = i === 0 ? 0 : b.rnd() * 0.3;
        const f = 1800 + b.rnd() * 3400;
        const decay = 0.15 + b.rnd() * 0.25;
        const peak = 0.1 + b.rnd() * 0.1;
        link(tone(b, 'sine', f, at, decay + 0.02), env(b, peak, 0.002, 0, decay, at), b.out);
      }
    },
  },

  dash: {
    level: 0.5,
    build: (b) => {
      const dur = 0.42;
      // Low rushing whoosh.
      const w = noise(b, 'pink', dur);
      link(w, sweep(b, 'bandpass', 380, 900, dur, 0.9), env(b, 0.9, 0.08, 0.1, dur - 0.18), b.out);
      // Cloth flutter: white noise amplitude-modulated by a fast LFO.
      const f = noise(b, 'white', dur);
      const am = gain(b, 0.5);
      const flutter = lfo(b, 17, dur);
      const depth = gain(b, 0.5);
      flutter.connect(depth);
      depth.connect(am.gain);
      link(f, biquad(b, 'highpass', 1200, 0.7), am, env(b, 0.35, 0.03, 0.12, dur - 0.15), b.out);
    },
  },

  horn: {
    level: 0.5,
    build: (b) => {
      const dur = 1.6;
      // Gentle vibrato applied to both pitches.
      const vib = lfo(b, 5.5, dur);
      const vibDepth = gain(b, 3);
      vib.connect(vibDepth);
      const root = tone(b, 'sawtooth', 110, 0, dur);
      const fifth = tone(b, 'sawtooth', 165, 0, dur);
      vibDepth.connect(root.frequency);
      vibDepth.connect(fifth.frequency);
      const lp = sweep(b, 'lowpass', 520, 900, 0.6, 0.9);
      link(root, gain(b, 0.6), lp);
      link(fifth, gain(b, 0.35), lp);
      // Slow 0.25 s attack, held, then a long release (total 1.6 s).
      link(lp, env(b, 0.8, 0.25, 0.85, 0.5), b.out);
    },
  },

  towerShot: {
    level: 0.5,
    build: (b) => {
      const dur = 0.5;
      // Fiery whoosh: brown noise through a rising bandpass.
      const w = noise(b, 'brown', dur);
      link(w, sweep(b, 'bandpass', 380, 1700, 0.4, 1.0), env(b, 0.9, 0.06, 0.1, dur - 0.16), b.out);
      // Crackle: a scatter of tiny high noise pops.
      for (let i = 0; i < 10; i++) {
        const at = b.rnd() * 0.42;
        const c = noise(b, 'white', 0.014, at);
        link(
          c,
          biquad(b, 'highpass', 2500, 0.8),
          env(b, 0.25 + b.rnd() * 0.35, 0.002, 0, 0.012, at),
          b.out,
        );
      }
    },
  },

  explosion: {
    level: 0.9,
    build: (b) => {
      const dur = 1.0;
      // Heavy white-noise burst with a lowpass sweeping down.
      const w = noise(b, 'white', dur);
      link(w, sweep(b, 'lowpass', 2400, 140, 0.9, 0.8), env(b, 1, 0.005, 0.05, 0.85), b.out);
      // Brown-noise body.
      const br = noise(b, 'brown', dur);
      link(br, sweep(b, 'lowpass', 500, 90, 0.8, 0.7), env(b, 0.8, 0.005, 0.02, 0.7), b.out);
      // Sub thump.
      link(tone(b, 'sine', 95, 0, 0.7, 32), env(b, 0.9, 0.003, 0, 0.69), b.out);
    },
  },

  death: {
    level: 0.6,
    build: (b) => {
      // Groan: two detuned saws falling in pitch through a dark lowpass.
      const lp = biquad(b, 'lowpass', 380, 1.4);
      link(tone(b, 'sawtooth', 150, 0, 0.9, 62), lp);
      link(tone(b, 'sawtooth', 154, 0, 0.9, 64), lp);
      link(lp, env(b, 0.5, 0.15, 0.3, 0.45), b.out);
      // Filtered pink noise moaning downward.
      const moan = noise(b, 'pink', 0.9);
      link(moan, sweep(b, 'bandpass', 320, 90, 0.9, 2.2), env(b, 0.6, 0.15, 0.3, 0.45), b.out);
      // Thud at the end.
      link(tone(b, 'sine', 85, 0.85, 0.25, 38), env(b, 0.9, 0.003, 0, 0.24, 0.85), b.out);
    },
  },

  levelUp: {
    level: 0.45,
    build: (b) => {
      // Warm ascending three-note chime: triangles with a soft octave sine.
      [523.25, 659.25, 783.99].forEach((f, i) => {
        const at = i * 0.12;
        link(tone(b, 'triangle', f, at, 0.6), env(b, 0.5, 0.008, 0.03, 0.55, at), b.out);
        link(tone(b, 'sine', f * 2, at, 0.6), env(b, 0.08, 0.008, 0.03, 0.55, at), b.out);
      });
    },
  },

  footstep: {
    level: 0.2,
    build: (b) => {
      const n = noise(b, 'white', 0.06);
      link(n, biquad(b, 'bandpass', 1100, 0.9), env(b, 1, 0.004, 0, 0.05), b.out);
    },
  },

  uiClick: {
    level: 0.2,
    build: (b) => {
      link(tone(b, 'sine', 2400, 0, 0.02, 1200), env(b, 0.8, 0.002, 0, 0.012), b.out);
      const n = noise(b, 'white', 0.008);
      link(n, biquad(b, 'highpass', 4000, 0.7), env(b, 0.4, 0.002, 0, 0.005), b.out);
    },
  },

  victory: {
    level: 0.35,
    build: (b) => {
      // C major chord with detuned sawtooth pairs; a lowpass opens like brass.
      const lp = sweep(b, 'lowpass', 420, 2600, 0.6, 1.0);
      link(lp, env(b, 0.7, 0.4, 1.1, 0.5), b.out);
      for (const f of [261.63, 329.63, 392.0, 523.25]) {
        for (const det of [0.997, 1.003]) {
          link(tone(b, 'sawtooth', f * det, 0, 2.0), gain(b, 0.12), lp);
        }
      }
    },
  },

  defeat: {
    level: 0.35,
    build: (b) => {
      // D minor chord (low), dark and slow to swell in and out.
      const lp = biquad(b, 'lowpass', 420, 0.8);
      link(lp, env(b, 0.6, 0.6, 0.8, 0.6), b.out);
      for (const f of [73.42, 87.31, 110.0, 146.83]) {
        link(tone(b, 'sawtooth', f, 0, 2.0), gain(b, 0.12), lp);
      }
      link(tone(b, 'sine', 36.71, 0, 2.0), gain(b, 0.5), lp);
    },
  },
};

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private bufs: NoiseBuffers | null = null;
  private masterVolume = 0.7;
  private unavailable = false;
  private voices = 0;
  private readonly lastStart = new Map<SfxName, number>();

  private ambienceRequested = false;
  private ambienceBuilt = false;

  private listenerSet = false;
  private hasListenerParams = false;
  private lx = 0;
  private ly = 0;
  private lz = 0;
  private fx = 0;
  private fy = 0;
  private fz = -1;

  /** Create or resume the AudioContext. Call from a user gesture; safe to repeat. */
  unlock(): void {
    if (this.unavailable) return;
    try {
      let ctx = this.ctx;
      if (!ctx) {
        const created = createContext();
        if (!created) {
          this.unavailable = true;
          return;
        }
        ctx = created;
        this.ctx = ctx;
        this.hasListenerParams =
          typeof ctx.listener.positionX !== 'undefined' &&
          typeof ctx.listener.forwardX !== 'undefined';

        const master = ctx.createGain();
        master.gain.value = this.masterVolume;
        const comp = ctx.createDynamicsCompressor();
        master.connect(comp);
        comp.connect(ctx.destination);
        this.master = master;

        this.bufs = {
          white: makeNoise(ctx, 'white'),
          pink: makeNoise(ctx, 'pink'),
          brown: makeNoise(ctx, 'brown'),
        };
        this.applyListener();
      }
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => undefined);
      }
      if (this.ambienceRequested) this.buildAmbience();
    } catch {
      this.unavailable = true;
    }
  }

  /** Camera position and forward direction in world space. Called every frame. */
  setListener(pos: Vec3Like, forward: Vec3Like): void {
    this.lx = pos.x;
    this.ly = pos.y;
    this.lz = pos.z;
    const len = Math.hypot(forward.x, forward.y, forward.z);
    if (len > 1e-6) {
      this.fx = forward.x / len;
      this.fy = forward.y / len;
      this.fz = forward.z / len;
    }
    this.listenerSet = true;
    this.applyListener();
  }

  /** Plays a one-shot. Omit `at` for 2D (UI) sounds. No-op before unlock(). */
  play(name: SfxName, at?: Vec3Like, opts?: { volume?: number; pitch?: number }): void {
    if (this.unavailable) return;
    const ctx = this.ctx;
    const master = this.master;
    const bufs = this.bufs;
    if (!ctx || !master || !bufs || ctx.state !== 'running') return;
    try {
      if (at !== undefined && this.listenerSet) {
        const dx = at.x - this.lx;
        const dy = at.y - this.ly;
        const dz = at.z - this.lz;
        if (dx * dx + dy * dy + dz * dz > MAX_DISTANCE * MAX_DISTANCE) return;
      }
      if (this.voices >= MAX_VOICES) return;
      const now = performance.now();
      const last = this.lastStart.get(name);
      if (last !== undefined && now - last < MIN_GAP_MS) return;

      const rnd = Math.random;
      const pitch = scale(opts?.pitch, 0.25, 4) * (1 + (rnd() * 2 - 1) * 0.06);
      const volume = scale(opts?.volume, 0, 4) * (1 + (rnd() * 2 - 1) * 0.1);

      const def = SOUNDS[name];
      const out = ctx.createGain();
      out.gain.value = def.level * volume;
      const nodes: AudioNode[] = [out];

      if (at !== undefined) {
        const panner = ctx.createPanner();
        panner.panningModel = 'HRTF';
        panner.distanceModel = 'inverse';
        panner.refDistance = 3;
        panner.maxDistance = MAX_DISTANCE;
        panner.rolloffFactor = 1.2;
        if (typeof panner.positionX !== 'undefined') {
          panner.positionX.value = at.x;
          panner.positionY.value = at.y;
          panner.positionZ.value = at.z;
        } else {
          panner.setPosition(at.x, at.y, at.z);
        }
        nodes.push(panner);
        out.connect(panner);
        panner.connect(master);
      } else {
        out.connect(master);
      }

      const b: Build = {
        ctx,
        bufs,
        out,
        nodes,
        t: ctx.currentTime + 0.01,
        end: 0,
        p: pitch,
        rnd,
      };
      def.build(b);

      this.lastStart.set(name, now);
      this.voices++;
      const life = Math.max(0, b.end - ctx.currentTime) * 1000 + 100;
      setTimeout(() => {
        for (const n of nodes) {
          try {
            n.disconnect();
          } catch {
            // Already disconnected.
          }
        }
        this.voices = Math.max(0, this.voices - 1);
      }, life);
    } catch {
      // Audio must never break gameplay.
    }
  }

  /** Starts the looping wind bed (filtered noise with slow gusts). Deferred until unlock(). */
  startAmbience(): void {
    this.ambienceRequested = true;
    this.buildAmbience();
  }

  setMasterVolume(v: number): void {
    if (!Number.isFinite(v)) return;
    this.masterVolume = Math.min(1, Math.max(0, v));
    try {
      if (this.ctx && this.master) {
        this.master.gain.setTargetAtTime(this.masterVolume, this.ctx.currentTime, 0.02);
      }
    } catch {
      // Ignore: context may be closed.
    }
  }

  private applyListener(): void {
    const ctx = this.ctx;
    if (!ctx || !this.listenerSet) return;
    try {
      const l = ctx.listener;
      if (this.hasListenerParams) {
        l.positionX.value = this.lx;
        l.positionY.value = this.ly;
        l.positionZ.value = this.lz;
        l.forwardX.value = this.fx;
        l.forwardY.value = this.fy;
        l.forwardZ.value = this.fz;
        l.upX.value = 0;
        l.upY.value = 1;
        l.upZ.value = 0;
      } else {
        l.setPosition(this.lx, this.ly, this.lz);
        l.setOrientation(this.fx, this.fy, this.fz, 0, 1, 0);
      }
    } catch {
      // Ignore listener update failures.
    }
  }

  private buildAmbience(): void {
    const ctx = this.ctx;
    const master = this.master;
    const bufs = this.bufs;
    if (!ctx || !master || !bufs || this.ambienceBuilt) return;
    this.ambienceBuilt = true;
    try {
      const bus = ctx.createGain();
      bus.gain.value = 0.8;
      bus.connect(master);

      // Layer 1: brown-noise wind body. A slow LFO sweeps its lowpass.
      const brown = ctx.createBufferSource();
      brown.buffer = bufs.brown;
      brown.loop = true;
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 420;
      lp.Q.value = 0.7;
      const windGain = ctx.createGain();
      windGain.gain.value = 0.05;
      brown.connect(lp);
      lp.connect(windGain);
      windGain.connect(bus);

      // Layer 2: pink-noise hiss higher up.
      const pink = ctx.createBufferSource();
      pink.buffer = bufs.pink;
      pink.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1100;
      bp.Q.value = 0.5;
      const hiss = ctx.createGain();
      hiss.gain.value = 0.012;
      pink.connect(bp);
      bp.connect(hiss);
      hiss.connect(bus);

      // Slow LFOs: filter sweep and a gentle gain swell on the wind body.
      const lfoF = ctx.createOscillator();
      lfoF.frequency.value = 0.07;
      const lfoFDepth = ctx.createGain();
      lfoFDepth.gain.value = 260;
      lfoF.connect(lfoFDepth);
      lfoFDepth.connect(lp.frequency);

      const lfoG = ctx.createOscillator();
      lfoG.frequency.value = 0.13;
      const lfoGDepth = ctx.createGain();
      lfoGDepth.gain.value = 0.02;
      lfoG.connect(lfoGDepth);
      lfoGDepth.connect(windGain.gain);

      const t = ctx.currentTime;
      brown.start(t, Math.random());
      pink.start(t, Math.random());
      lfoF.start(t);
      lfoG.start(t);

      // Random gusts: periodically retarget the wind level with a smooth glide.
      const gust = (): void => {
        if (ctx.state === 'closed') return;
        windGain.gain.setTargetAtTime(0.035 + Math.random() * 0.07, ctx.currentTime, 1.5);
        setTimeout(gust, 3000 + Math.random() * 5000);
      };
      gust();
    } catch {
      // Ambience is optional.
    }
  }
}

/** Shared singleton used by the game. */
export const sfx: Sfx = new Sfx();
