// ELEMENTAL — ring (design spec §4.1). Cast once, expands once, dies once (invariant 3).
import { ELEMENTS, RATIOS, CHARGE_RADIUS, CAST_MULT_MIN, CAST_MULT_MAX, CAST_SPEED_REF } from './config.js';
import { clamp, nextId } from './util.js';

export class Ring {
  // baked: result of Gesture.bake(); releaseSpeed: px/s at pointerup; fieldLevel: 0..1
  constructor(baked, releaseSpeed, fieldLevel) {
    const key = baked.element === null ? 'null' : baked.element;
    const def = ELEMENTS[key];

    this.id = nextId();
    this.element = baked.element; // immutable
    this.def = def;

    this.x = baked.x;
    this.y = baked.y;
    this.r = CHARGE_RADIUS;
    this.phase = baked.phase;
    this.charge = baked.charge;

    // Release velocity → initial expansion multiplier (§1.3). Speed is NOT scaled by
    // charge (§4.1); only lifetime and mass are.
    const t = clamp(releaseSpeed / CAST_SPEED_REF, 0, 1);
    this.mult = CAST_MULT_MIN + (CAST_MULT_MAX - CAST_MULT_MIN) * t;
    this.speed = def.speed * this.mult;

    // Charge scales lifetime and mass; FIELD scales lifetime × (0.4 + 0.6·FIELD) (§5).
    this.mass = 1 + this.charge;
    this.life = def.life * (0.5 + this.charge) * (0.4 + 0.6 * fieldLevel);
    this.born = performance.now() / 1000;
    this.age = 0;
    this.dead = false;

    this.wave = baked.wave;     // Float32Array(2048)
    this.banked = baked.banked; // Float32Array(512)
    this.auth = baked.auth;     // Float32Array(512)
    this.lapsCompleted = baked.lapsCompleted;

    // Stable pitch ratio for this ring (§6).
    this.ratio = RATIOS[Math.floor(Math.random() * RATIOS.length)];
  }

  // Current pitch given the drifting fundamental.
  pitch(fundamental) {
    return fundamental * this.def.octave * this.ratio;
  }

  // banked amplitude sampled at a contact angle (0..2π), phase-aligned to commit dir.
  bankedAt(angle) {
    const n = this.banked.length;
    let a = (angle - this.phase) / (Math.PI * 2);
    a -= Math.floor(a);
    return this.banked[Math.floor(a * n) % n];
  }

  // Contact angle → normalized scan position (0..1) into the wavetable.
  scanAt(angle) {
    let a = (angle - this.phase) / (Math.PI * 2);
    a -= Math.floor(a);
    return a;
  }

  update(dt) {
    this.age += dt;
    this.r += this.speed * dt; // charge buys lifetime/mass, never speed (§4.1)
    if (this.age >= this.life) this.dead = true;
  }

  // 0..1 fade envelope over the ring's life (attack + long release).
  envelope() {
    const a = this.age / this.life;
    const attack = Math.min(1, this.age / 0.15);
    const release = 1 - a * a;
    return Math.max(0, attack * release);
  }
}
