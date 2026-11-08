import { rand, pick, clamp } from '../core/util.js';

/**
 * Every sound here is built from oscillators and noise at runtime —
 * there is not a single audio file in this project.
 *
 *   bell()    FM temple bell, struck when a diya catches
 *   whoosh()  band-passed noise sweep, a shell leaving the ghat
 *   boom()    body hit: sub thump + filtered noise crack
 *   crackle() scattered high impulses, the tail of a chrysanthemum
 *   drone()   two detuned saws + a plucked tanpura figure underneath
 */
export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.muted = false;
    this._droneNodes = [];
    this._tanpuraTimer = null;
    this._voices = 0;
  }

  /* ── plumbing ──────────────────────────────────────────────── */

  init() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    const ctx = new AC({ latencyHint: 'interactive' });
    this.ctx = ctx;

    // master chain: bus -> compressor -> master -> out
    this.bus = ctx.createGain();
    this.bus.gain.value = 1;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 24;
    comp.ratio.value = 7;
    comp.attack.value = 0.004;
    comp.release.value = 0.22;

    this.master = ctx.createGain();
    this.master.gain.value = 0;

    this.bus.connect(comp);
    comp.connect(this.master);
    this.master.connect(ctx.destination);

    // a shared plate reverb, impulse generated from decaying noise
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(2.9, 2.4);
    this.wet = ctx.createGain();
    this.wet.gain.value = 0.42;
    this.reverb.connect(this.wet);
    this.wet.connect(comp);

    this.noise = this._noiseBuffer(2.5);
    this.ready = true;
    return ctx;
  }

  /** Call from a user gesture. */
  async unlock() {
    const ctx = this.init();
    if (!ctx) return false;
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { /* ignore */ }
    }
    this.master.gain.cancelScheduledValues(ctx.currentTime);
    this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, ctx.currentTime, 1.2);
    return true;
  }

  setMuted(muted) {
    this.muted = muted;
    if (!this.ctx) return;
    this.master.gain.cancelScheduledValues(this.ctx.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.9, this.ctx.currentTime, 0.12);
  }

  get t() { return this.ctx ? this.ctx.currentTime : 0; }

  /** Cheap polyphony guard so a 30-shell finale cannot choke the graph. */
  _budget(cost = 1) {
    if (this._voices > 56) return false;
    this._voices += cost;
    setTimeout(() => { this._voices = Math.max(0, this._voices - cost); }, 2600);
    return true;
  }

  _noiseBuffer(seconds) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  _impulse(seconds, decay) {
    const { ctx } = this;
    const len = Math.floor(ctx.sampleRate * seconds);
    const buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        // early reflections then a smooth exponential tail
        const env = Math.pow(1 - t, decay);
        const slap = i < ctx.sampleRate * 0.02 ? 1.6 : 1;
        d[i] = (Math.random() * 2 - 1) * env * slap;
      }
    }
    return buf;
  }

  _src(buffer, { playbackRate = 1, loop = false } = {}) {
    const s = this.ctx.createBufferSource();
    s.buffer = buffer;
    s.loop = loop;
    s.playbackRate.value = playbackRate;
    return s;
  }

  /** Position a mono voice in the stereo field and feed the reverb. */
  _place(node, pan = 0, wet = 0.3) {
    const p = this.ctx.createStereoPanner();
    p.pan.value = clamp(pan, -1, 1);
    node.connect(p);
    p.connect(this.bus);
    if (wet > 0) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      p.connect(send);
      send.connect(this.reverb);
    }
    return p;
  }

  /* ── voices ────────────────────────────────────────────────── */

  /**
   * Temple bell. Inharmonic partials (1, 2.76, 5.4) are what separate a
   * bell from a sine beep; the FM index decays faster than the body.
   */
  bell({ freq = 392, gain = 0.3, pan = 0, decay = 2.6 } = {}) {
    if (!this.ready || !this._budget()) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 1;
    this._place(out, pan, 0.5);

    const partials = [
      [1.0, 1.0, decay],
      [2.76, 0.42, decay * 0.62],
      [5.4, 0.18, decay * 0.35],
      [8.93, 0.08, decay * 0.2],
    ];

    const nyquist = ctx.sampleRate * 0.5;
    for (const [ratio, amp, dec] of partials) {
      if (freq * ratio >= nyquist * 0.92) continue;   // no audible content up there
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq * ratio;

      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(gain * amp, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dec);

      osc.connect(g);
      g.connect(out);
      osc.start(t);
      osc.stop(t + dec + 0.05);
    }

    // the strike itself
    const mod = ctx.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * 3.5;
    const modGain = ctx.createGain();
    modGain.gain.setValueAtTime(freq * 1.4, t);
    modGain.gain.exponentialRampToValueAtTime(1, t + 0.18);
    mod.connect(modGain);

    const car = ctx.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;
    modGain.connect(car.frequency);
    const cg = ctx.createGain();
    cg.gain.setValueAtTime(gain * 0.5, t);
    cg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
    car.connect(cg);
    cg.connect(out);

    mod.start(t); car.start(t);
    mod.stop(t + 0.45); car.stop(t + 0.45);
  }

  /** A small struck blip — one diya catching from its neighbour. */
  spark({ pan = 0, step = 0 } = {}) {
    if (!this.ready || !this._budget(0.5)) return;
    // raga-ish pentatonic so a cascade of twenty still sounds musical
    const scale = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24];
    const n = step % (scale.length * 2);
    // climb one octave over a cascade, then start again — never run off the top
    const semis = scale[n % scale.length] + (n >= scale.length ? 12 : 0);
    const freq = 261.63 * Math.pow(2, semis / 12);
    this.bell({ freq: Math.min(freq * 2, 4200), gain: 0.085, pan, decay: 1.5 });
  }

  /** Shell leaving the ground: noise through a rising band-pass. */
  whoosh({ pan = 0, dur = 0.85 } = {}) {
    if (!this.ready || !this._budget()) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = this._src(this.noise, { playbackRate: 1 });

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.Q.value = 1.6;
    bp.frequency.setValueAtTime(260, t);
    bp.frequency.exponentialRampToValueAtTime(2600, t + dur);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.1, t + 0.1);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(bp); bp.connect(g);
    this._place(g, pan, 0.18);
    src.start(t);
    src.stop(t + dur + 0.05);
  }

  /** The burst. Sub thump plus a short filtered crack, lots of reverb. */
  boom({ pan = 0, size = 1 } = {}) {
    if (!this.ready || !this._budget(1.5)) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const dur = 0.5 + size * 0.5;

    // body
    const src = this._src(this.noise, { playbackRate: rand(0.75, 1.1) });
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1400 * size, t);
    lp.frequency.exponentialRampToValueAtTime(140, t + dur);
    lp.Q.value = 0.8;

    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.42 * size, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);

    src.connect(lp); lp.connect(g);
    this._place(g, pan, 0.72);
    src.start(t);
    src.stop(t + dur + 0.05);

    // sub
    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(74 * size, t);
    sub.frequency.exponentialRampToValueAtTime(31, t + dur * 0.8);
    const sg = ctx.createGain();
    sg.gain.setValueAtTime(0.0001, t);
    sg.gain.linearRampToValueAtTime(0.5 * size, t + 0.02);
    sg.gain.exponentialRampToValueAtTime(0.0001, t + dur * 0.9);
    sub.connect(sg);
    this._place(sg, pan * 0.4, 0.2);
    sub.start(t);
    sub.stop(t + dur + 0.1);
  }

  /**
   * Crackle: a few dozen tiny high-passed impulses scattered in time.
   * One shared noise source, one gain curve per grain — cheap enough to
   * fire on every shell.
   */
  crackle({ pan = 0, dur = 1.5, density = 34 } = {}) {
    if (!this.ready || !this._budget()) return;
    const { ctx } = this;
    const t0 = ctx.currentTime;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2600;

    const out = ctx.createGain();
    out.gain.value = 0.9;
    hp.connect(out);
    this._place(out, pan, 0.4);

    const n = Math.round(density);
    for (let i = 0; i < n; i++) {
      const at = t0 + Math.pow(Math.random(), 0.6) * dur;
      const src = this._src(this.noise, { playbackRate: rand(1.4, 2.6) });
      const g = ctx.createGain();
      const amp = rand(0.04, 0.17) * (1 - at / (t0 + dur + 0.001));
      g.gain.setValueAtTime(0.0001, at);
      g.gain.linearRampToValueAtTime(Math.max(0.005, amp), at + 0.002);
      g.gain.exponentialRampToValueAtTime(0.0001, at + rand(0.03, 0.09));
      src.connect(g); g.connect(hp);
      src.start(at, rand(0, 2));
      src.stop(at + 0.14);
    }
  }

  /** Long shimmering tail for the finale shells. */
  shimmer({ pan = 0 } = {}) {
    if (!this.ready || !this._budget()) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const src = this._src(this.noise, { playbackRate: 2.4 });
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5200;
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.07, t + 0.25);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 2.4);
    src.connect(bp); bp.connect(g);
    this._place(g, pan, 0.6);
    src.start(t);
    src.stop(t + 2.5);
  }

  /* ── ambience ──────────────────────────────────────────────── */

  startDrone() {
    if (!this.ready || this._droneNodes.length) return;
    const { ctx } = this;
    const t = ctx.currentTime;
    const root = 65.41; // C2

    const out = ctx.createGain();
    out.gain.setValueAtTime(0.0001, t);
    out.gain.linearRampToValueAtTime(0.09, t + 6);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 460;
    lp.Q.value = 0.6;

    // slow breathing on the cutoff
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.045;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 180;
    lfo.connect(lfoGain);
    lfoGain.connect(lp.frequency);
    lfo.start(t);

    out.connect(lp);
    this._place(lp, 0, 0.5);

    for (const [mult, detune, type, amp] of [
      [1, -6, 'sawtooth', 0.5],
      [1, 7, 'sawtooth', 0.45],
      [1.5, 3, 'triangle', 0.3],
      [2, -4, 'sine', 0.22],
    ]) {
      const osc = ctx.createOscillator();
      osc.type = type;
      osc.frequency.value = root * mult;
      osc.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = amp;
      osc.connect(g); g.connect(out);
      osc.start(t);
      this._droneNodes.push(osc);
    }
    this._droneNodes.push(lfo);
    this._droneGain = out;

    // tanpura-ish pluck wandering over the drone
    const degrees = [1, 1.5, 2, 2.25, 3];
    const pluck = () => {
      if (!this.ctx) return;
      const f = root * 4 * pick(degrees);
      this.bell({ freq: f, gain: 0.05, pan: rand(-0.5, 0.5), decay: 3.6 });
      this._tanpuraTimer = setTimeout(pluck, rand(4200, 9000));
    };
    this._tanpuraTimer = setTimeout(pluck, 2600);
  }

  /** Swell the pad when the sky opens. */
  liftDrone(amount = 0.14) {
    if (!this._droneGain) return;
    this._droneGain.gain.setTargetAtTime(amount, this.ctx.currentTime, 3);
  }

  dispose() {
    clearTimeout(this._tanpuraTimer);
    for (const n of this._droneNodes) { try { n.stop(); } catch { /* ignore */ } }
    this._droneNodes = [];
    this.ctx?.close?.();
    this.ctx = null;
    this.ready = false;
  }
}

export const audio = new AudioEngine();
