// ELEMENTAL — self-playing intro demo. Drives the real engine with scripted
// "ghost" gestures: draws a spell, draws another, they expand and collide. Purely
// visual until the first user tap unlocks audio (browser autoplay policy).
import { Gesture } from './gesture.js';
import { Ring } from './ring.js';
import { MAX_RINGS } from './config.js';
import { env } from './env.js';

let ghostId = -1000;

// One scripted cast: creates a ghost gesture, drives its pointer along a commit
// stroke + flourish, then bakes and casts a ring — exactly like a real gesture.
class Cast {
  constructor(demo, spec) {
    this.demo = demo;
    this.spec = spec;
    this.id = ghostId--;
    this.started = false;
    this.released = false;
    this.committed = false;
    this.baseAng = Math.random() * Math.PI * 2;
  }

  _point(u) {
    const s = this.spec;
    if (u < 0.14) {
      // commit stroke: straight push in the element direction past the threshold.
      const d = (u / 0.14) * 46;
      return { x: s.ox + s.cvx * d, y: s.oy + s.cvy * d };
    }
    // flourish: a growing, wobbling spiral around the commit point.
    const cx = s.ox + s.cvx * 40;
    const cy = s.oy + s.cvy * 40;
    const a = (u - 0.14) / 0.86;
    const ang = this.baseAng + a * Math.PI * 3;
    const rad = env.maxRadius * (0.08 + 0.16 * a) * (0.7 + 0.3 * Math.sin(a * 6));
    return { x: cx + Math.cos(ang) * rad, y: cy + Math.sin(ang) * rad };
  }

  update(u, now) {
    const s = this.spec;
    if (!this.started) {
      this.started = true;
      this.gesture = new Gesture(s.ox, s.oy, now);
      this.gesture.demo = true;
      this.demo.gestures.set(this.id, this.gesture);
    }
    const p = this._point(Math.min(u, 1));
    const justCommitted = this.gesture.moveTo(p.x, p.y, now);
    if (justCommitted && !this.committed) {
      this.committed = true;
      const pan = (p.x / env.w) * 2 - 1;
      this.demo.audio.elementSound(this.gesture.element, this.demo.tuning.fundamental, pan);
    }
  }

  release() {
    if (this.released || !this.started) return;
    this.released = true;
    const g = this.gesture;
    const baked = g.bake();
    if (this.demo.rings.length >= MAX_RINGS) this.demo.rings.shift();
    this.demo.rings.push(new Ring(baked, g.speed, 1.0));
    this.demo.gestures.delete(this.id);
    const pan = ((g.commitX ?? g.originX) / env.w) * 2 - 1;
    this.demo.audio.releaseSound(g.element, this.demo.tuning.fundamental, pan);
  }

  cancel() {
    if (this.started && !this.released) this.demo.gestures.delete(this.id);
    this.released = true;
  }
}

export class Demo {
  constructor({ gestures, rings, tuning, audio, interaction, splash }) {
    this.gestures = gestures;
    this.rings = rings;
    this.tuning = tuning;
    this.audio = audio;
    this.interaction = interaction;
    this.splash = splash;
    this.stopped = false;
    this.t = 0;
    this._build();
  }

  _build() {
    const W = env.w, H = env.h;
    // Two water spells (drag left) — same speed, cast close in time, so their
    // rings track each other and actually meet in a sustained, audible collision
    // (the like-to-like centrepiece). Centres ~0.32·W apart so boundaries cross.
    this.casts = [
      new Cast(this, { at: 0.5, dur: 1.3, ox: W * 0.34, oy: H * 0.47, cvx: -1, cvy: 0 }),
      new Cast(this, { at: 1.5, dur: 1.3, ox: W * 0.66, oy: H * 0.53, cvx: -1, cvy: 0 }),
    ];
    this.textSwapAt = 3.8;
    this.loopAt = 11;
    this.textSwapped = false;
  }

  update(dt) {
    if (this.stopped) return;
    this.t += dt;
    const now = performance.now() / 1000;

    for (const c of this.casts) {
      const u = (this.t - c.spec.at) / c.spec.dur;
      if (u >= 0 && u < 1) c.update(u, now);
      else if (u >= 1 && !c.released) c.release();
    }

    // Swap to the how-to once the spells have had a chance to meet (or on collision).
    if (!this.textSwapped && (this.t >= this.textSwapAt || this.interaction.count > 0)) {
      this.textSwapped = true;
      this.splash.showInstructions();
    }

    // Loop the visual demo so the screen stays alive while they read.
    if (this.t >= this.loopAt) {
      this.t = 0;
      this._build();
      this.textSwapped = true; // keep the how-to text after the first pass
    }
  }

  // First real interaction: drop any ghost gesture in progress and stop.
  stop() {
    if (this.stopped) return;
    this.stopped = true;
    for (const c of this.casts) c.cancel();
  }
}
