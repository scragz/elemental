// ELEMENTAL — gesture lifecycle + inscription (design spec §1, §2, §3)
//
// One Gesture per active pointer. The write head advances at a FIXED angular rate
// (§2); the hand controls only WHAT is written, not where. Laps stack as harmonic
// partials weighted by agreement with a slow-hand reference (§2.3), then bake into
// a single-cycle wavetable on release (§3).
import {
  SLOTS, MAX_PARTIALS, SPEED_REF, TABLE_SIZE, ANG_RATE,
  COMMIT_TRAVEL, POLES, STILL_SPEED, STILL_FULL,
  CHARGE_RATE_MOVE, CHARGE_RATE_STILL, CHARGE_MAX,
} from './config.js';
import { env } from './env.js';
import { clamp01, clamp, dist } from './util.js';

const TWO_PI = Math.PI * 2;

export class Gesture {
  constructor(x, y, time) {
    this.originX = x;
    this.originY = y;
    this.commitX = null;
    this.commitY = null;
    this.element = null; // null pre-commit; immutable after (invariant 1)
    this.committed = false;

    this.px = x;         // latest pointer position
    this.py = y;
    this.speed = 0;      // px/s
    this.travel = 0;     // cumulative, for the 40px threshold
    this.lastTime = time;

    this.headAngle = 0;  // cumulative write-head angle (rad)
    this.globalSlot = 0; // cumulative slot index across all laps
    this.lapsCompleted = 0;
    this.stillTime = 0;
    this.charge = 0;

    // Per-slot working buffers.
    this.shape = new Float32Array(SLOTS);  // current lap in progress
    this.ref = new Float32Array(SLOTS);    // running reference (slow hand writes this)
    this.banked = new Float32Array(SLOTS); // stillness swell, kept for the ring
    this.auth = new Float32Array(SLOTS);   // write authority / stroke opacity
    this.partials = [];
    for (let i = 0; i <= MAX_PARTIALS; i++) this.partials.push(new Float32Array(SLOTS));

    // Charging visual state.
    this.chargeGlow = 0;
    this.trail = [{ x, y }]; // recent pointer path, for "light up where you go"
  }

  // Pointer moved. Accumulate travel, speed, stillness. Returns true on the frame
  // the gesture commits.
  moveTo(x, y, time) {
    const dt = Math.max(1e-4, time - this.lastTime);
    const dx = x - this.px;
    const dy = y - this.py;
    const step = Math.hypot(dx, dy);
    this.speed = step / dt;
    this.travel += step;
    this.px = x;
    this.py = y;
    this.lastTime = time;

    this.trail.push({ x, y });
    if (this.trail.length > 64) this.trail.shift();

    if (!this.committed && this.travel > COMMIT_TRAVEL) {
      this._commit(x, y);
      return true;
    }
    return false;
  }

  _commit(x, y) {
    // Direction at crossing quantizes to the nearest of four poles (§1.2).
    const dx = x - this.originX;
    const dy = y - this.originY;
    const a = Math.atan2(dy, dx);
    let best = POLES[0];
    let bestD = Infinity;
    for (const p of POLES) {
      let d = Math.abs(a - p.angle);
      d = Math.min(d, TWO_PI - d);
      if (d < bestD) { bestD = d; best = p; }
    }
    this.element = best.element;
    this.phase = best.angle; // groove alignment for like-to-like (§4.3)

    // Origin recenters to the commit point (§1.2).
    this.commitX = x;
    this.commitY = y;
    this.committed = true;
    this.headAngle = 0;
    this.globalSlot = 0;
  }

  // Advance the write head and charge. Called every frame while the pointer is down.
  tick(dt) {
    const still = this.speed < STILL_SPEED;
    if (still) this.stillTime += dt; else this.stillTime = 0;

    // Charge accrues faster when still (§5 / §11.3), capped.
    this.charge = Math.min(
      CHARGE_MAX,
      this.charge + (still ? CHARGE_RATE_STILL : CHARGE_RATE_MOVE) * dt
    );

    // Decay speed toward 0 when no move events arrive, so a held-still pointer
    // reads as still even without pointermove.
    this.speed *= Math.max(0, 1 - dt * 6);

    if (!this.committed) {
      this.chargeGlow = clamp01(this.chargeGlow + dt * 1.5);
      return;
    }
    this._inscribe(dt);
  }

