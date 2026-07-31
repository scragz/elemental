// ELEMENTAL — audio architecture (design spec §9)
//
//                           ┌─► dry ──────────────┐
//   voice ─► filter ─► pan ─┤                     ├─► bus ─► compressor ─► out
//                           └─► convolver ─► send ┘
//
// Voice pool of windowed wavetable scanners (see voice-worklet.js). Pairs allocate
// up to two voices (one per contact point) on activation, freed on separation.
import { MAX_PAIRS, ELEMENTS } from './config.js';
import { clamp } from './util.js';

const POOL_SIZE = MAX_PAIRS * 2;

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.ready = false;
    this.voices = [];
    this.freeVoices = [];
  }

  async init() {
    if (this.ctx) return;
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.ctx = ctx;
    this.workletOk = false;
    this.initError = null;

    // Master chain.
    // Safety limiter only — FIELD does the real gain-riding (§9).
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -10;
    this.compressor.ratio.value = 6;
    this.compressor.attack.value = 0.005;
    this.compressor.release.value = 0.2;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;

    // Voicing chain for small speakers: drop sub-audible bass that only wastes
    // headroom, and lift presence in the band phones actually reproduce.
    this.highpass = ctx.createBiquadFilter();
    this.highpass.type = 'highpass';
    this.highpass.frequency.value = 150;
    this.highpass.Q.value = 0.7;

    this.presence = ctx.createBiquadFilter();
    this.presence.type = 'peaking';
    this.presence.frequency.value = 1600;
    this.presence.Q.value = 0.8;
    this.presence.gain.value = 5;

    this.master.connect(this.highpass);
    this.highpass.connect(this.presence);
    this.presence.connect(this.compressor);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);

    // Convolver reverb: generated noise IR, ~2.6s exponential decay (§9). Its
    // return level is player-controlled by the FX orb (swipe left/right).
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeIR(ctx, 2.6);
    this.reverbReturn = ctx.createGain();
    this.reverbReturn.gain.value = 0.5;
    this.convolver.connect(this.reverbReturn);
    this.reverbReturn.connect(this.bus);

    // Feedback delay, tapped off the bus, returning into the master gain (parallel
    // wet path). Return level + feedback are player-controlled (swipe up/down).
    this.delaySend = ctx.createGain();
    this.delaySend.gain.value = 0.5;
    this.delay = ctx.createDelay(1.0);
    this.delay.delayTime.value = 0.34;
    this.delayFeedback = ctx.createGain();
    this.delayFeedback.gain.value = 0.0;
    this.delayReturn = ctx.createGain();
    this.delayReturn.gain.value = 0.0;
    this.bus.connect(this.delaySend);
    this.delaySend.connect(this.delay);
    this.delay.connect(this.delayFeedback);
    this.delayFeedback.connect(this.delay); // repeats
    this.delay.connect(this.delayReturn);
    this.delayReturn.connect(this.master);

    // Load the AudioWorklet and build the voice pool. If this fails (some mobile
    // browsers), plops still work via the master chain above; collisions fall back
    // to standard oscillator voices (see _makeVoice).
    try {
      if (/[?&]noworklet\b/.test(location.search)) throw new Error('forced off (?noworklet)');
      if (!ctx.audioWorklet) throw new Error('AudioWorklet unsupported');
      const url = new URL('./voice-worklet.js', import.meta.url);
      await ctx.audioWorklet.addModule(url);
      this.workletOk = true;
    } catch (e) {
      this.workletOk = false;
      this.initError = String(e && e.message ? e.message : e);
    }

    // Pre-allocate the voice pool (worklet-backed if available, else oscillator).
    for (let i = 0; i < POOL_SIZE; i++) {
      this.voices.push(this._makeVoice());
    }
    this.freeVoices = this.voices.slice();

    this.ready = true;
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
  }

  _makeVoice() {
    const ctx = this.ctx;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    const send = ctx.createGain();
    send.gain.value = 0.35;

    filter.connect(gain).connect(panner);
    panner.connect(this.bus);        // dry
    panner.connect(send);
    send.connect(this.convolver);    // wet

    const voice = { filter, gain, panner, send, busy: false, key: null, tableKey: null };

    if (this.workletOk) {
      const node = new AudioWorkletNode(ctx, 'elemental-voice', {
        numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      });
      node.connect(filter);
      const P = node.parameters;
      voice.kind = 'worklet';
      voice.node = node;
      voice.params = {
        scanA: P.get('scanA'), scanB: P.get('scanB'),
        freqA: P.get('freqA'), freqB: P.get('freqB'),
        jitter: P.get('jitter'),
      };
    } else {
      // Oscillator fallback (no worklet): two PeriodicWave oscillators, one per ring,
      // summed. The scan position sweeps the lowpass for movement instead of the
      // windowed table scan. Universally supported (iOS Safari, etc.).
      const oscA = ctx.createOscillator();
      const oscB = ctx.createOscillator();
      const mix = ctx.createGain();
      mix.gain.value = 1.5; // match the worklet path's loudness
      oscA.frequency.value = 220;
      oscB.frequency.value = 220;
      oscA.connect(mix);
      oscB.connect(mix);
      mix.connect(filter);
      oscA.start();
      oscB.start();
      voice.kind = 'osc';
      voice.oscA = oscA;
      voice.oscB = oscB;
    }
    return voice;
  }

  // Build (and cache) a PeriodicWave from a baked single-cycle wavetable via DFT.
  _periodicWave(wave) {
    if (!this._pwCache) this._pwCache = new WeakMap();
    let pw = this._pwCache.get(wave);
    if (pw) return pw;
    const M = wave.length;
    const H = 128; // harmonics
    const real = new Float32Array(H + 1);
    const imag = new Float32Array(H + 1);
    for (let k = 1; k <= H; k++) {
      let re = 0, im = 0;
      const w = (2 * Math.PI * k) / M;
      for (let i = 0; i < M; i++) {
        re += wave[i] * Math.cos(w * i);
        im -= wave[i] * Math.sin(w * i);
      }
      real[k] = (2 / M) * re;
      imag[k] = (2 / M) * im;
    }
    pw = this.ctx.createPeriodicWave(real, imag, { disableNormalization: false });
    this._pwCache.set(wave, pw);
    return pw;
  }

  alloc() {
    return this.freeVoices.pop() || null;
  }

  free(voice) {
    if (!voice || !voice.busy) return;
    voice.busy = false;
    voice.key = null;
    const t = this.ctx.currentTime;
    voice.gain.gain.cancelScheduledValues(t);
    voice.gain.gain.setTargetAtTime(0, t, 0.05);
    this.freeVoices.push(voice);
  }

  // Load a pair's two wavetables into a voice. `key` identifies the ring pair so we
  // skip the work when the same voice keeps the same pair.
  setTables(voice, waveA, waveB, key) {
    if (voice.tableKey === key) return;
    voice.tableKey = key;
    if (voice.kind === 'worklet') {
      voice.node.port.postMessage({ tableA: waveA, tableB: waveB }); // clone copies them
    } else {
      voice.oscA.setPeriodicWave(this._periodicWave(waveA));
      voice.oscB.setPeriodicWave(this._periodicWave(waveB));
    }
  }

  // Update a voice each frame from live contact geometry.
  updateVoice(voice, p) {
    const t = this.ctx.currentTime;
    const glide = p.water ? 0.04 : 0.008; // water slews scan position (§9)

    if (voice.kind === 'worklet') {
      const pm = voice.params;
      pm.scanA.setTargetAtTime(p.scanA, t, glide);
      pm.scanB.setTargetAtTime(p.scanB, t, glide);
      pm.freqA.setTargetAtTime(p.freqA, t, 0.02);
      pm.freqB.setTargetAtTime(p.freqB, t, 0.02);
      pm.jitter.value = p.jitter;
      // Lowpass tracks amplitude/energy — louder contacts open up (§9). Kept fairly
      // open so voices don't get muffled into inaudibility on small speakers.
      const cutoff = clamp(1200 + p.amp * 6000 + p.brightness * 4000, 600, 15000);
      voice.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
    } else {
      voice.oscA.frequency.setTargetAtTime(p.freqA, t, 0.02);
      voice.oscB.frequency.setTargetAtTime(p.freqB, t, glide);
      if (p.jitter) voice.oscA.detune.setTargetAtTime((Math.random() - 0.5) * 30, t, 0.03);
      // The scan position sweeps the filter, giving the contact audible movement.
      const cutoff = clamp(700 + p.scanA * 3500 + p.amp * 5000 + p.brightness * 3000, 500, 15000);
      voice.filter.frequency.setTargetAtTime(cutoff, t, glide);
    }

    voice.gain.gain.setTargetAtTime(p.amp, t, 0.03);
    voice.panner.pan.setTargetAtTime(p.pan, t, 0.03);
  }

  // Master amplitude tracks FIELD (§5) but with a high floor so the instrument never
  // drains to silence — FIELD still rides the visible luminance for the readout.
  setField(level) {
    if (!this.ctx) return;
    const g = (0.6 + 0.4 * Math.pow(level, 0.7)) * 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.1);
  }

  // FX orb: reverb return level (0..1) and delay wet + feedback (0..1).
  setReverb(v) {
    if (!this.ctx) return;
    this.reverbReturn.gain.setTargetAtTime(1.3 * v, this.ctx.currentTime, 0.05);
  }
  setDelay(v) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.delayReturn.gain.setTargetAtTime(0.9 * v, t, 0.05);
    this.delayFeedback.gain.setTargetAtTime(Math.min(0.6, 0.62 * v), t, 0.05);
  }

  // Very quiet, tight tick on every pointerdown — a short high click, not a snare.
  tick(panValue = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const dur = 0.008; // very short → a click, not a burst
    const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) {
      const decay = Math.pow(1 - i / d.length, 3); // fast decay
      d[i] = (Math.random() * 2 - 1) * decay;
    }
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3600; // higher → reads as a tick
    bp.Q.value = 1.2;
    const g = ctx.createGain();
    g.gain.value = 0.04; // way quieter
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(panValue, -1, 1);
    src.connect(bp).connect(g).connect(panner);
    panner.connect(this.bus); // dry only — keep the tick crisp
    src.start(t);
    src.stop(t + dur);
  }

  // Element confirmation on commit — a distinct short voice per element (§4.1
  // register + character), so choosing air/fire/water/earth sounds different.
  elementSound(element, fundamental, panValue = 0) {
    if (!this.ready || !element) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = fundamental * ELEMENTS[element].octave;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    const g = ctx.createGain();
    let dur = 0.22, peak = 0.16;

    if (element === 'air') {
      osc.type = 'sine';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 1.5, t + 0.14); // rises, escapes
      lp.frequency.value = 9000; dur = 0.18; peak = 0.13;
    } else if (element === 'fire') {
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(base, t);
      osc.detune.setValueAtTime(0, t);
      osc.detune.linearRampToValueAtTime(28, t + 0.2); // unstable
      lp.frequency.value = 4800; dur = 0.22; peak = 0.15;
    } else if (element === 'water') {
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base * 0.72, t);
      osc.frequency.exponentialRampToValueAtTime(base, t + 0.18); // glides up
      lp.frequency.value = 3400; dur = 0.30; peak = 0.16;
    } else { // earth
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(base, t);
      osc.frequency.exponentialRampToValueAtTime(base * 0.9, t + 0.2); // settles low
      lp.frequency.value = 2200; dur = 0.36; peak = 0.2;
    }

    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(panValue, -1, 1);
    osc.connect(lp).connect(g).connect(panner);
    panner.connect(this.bus);
    panner.connect(this.convolver);
    osc.start(t);
    osc.stop(t + dur + 0.02);
  }

  // Soft "let go" on release/cast — a quiet upward blip an octave up.
  releaseSound(element, fundamental, panValue = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const base = fundamental * ELEMENTS[element || 'null'].octave;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(base * 2, t);
    osc.frequency.exponentialRampToValueAtTime(base * 2.6, t + 0.12);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.07, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(panValue, -1, 1);
    osc.connect(g).connect(panner);
    panner.connect(this.bus);
    panner.connect(this.convolver);
    osc.start(t);
    osc.stop(t + 0.22);
  }
}

// Exponentially-decaying stereo noise impulse response.
function makeIR(ctx, seconds) {
  const rate = ctx.sampleRate;
  const len = Math.floor(rate * seconds);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = 0; i < len; i++) {
      const decay = Math.pow(1 - i / len, 3);
      d[i] = (Math.random() * 2 - 1) * decay;
    }
  }
  return buf;
}
