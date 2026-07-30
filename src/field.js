// ELEMENTAL — field economy (design spec §5)
// One shared pool. The plop is expensive, the hold is cheap, stillness refills.
import { FIELD } from './config.js';
import { clamp01 } from './util.js';

export class Field {
  constructor() {
    this.level = 1.0;
  }

  // Deduct the one-shot plop cost (pointerdown).
  plop() {
    this.level = clamp01(this.level - FIELD.plop);
  }

  // Continuous accounting for one frame.
  // state: { pointerDown, moving, normSpeed, collisionCount, collisionIntensity, holdingStill }
  update(dt, s) {
    let d = 0;

    if (s.pointerDown) {
      // Costs apply only while actively playing.
      if (s.moving) d -= FIELD.moveCostPerSec * s.normSpeed * dt;
      if (s.collisionCount > 0) d -= FIELD.voiceCostPerSec * s.collisionIntensity * dt;
      if (s.holdingStill) d += FIELD.refillHold * dt;
    } else {
      // Hands off: ALWAYS refill, even while rings keep colliding. Collisions no
      // longer drain the field once you let go, so it always comes back up (a busy
      // screen just refills a little slower). This is what makes "quiet" temporary.
      d += (s.collisionCount > 0 ? FIELD.refillBusy : FIELD.refillIdle) * dt;
    }

    this.level = clamp01(this.level + d);
  }
}
