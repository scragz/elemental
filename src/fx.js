// ELEMENTAL — FX orb. A small control in the bottom-right corner: drag it as an
// XY pad — left/right sets reverb, up/down sets delay. Purely a control; it does
// not cast spells.
import { env } from './env.js';
import { clamp01 } from './util.js';

export class Fx {
  constructor(audio) {
    this.audio = audio;
    this.reverb = 0.4; // matches the audio node defaults on init
    this.delay = 0.0;
    this.dragId = null; // pointerId currently controlling the orb
    this.startX = 0;
    this.startY = 0;
    this.startReverb = 0;
    this.startDelay = 0;
    this.glow = 0; // 0..1 activity glow for rendering
  }

  // Orb geometry — inset from the corner (and clear of the phone's bottom home
  // indicator) so it's comfortable to reach without hugging the edge.
  orb() {
    const r = Math.max(24, Math.min(36, Math.min(env.w, env.h) * 0.055));
    const mx = 46;
    const my = 60;
    return { x: env.w - r - mx, y: env.h - r - my, r };
  }

  hitTest(x, y) {
    const o = this.orb();
    // Generous hit radius so it's easy to grab with a thumb.
    return Math.hypot(x - o.x, y - o.y) <= o.r + 26;
  }

  begin(id, x, y) {
    this.dragId = id;
    this.startX = x;
    this.startY = y;
    this.startReverb = this.reverb;
    this.startDelay = this.delay;
    this.glow = 1;
  }

  // Move the control; full range spans ~55% of the screen in each axis.
  drag(x, y) {
    const spanX = env.w * 0.55;
    const spanY = env.h * 0.55;
    this.reverb = clamp01(this.startReverb + (x - this.startX) / spanX);
    this.delay = clamp01(this.startDelay + (this.startY - y) / spanY); // up = more
    this.audio.setReverb(this.reverb);
    this.audio.setDelay(this.delay);
  }

  end() {
    this.dragId = null;
  }

  // Push current values to audio once it's ready (call after unlock).
  apply() {
    this.audio.setReverb(this.reverb);
    this.audio.setDelay(this.delay);
  }

  // Decay the activity glow (called per frame with dt).
  tick(dt) {
    if (this.dragId === null) this.glow = Math.max(0, this.glow - dt * 1.5);
  }
}
