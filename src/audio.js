// ELEMENTAL — audio architecture (design spec §9)
//
//                           ┌─► dry ──────────────┐
//   voice ─► filter ─► pan ─┤                     ├─► bus ─► compressor ─► out
//                           └─► convolver ─► send ┘
//
// Voice pool of windowed wavetable scanners (see voice-worklet.js). Pairs allocate
// up to two voices (one per contact point) on activation, freed on separation.
import { MAX_PAIRS } from './config.js';
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

    const url = new URL('./voice-worklet.js', import.meta.url);
    await ctx.audioWorklet.addModule(url);

    // Master chain.
    this.compressor = ctx.createDynamicsCompressor();
    this.compressor.threshold.value = -14;
    this.compressor.ratio.value = 12;
    this.compressor.attack.value = 0.003;
    this.compressor.release.value = 0.25;
    this.compressor.connect(ctx.destination);

    this.master = ctx.createGain();
    this.master.gain.value = 0.0;
    this.master.connect(this.compressor);

    this.bus = ctx.createGain();
    this.bus.connect(this.master);

    // Convolver: generated noise IR, ~2.6s exponential decay (§9).
    this.convolver = ctx.createConvolver();
    this.convolver.buffer = makeIR(ctx, 2.6);
    this.convolver.connect(this.bus);

    // Pre-allocate the voice pool.
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
    const node = new AudioWorkletNode(ctx, 'elemental-voice', {
      numberOfInputs: 0,
      numberOfOutputs: 1,
      outputChannelCount: [1],
    });
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 2000;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const panner = ctx.createStereoPanner();
    const send = ctx.createGain();
    send.gain.value = 0.35;

    node.connect(filter).connect(gain).connect(panner);
    panner.connect(this.bus);        // dry
    panner.connect(send);
    send.connect(this.convolver);    // wet

    return { node, filter, gain, panner, send, busy: false, key: null };
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

  // Load a pair's two wavetables into a voice.
  setTables(voice, waveA, waveB) {
    voice.node.port.postMessage({ tableA: waveA.slice(), tableB: waveB.slice() });
  }

  // Update a voice each frame from live contact geometry.
  updateVoice(voice, p) {
    const t = this.ctx.currentTime;
    const glide = p.water ? 0.04 : 0.008; // water slews scan position (§9)
    voice.node.parameters.get('scanA').setTargetAtTime(p.scanA, t, glide);
    voice.node.parameters.get('scanB').setTargetAtTime(p.scanB, t, glide);
    voice.node.parameters.get('freqA').setTargetAtTime(p.freqA, t, 0.02);
    voice.node.parameters.get('freqB').setTargetAtTime(p.freqB, t, 0.02);
    voice.node.parameters.get('jitter').value = p.jitter;

    voice.gain.gain.setTargetAtTime(p.amp, t, 0.03);
    voice.panner.pan.setTargetAtTime(p.pan, t, 0.03);
    // Lowpass tracks amplitude/energy — louder contacts open up (§9).
    const cutoff = clamp(500 + p.amp * 5000 + p.brightness * 3000, 200, 12000);
    voice.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
  }

  // Master amplitude = FIELD^0.7 (§5).
  setField(level) {
    if (!this.ctx) return;
    const g = Math.pow(level, 0.7) * 0.9;
    this.master.gain.setTargetAtTime(g, this.ctx.currentTime, 0.1);
  }

  // Plop one-shot: pitch drop f·2.2 → f·0.75 over 120ms (§9).
  plop(freq, panValue, level) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq * 2.2, t);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.75, t + 0.12);
    const g = ctx.createGain();
    const amp = 0.25 * level;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(amp, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    const panner = ctx.createStereoPanner();
    panner.pan.value = clamp(panValue, -1, 1);
    osc.connect(g).connect(panner);
    panner.connect(this.bus);
    panner.connect(this.convolver);
    osc.start(t);
    osc.stop(t + 0.24);
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
