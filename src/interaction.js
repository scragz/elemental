// ELEMENTAL — contact geometry & voice management (design spec §4.2, §9)
//
// Contact exists when |r1-r2| ≤ d ≤ r1+r2. Two contact points at ±α from the
// centre-to-centre line, each reading both rings. The interaction matrix is not
// written — scrub rate, chirps and unisons all fall out of this geometry.
import { MAX_PAIRS, VOICE_LEVEL, FIELD_VOICE_FLOOR, CONTACT_PAD } from './config.js';
import { env } from './env.js';
import { clamp } from './util.js';

const TWO_PI = Math.PI * 2;

export class Interaction {
  constructor(audio) {
    this.audio = audio;
    this.pairs = new Map(); // key → { ring1, ring2, voices:[v0,v1] }
    this.contactsThisFrame = []; // for rendering + sediment
    this.intensity = 0;
    this.count = 0;
  }

  key(a, b) {
    return a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
  }

  update(rings, fundamental, field) {
    this.contactsThisFrame.length = 0;
    let intensity = 0;

    // Find all contacting pairs and score them by amplitude.
    const active = [];
    for (let i = 0; i < rings.length; i++) {
      const r1 = rings[i];
      for (let j = i + 1; j < rings.length; j++) {
        const r2 = rings[j];
        const d = Math.hypot(r1.x - r2.x, r1.y - r2.y);
        if (d < 1e-3) continue;
        const sum = r1.r + r2.r;
        const diff = Math.abs(r1.r - r2.r);
        // Padded contact window: touch counts within CONTACT_PAD of intersecting,
        // so collisions are easier to make and linger longer.
        if (d > sum + CONTACT_PAD || d < diff - CONTACT_PAD) continue;

        // Proximity: 1 while truly intersecting, fading to 0 at the pad edge.
        let prox = 1;
        if (d > sum) prox = 1 - (d - sum) / CONTACT_PAD;
        else if (d < diff) prox = 1 - (diff - d) / CONTACT_PAD;
        prox = clamp(prox, 0, 1);

        const geo = contactGeometry(r1, r2, d);
        if (!geo) continue;

        // Amplitude estimate for ranking (banked₁·banked₂·FIELD, §4.2).
        const env1 = r1.envelope();
        const env2 = r2.envelope();
        let amp = 0;
        for (const cp of geo) {
          amp += r1.bankedAt(cp.a1) * r2.bankedAt(cp.a2);
        }
        amp *= 0.5 * env1 * env2 * field * (0.4 + 0.6 * prox);
        active.push({ r1, r2, geo, amp, prox });
      }
    }

    // Keep the loudest MAX_PAIRS; cull the rest silently (§5).
    active.sort((a, b) => b.amp - a.amp);
    const keep = active.slice(0, MAX_PAIRS);
    const keepKeys = new Set();

    for (const item of keep) {
      const k = this.key(item.r1, item.r2);
      keepKeys.add(k);
      let pair = this.pairs.get(k);
      if (!pair) {
        pair = { ring1: item.r1, ring2: item.r2, voices: [null, null] };
        this.pairs.set(k, pair);
      }
      intensity += this._voicePair(pair, item, fundamental, field);
    }

    // Free voices for pairs that separated or got culled.
    for (const [k, pair] of this.pairs) {
      if (!keepKeys.has(k)) {
        for (const v of pair.voices) this.audio.free(v);
        this.pairs.delete(k);
      }
    }

    this.intensity = intensity;
    this.count = keep.length;
  }

  _voicePair(pair, item, fundamental, field) {
    const { r1, r2, geo, prox } = item;
    const env1 = r1.envelope();
    const env2 = r2.envelope();
    const freqA = r1.pitch(fundamental);
    const freqB = r2.pitch(fundamental);
    const water = r1.element === 'water' || r2.element === 'water';
    const jitter = (r1.element === 'fire' || r2.element === 'fire') ? 1 : 0;
    let intensity = 0;

    for (let idx = 0; idx < 2; idx++) {
      const cp = geo[idx];
      if (!cp) { this.audio.free(pair.voices[idx]); pair.voices[idx] = null; continue; }

      let v = pair.voices[idx];
      if (!v || !v.busy) {
        v = this.audio.alloc();
        if (v) {
          v.busy = true;
          v.key = this.key(r1, r2) + ':' + idx;
          this.audio.setTables(v, r1.wave, r2.wave, v.key);
        }
        pair.voices[idx] = v;
      }

      // banked₁·banked₂ (§4.2). sqrt lifts the low end so quiet contacts are still
      // audible while loud swells still dominate. FIELD only dims voices (floored),
      // it never silences them, so a drained field is hushed rather than dead.
      const banked = Math.sqrt(r1.bankedAt(cp.a1) * r2.bankedAt(cp.a2));
      const activity = clamp(banked * env1 * env2 * (0.4 + 0.6 * prox), 0, 1);
      const fieldGain = FIELD_VOICE_FLOOR + (1 - FIELD_VOICE_FLOOR) * field;
      const amp = activity * fieldGain * VOICE_LEVEL;
      // Field cost tracks activity (not the boosted gain), and eases as field drops
      // so a busy screen can still refill (§5).
      intensity += activity * field;

      // Contact point screen position → pan + render. The renderer draws the glow
      // *on* each ring's circumference, so it carries the two arcs being read.
      this.contactsThisFrame.push({
        x: cp.x,
        y: cp.y,
        amp,
        arcs: [
          { x: r1.x, y: r1.y, r: r1.r, angle: cp.a1, element: r1.element },
          { x: r2.x, y: r2.y, r: r2.r, angle: cp.a2, element: r2.element },
        ],
      });

      if (v) {
        this.audio.updateVoice(v, {
          scanA: r1.scanAt(cp.a1),
          scanB: r2.scanAt(cp.a2),
          freqA, freqB,
          jitter,
          water,
          amp,
          pan: clamp((cp.x / env.w) * 2 - 1, -1, 1),
          brightness: 0.5 * (r1.lapsCompleted + r2.lapsCompleted) / 8,
        });
      }
    }
    return intensity;
  }
}

// Two contact points at ±α₁ / ±α₂ (§4.2). Returns [{x,y,a1,a2}, ...].
function contactGeometry(r1, r2, d) {
  const cos1 = (d * d + r1.r * r1.r - r2.r * r2.r) / (2 * d * r1.r);
  const cos2 = (d * d + r2.r * r2.r - r1.r * r1.r) / (2 * d * r2.r);
  const c1 = clamp(cos1, -1, 1);
  const c2 = clamp(cos2, -1, 1);
  const a1 = Math.acos(c1);
  const a2 = Math.acos(c2);

  // Base angle of the centre-to-centre line, from ring1 and ring2 respectively.
  const base1 = Math.atan2(r2.y - r1.y, r2.x - r1.x);
  const base2 = base1 + Math.PI; // opposite direction from ring2

  const pts = [];
  for (const s of [1, -1]) {
    const ang1 = base1 + s * a1;
    // The same physical contact point relative to ring2 is base2 ∓ a2.
    const ang2 = base2 - s * a2;
    const x = r1.x + r1.r * Math.cos(ang1);
    const y = r1.y + r1.r * Math.sin(ang1);
    pts.push({ x, y, a1: ang1, a2: ang2 });
  }
  return pts;
}
