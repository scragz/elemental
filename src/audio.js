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

    // Cache AudioParam refs so the per-frame update path does no Map lookups.
    const P = node.parameters;
    const params = {
      scanA: P.get('scanA'), scanB: P.get('scanB'),
      freqA: P.get('freqA'), freqB: P.get('freqB'),
      jitter: P.get('jitter'),
    };
    return { node, filter, gain, panner, send, params, busy: false, key: null, tableKey: null };
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
  // skip the (structured-clone) postMessage when the same voice keeps the same pair.
  setTables(voice, waveA, waveB, key) {
    if (voice.tableKey === key) return;
    voice.tableKey = key;
    voice.node.port.postMessage({ tableA: waveA, tableB: waveB }); // clone copies them
  }

  // Update a voice each frame from live contact geometry.
  updateVoice(voice, p) {
    const t = this.ctx.currentTime;
    const glide = p.water ? 0.04 : 0.008; // water slews scan position (§9)
    const pm = voice.params;
    pm.scanA.setTargetAtTime(p.scanA, t, glide);
    pm.scanB.setTargetAtTime(p.scanB, t, glide);
    pm.freqA.setTargetAtTime(p.freqA, t, 0.02);
    pm.freqB.setTargetAtTime(p.freqB, t, 0.02);
    pm.jitter.value = p.jitter;

    voice.gain.gain.setTargetAtTime(p.amp, t, 0.03);
    voice.panner.pan.setTargetAtTime(p.pan, t, 0.03);
    // Lowpass tracks amplitude/energy — louder contacts open up (§9). Kept fairly
    // open so voices don't get muffled into inaudibility on small speakers.
    const cutoff = clamp(1200 + p.amp * 6000 + p.brightness * 4000, 600, 15000);
    voice.filter.frequency.setTargetAtTime(cutoff, t, 0.03);
  }

  // Master amplitude = FIELD^0.7 (§5), with a small floor so an exhausted field
  // reads as "hushed" rather than fully dead (voices still fade via their own amp).
  setField(level) {
    if (!this.ctx) return;
    const g = (0.12 + 0.88 * Math.pow(level, 0.7)) * 0.9;
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
    // exponentialRamp can't target 0, and a drained field makes 0.25·level → 0.
    const amp = Math.max(0.0002, 0.25 * level);
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
