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

    if (s.pointerDown && s.moving) {
      d -= FIELD.moveCostPerSec * s.normSpeed * dt;
    }
    if (s.collisionCount > 0) {
      d -= FIELD.voiceCostPerSec * s.collisionIntensity * dt;
    }

    // Refills only when no pointer is down (holding still refills a little).
    if (!s.pointerDown) {
      d += (s.collisionCount > 0 ? FIELD.refillBusy : FIELD.refillIdle) * dt;
    } else if (s.holdingStill) {
      d += FIELD.refillHold * dt;
    }

    this.level = clamp01(this.level + d);
  }
}
