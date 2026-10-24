// Tiny synthesized sound effects (WebAudio, zero assets).
// Lives outside core/: the simulation stays pure, sounds are observed state.

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private lastKick = 0;
  private lastTouch = 0;
  muted = false;

  /** Must be called from a user gesture (click/keydown) to satisfy autoplay. */
  init(): void {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    try {
      const Ctor = window.AudioContext
        ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctor) return;
      this.ctx = new Ctor();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(this.ctx.destination);
    } catch {
      this.ctx = null;
    }
  }

  toggle(): boolean {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.5;
    return this.muted;
  }

  private get t(): number {
    return this.ctx ? this.ctx.currentTime : 0;
  }

  /** Ball struck: filtered noise thump + descending sine body. power 0..1 */
  kick(power: number): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = performance.now();
    if (now - this.lastKick < 70) return;
    this.lastKick = now;

    const ctx = this.ctx;
    const dur = 0.09;
    const buf = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 500 + power * 900;
    const g = ctx.createGain();
    g.gain.value = 0.18 + power * 0.3;
    src.connect(filt).connect(g).connect(this.master);
    src.start();

    const osc = ctx.createOscillator();
    osc.frequency.setValueAtTime(95 + power * 50, this.t);
    osc.frequency.exponentialRampToValueAtTime(45, this.t + 0.08);
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.22 + power * 0.25, this.t);
    og.gain.exponentialRampToValueAtTime(0.001, this.t + 0.11);
    osc.connect(og).connect(this.master);
    osc.start();
    osc.stop(this.t + 0.12);
  }

  /** Soft dribble touch. */
  touch(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const now = performance.now();
    if (now - this.lastTouch < 110) return;
    this.lastTouch = now;
    this.kick(0.05);
  }

  /** Referee whistle. long = half/full time. */
  whistle(long = false): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    const dur = long ? 0.75 : 0.32;
    const osc = ctx.createOscillator();
    osc.type = 'square';
    osc.frequency.value = 2280;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 34;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 190;
    lfo.connect(lfoGain).connect(osc.frequency);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.exponentialRampToValueAtTime(0.12, this.t + 0.03);
    g.gain.setValueAtTime(0.12, this.t + dur - 0.08);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    osc.connect(g).connect(this.master);
    osc.start();
    lfo.start();
    osc.stop(this.t + dur);
    lfo.stop(this.t + dur);
  }

  /** Goal: crowd cheer swell + short fanfare. */
  goal(): void {
    if (!this.ctx || !this.master || this.muted) return;
    const ctx = this.ctx;
    // cheer swell (band-passed noise)
    const dur = 1.5;
    const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * dur), ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = 'bandpass';
    filt.frequency.value = 950;
    filt.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, this.t);
    g.gain.exponentialRampToValueAtTime(0.22, this.t + 0.18);
    g.gain.exponentialRampToValueAtTime(0.0001, this.t + dur);
    src.connect(filt).connect(g).connect(this.master);
    src.start();
    // fanfare arpeggio
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f;
      const og = ctx.createGain();
      const start = this.t + i * 0.09;
      og.gain.setValueAtTime(0.0001, start);
      og.gain.exponentialRampToValueAtTime(0.16, start + 0.02);
      og.gain.exponentialRampToValueAtTime(0.0001, start + 0.22);
      o.connect(og).connect(this.master!);
      o.start(start);
      o.stop(start + 0.24);
    });
  }
}

export const sfx = new Sfx();
