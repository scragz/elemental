// ELEMENTAL — wavetable-scanning voice (design spec §9)
//
// One voice = one contact point. It reads BOTH rings of the pair (tableA / tableB)
// at their respective contact angles (scanA / scanB) and sounds both registers
// together (freqA / freqB). §4.2.
//
// "Wavetable scan" here: the baked single-cycle table is scrubbed by a moving read
// head. A short slice (SCAN_WIN) around the scan position is looped at the pitch,
// Hann-windowed so the loop is click-free. Two phasors offset by half a period sum
// to unity gain (two 50%-overlap Hann windows = 1), giving a steady tone whose
// timbre morphs as the contact sweeps. §9.

const WIN = 1024;
const TWO_PI = Math.PI * 2;

class ElementalVoice extends AudioWorkletProcessor {
  static get parameterDescriptors() {
    return [
      { name: 'scanA', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'scanB', defaultValue: 0, minValue: 0, maxValue: 1, automationRate: 'a-rate' },
      { name: 'freqA', defaultValue: 220, automationRate: 'k-rate' },
      { name: 'freqB', defaultValue: 220, automationRate: 'k-rate' },
      { name: 'jitter', defaultValue: 0, automationRate: 'k-rate' }, // fire detune (cents-ish)
      { name: 'mix',   defaultValue: 1, automationRate: 'k-rate' },  // 0 → only ring A
    ];
  }

  constructor() {
    super();
    this.tableA = new Float32Array(2048);
    this.tableB = new Float32Array(2048);
    this.phaseA = [0, 0.5];
    this.phaseB = [0, 0.5];
    this.port.onmessage = (e) => {
      const d = e.data;
      if (d.tableA) this.tableA = d.tableA;
      if (d.tableB) this.tableB = d.tableB;
    };
  }

  slice(table, scanNorm, phase, freq, jitter) {
    const len = table.length;
    let step = freq / sampleRate;
    if (jitter > 0) step *= 1 + (Math.random() - 0.5) * jitter * 0.02;
    const center = scanNorm * len;
    let out = 0;
    for (let k = 0; k < 2; k++) {
      let ph = phase[k];
      const w = 0.5 - 0.5 * Math.cos(TWO_PI * ph); // Hann over the slice
      let idx = center + ph * WIN;
      idx -= len * Math.floor(idx / len);
      const i0 = idx | 0;
      const f = idx - i0;
      const i1 = i0 + 1 >= len ? 0 : i0 + 1;
      out += w * (table[i0] * (1 - f) + table[i1] * f);
      ph += step;
      if (ph >= 1) ph -= 1;
      phase[k] = ph;
    }
    return out;
  }

  process(inputs, outputs, params) {
    const ch = outputs[0][0];
    const n = ch.length;
    const scanA = params.scanA;
    const scanB = params.scanB;
    const freqA = params.freqA[0];
    const freqB = params.freqB[0];
    const jitter = params.jitter[0];
    const mix = params.mix[0];
    const dual = mix > 0.001;
    const norm = dual ? 0.5 : 0.75;
    for (let s = 0; s < n; s++) {
      const scA = scanA.length > 1 ? scanA[s] : scanA[0];
      let v = this.slice(this.tableA, scA, this.phaseA, freqA, jitter);
      if (dual) {
        const scB = scanB.length > 1 ? scanB[s] : scanB[0];
        v += mix * this.slice(this.tableB, scB, this.phaseB, freqB, jitter);
      }
      ch[s] = v * norm;
    }
    return true;
  }
}

registerProcessor('elemental-voice', ElementalVoice);
