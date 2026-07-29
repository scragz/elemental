// ELEMENTAL — tuning (design spec §6)
// A fundamental drifts within a 1.5-octave band, retargeting ~40s. All pitches are
// small-integer ratios off it; element register selects the octave.
import { TUNE_BASE, TUNE_BAND, TUNE_RETARGET, TUNE_SLEW } from './config.js';
import { lerp } from './util.js';

export class Tuning {
  constructor() {
    this.fundamental = TUNE_BASE;
    this.target = TUNE_BASE;
    this.timer = 0;
    this._retarget();
  }

  _retarget() {
    // Random point within the band, geometric so octaves feel even.
    const t = Math.random();
    this.target = TUNE_BASE * Math.pow(TUNE_BAND, t - 0.5);
    this.timer = TUNE_RETARGET * (0.7 + Math.random() * 0.6);
  }

  update(dt) {
    this.timer -= dt;
    if (this.timer <= 0) this._retarget();
    this.fundamental = lerp(this.fundamental, this.target, TUNE_SLEW * dt);
  }
}
