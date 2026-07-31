// ELEMENTAL — FX pinch. Two fingers control the effects as a 2D "zoom":
//   spread/pinch horizontally → reverb   (finger gap on X)
//   spread/pinch vertically   → delay     (finger gap on Y)
// A crosshair at the midpoint shows both values. Single-finger touches still cast
// spells; only a second finger enters FX mode.
import { env } from './env.js';
import { clamp01 } from './util.js';

export class Fx {
  constructor(audio) {
    this.audio = audio;
    this.reverb = 0.4; // matches the audio node defaults on init
    this.delay = 0.0;
    this.active = false;
    this.p0 = null; // live positions of the two pinch fingers
    this.p1 = null;
    this.baseSpreadX = 0;
    this.baseSpreadY = 0;
    this.baseReverb = 0;
    this.baseDelay = 0;
    this.glow = 0; // fades the indicator out after release
  }

  // Change in finger spread needed to sweep a parameter across its whole range.
  _scale() {
    return Math.min(env.w, env.h) * 0.5;
  }

  begin(a, b) {
    this.active = true;
    this.p0 = { x: a.x, y: a.y };
    this.p1 = { x: b.x, y: b.y };
    this.baseSpreadX = Math.abs(a.x - b.x);
    this.baseSpreadY = Math.abs(a.y - b.y);
    this.baseReverb = this.reverb;
    this.baseDelay = this.delay;
    this.glow = 1;
  }

  update(a, b) {
    if (!this.active) return;
    this.p0 = { x: a.x, y: a.y };
    this.p1 = { x: b.x, y: b.y };
    const s = this._scale();
    this.reverb = clamp01(this.baseReverb + (Math.abs(a.x - b.x) - this.baseSpreadX) / s);
    this.delay = clamp01(this.baseDelay + (Math.abs(a.y - b.y) - this.baseSpreadY) / s);
    this.audio.setReverb(this.reverb);
    this.audio.setDelay(this.delay);
    this.glow = 1;
  }

  end() {
    this.active = false;
  }

  // Push current values to audio once it's ready (call after unlock).
  apply() {
    this.audio.setReverb(this.reverb);
    this.audio.setDelay(this.delay);
  }

  tick(dt) {
    if (!this.active) this.glow = Math.max(0, this.glow - dt * 2);
  }
}