  _inscribe(dt) {
    this.headAngle += ANG_RATE * dt;
    const targetGlobal = Math.floor((this.headAngle / TWO_PI) * SLOTS);

    // Current instantaneous values written to whichever slots we pass.
    const r = dist(this.px, this.py, this.commitX, this.commitY);
    const sampleVal = clamp01(r / env.maxRadius);
    const authVal = 0.05 + 0.55 * (1 - clamp01(this.speed / SPEED_REF));
    const bankVal = 0.3 + 0.7 * clamp01(this.stillTime / STILL_FULL);

    for (let g = this.globalSlot + 1; g <= targetGlobal; g++) {
      const slot = g % SLOTS;
      // A completed lap ends exactly when we roll onto slot 0 of the next lap.
      if (slot === 0) this._finalizeLap(g / SLOTS);
      this.shape[slot] = sampleVal;
      this.auth[slot] = authVal;
      if (bankVal > this.banked[slot]) this.banked[slot] = bankVal;
    }
    this.globalSlot = targetGlobal;
  }

  // Resolve one completed lap into a partial + refine the reference (§2.3, §2.5).
  _finalizeLap(lapNumber) {
    const nu = this.shape;
    const ref = this.ref;
    const store = lapNumber <= MAX_PARTIALS ? this.partials[lapNumber] : null;

    for (let i = 0; i < SLOTS; i++) {
      const auth = this.auth[i];              // per-slot authority (slow → high)
      const err = Math.abs(nu[i] - ref[i]);
      const agree = 1 - err;
      if (store) store[i] = nu[i] * agree * agree; // squared: punish near-misses
      ref[i] = ref[i] * (1 - auth) + nu[i] * auth; // slow hand writes the template
    }
    this.lapsCompleted = lapNumber;
    // Next lap overwrites shape[] fresh; nothing to clear (every slot gets rewritten).
  }

  // Resolve all lap math into a single-cycle wavetable (§3). Returns bake result.
  bake() {
    const wave = new Float32Array(SLOTS);

    if (this.element === null) {
      // Bare plop: a single flat cycle — a plain sine, neutral partner (§1.4).
      for (let i = 0; i < SLOTS; i++) wave[i] = Math.sin((i / SLOTS) * TWO_PI);
    } else {
      const laps = Math.min(this.lapsCompleted, MAX_PARTIALS);
      if (laps === 0) {
        // Committed but released before the first full lap. The fractional lap only
        // wrote to ref (§2.5); fall back to the in-progress shape as the fundamental
        // so the ring still speaks. Hold the last written value across the unwritten
        // tail; the DC offset is removed in normalize(), leaving a real AC waveform.
        let last = 0;
        const written = this.globalSlot % SLOTS;
        for (let i = 0; i < SLOTS; i++) {
          if (i <= written) last = this.shape[i];
          wave[i] = last;
        }
      } else {
        // Tile lap L's shape L times → Lth harmonic, with 1/L rolloff (§3).
        for (let L = 1; L <= laps; L++) {
          const p = this.partials[L];
          for (let i = 0; i < SLOTS; i++) {
            wave[i] += p[(i * L) % SLOTS] / L;
          }
        }
      }
    }

    normalize(wave);
    const table = resample(wave, TABLE_SIZE);

    return {
      element: this.element,
      wave: table,
      banked: this.banked.slice(),
      auth: this.auth.slice(),
      phase: this.committed ? this.phase : 0,
      charge: this.charge,
      lapsCompleted: this.lapsCompleted,
      x: this.commitX ?? this.originX,
      y: this.commitY ?? this.originY,
    };
  }
}

// Remove DC (the shape channel is unipolar, so every raw wave has a large mean),
// then normalize to a target RMS rather than to unit peak. RMS normalization gives
// every ring a consistent loudness regardless of how peaky or gentle the gesture's
// distance variation was — a soft, smooth gesture shouldn't come out near-silent.
// (Without the DC removal a wavetable oscillator outputs mostly an inaudible
// constant; without RMS normalization, low-variation waves stay too quiet.)
const TARGET_RMS = 0.6;
function normalize(a) {
  const n = a.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += a[i];
  mean /= n;
  let sq = 0;
  for (let i = 0; i < n; i++) {
    a[i] -= mean;
    sq += a[i] * a[i];
  }
  const rms = Math.sqrt(sq / n);
  if (rms < 1e-6) return;
  const scale = TARGET_RMS / rms;
  for (let i = 0; i < n; i++) a[i] *= scale;
}

// Linear resample src (length N) → dst (length M), treated as a periodic cycle.
function resample(src, M) {
  const N = src.length;
  const dst = new Float32Array(M);
  for (let i = 0; i < M; i++) {
    const x = (i / M) * N;
    const i0 = Math.floor(x);
    const f = x - i0;
    const a = src[i0 % N];
    const b = src[(i0 + 1) % N];
    dst[i] = a + (b - a) * f;
  }
  return dst;
}
