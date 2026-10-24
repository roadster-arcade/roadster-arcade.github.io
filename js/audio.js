// Synthesised sound: nothing is loaded from files, so the game also works
// offline. Browsers only allow audio after a key press or click, so call
// start() from an input handler.
'use strict';

class Sound {
  constructor() {
    this.ctx = null;
    this.muted = false;
  }

  start() {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.8;
      this.master.connect(ctx.destination);

      // Two seconds of white noise, reused by every gas and crash sound.
      const len = ctx.sampleRate * 2;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const data = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;

      // Continuous nitrogen hiss, faded in and out with thrust. A soft band
      // of air with the sharp top end rolled off, so it stays smooth.
      const hiss = ctx.createBufferSource();
      hiss.buffer = this.noise;
      hiss.loop = true;
      this.hissFilter = ctx.createBiquadFilter();
      this.hissFilter.type = 'bandpass';
      this.hissFilter.frequency.value = 1100;
      this.hissFilter.Q.value = 0.5;
      const hissHigh = ctx.createBiquadFilter();
      hissHigh.type = 'highpass';
      hissHigh.frequency.value = 300;
      const hissTop = ctx.createBiquadFilter();
      hissTop.type = 'lowpass';
      hissTop.frequency.value = 2600;
      this.hissGain = ctx.createGain();
      this.hissGain.gain.value = 0;
      hiss.connect(this.hissFilter).connect(hissHigh).connect(hissTop).connect(this.hissGain).connect(this.master);
      hiss.start();

      // Electric drivetrain: a smooth motor whine (fundamental plus a
      // harmonic), a faint high inverter shimmer, and a little vibrato so it
      // feels alive. All of it rises with speed.
      this.motorGain = ctx.createGain();
      this.motorGain.gain.value = 0;
      const motorTone = ctx.createBiquadFilter();
      motorTone.type = 'lowpass';
      motorTone.frequency.value = 2400;
      motorTone.Q.value = 0.7;
      motorTone.connect(this.motorGain).connect(this.master);
      const vibrato = ctx.createOscillator();
      vibrato.frequency.value = 5.5;
      const vibratoDepth = ctx.createGain();
      vibratoDepth.gain.value = 3;
      vibrato.connect(vibratoDepth);
      vibrato.start();
      this.motorOscs = [
        {type: 'triangle', ratio: 1, gain: 1},
        {type: 'sine', ratio: 2.01, gain: 0.45},
        {type: 'sine', ratio: 3.98, gain: 0.12},
      ].map(({type, ratio, gain}) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = 180 * ratio;
        vibratoDepth.connect(o.detune);
        const g = ctx.createGain();
        g.gain.value = gain;
        o.connect(g).connect(motorTone);
        o.start();
        return {o, ratio};
      });
      // Tyres on the road: soft low noise that swells with speed.
      const road = ctx.createBufferSource();
      road.buffer = this.noise;
      road.loop = true;
      this.roadFilter = ctx.createBiquadFilter();
      this.roadFilter.type = 'lowpass';
      this.roadFilter.frequency.value = 500;
      this.roadGain = ctx.createGain();
      this.roadGain.gain.value = 0;
      road.connect(this.roadFilter).connect(this.roadGain).connect(this.master);
      road.start(0, 0.7);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
  }

  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.8, this.ctx.currentTime, 0.02);
    return this.muted;
  }

  /** level 0..1: how hard the thrusters are firing. Fades in gently. */
  setThrust(level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.hissGain.gain.setTargetAtTime(level * 0.075, t, 0.06);
    this.hissFilter.frequency.setTargetAtTime(700 + level * 1100, t, 0.08);
  }

  /**
   * speed01: 0 at start speed, 1 at top speed, up to about 2 while boosting.
   * on false silences the motor.
   */
  setMotor(speed01, on) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 170 + speed01 * 300;
    for (const {o, ratio} of this.motorOscs) o.frequency.setTargetAtTime(f * ratio, t, 0.25);
    this.motorGain.gain.setTargetAtTime(on ? 0.028 + Math.min(speed01, 1.5) * 0.016 : 0, t, 0.2);
    this.roadFilter.frequency.setTargetAtTime(380 + speed01 * 420, t, 0.3);
    this.roadGain.gain.setTargetAtTime(on ? 0.035 + Math.min(speed01, 1.5) * 0.03 : 0, t, 0.3);
  }

  /** Short filtered-noise burst: a thruster kick or an impact. */
  burst(duration, freq, gain, type = 'bandpass') {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(freq * 0.4, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.master);
    src.start(t, Math.random());
    src.stop(t + duration + 0.05);
  }

  tone(freq, duration, gain, type = 'square', endFreq = freq, delay = 0) {
    if (!this.ctx) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const osc = ctx.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    osc.frequency.exponentialRampToValueAtTime(endFreq, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(g).connect(this.master);
    osc.start(t);
    osc.stop(t + duration + 0.05);
  }

  jump() {
    this.burst(0.4, 1600, 0.12);
    this.tone(110, 0.18, 0.05, 'sine', 60);
  }

  boost() {
    this.burst(0.55, 1900, 0.16);
    this.tone(140, 0.25, 0.06, 'sine', 55);
  }

  land(strength) {
    this.tone(90, 0.12, 0.05 + strength * 0.07, 'sine', 45);
    this.burst(0.12, 700, 0.03 + strength * 0.05, 'lowpass');
  }

  roof() {
    this.tone(660, 0.07, 0.05);
    this.tone(990, 0.1, 0.05, 'square', 990, 0.07);
  }

  /** Boost unlocked: a bright rising arpeggio. */
  boostReady() {
    [523, 659, 784, 1047].forEach((f, i) => this.tone(f, 0.1, 0.04, 'square', f, i * 0.07));
  }

  /** Boost fired: a long, soft rush with a gentle rising tone. */
  superBoost() {
    this.burst(1.2, 2000, 0.2);
    this.burst(0.8, 700, 0.14, 'lowpass');
    this.tone(90, 0.9, 0.06, 'sine', 240);
  }

  /** A flip completes mid-air: a rising whoosh, higher for each extra flip. */
  trick(count) {
    this.burst(0.25, 1500 + count * 300, 0.06);
    this.tone(440 * count, 0.12, 0.04, 'square', 880 * count);
  }

  trickLanded() {
    this.tone(784, 0.08, 0.05);
    this.tone(1175, 0.16, 0.05, 'square', 1175, 0.08);
  }

  /** Flip points arriving in the score. */
  bank() {
    this.tone(1319, 0.06, 0.04);
    this.tone(1760, 0.06, 0.04, 'square', 1760, 0.06);
    this.tone(2637, 0.18, 0.035, 'square', 2637, 0.12);
  }

  score() {
    this.tone(1046, 0.08, 0.04);
    this.tone(1568, 0.14, 0.04, 'square', 1568, 0.09);
  }

  crash() {
    this.burst(1.2, 1600, 0.5, 'lowpass');
    this.burst(0.6, 4000, 0.25);
    this.tone(160, 0.6, 0.25, 'sawtooth', 40);
  }

  click() {
    this.tone(880, 0.05, 0.04);
  }
}
