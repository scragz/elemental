// ELEMENTAL — global constants (design spec §2, §4, §5, §6)
// Everything tunable lives here so the "found by ear" numbers (§11) are in one place.

export const LAP_DURATION = 2.0;   // s — one revolution of the write head (§2)
export const SLOTS        = 512;   // circumferential resolution
export const MAX_PARTIALS = 8;     // harmonic ceiling (§2.2 / §11.7)
export const SPEED_REF    = 900;   // px/s — authority normalization (§2.3 / §11.1)
export const TABLE_SIZE   = 2048;  // baked playback wavetable length (§3)

export const ANG_RATE = (2 * Math.PI) / LAP_DURATION; // rad/s, fixed write-head speed

export const COMMIT_TRAVEL = 24;   // px — cumulative travel that commits a gesture (§1.2)
export const CHARGE_RADIUS = 8;    // px — pre-commit disc radius (§1.1)

// Stillness (§2.1, §4, §5)
export const STILL_SPEED = 40;     // px/s below which the hand counts as "still"
export const STILL_FULL  = 1.5;    // s of stillness for a fully swelled arc

// Charge (§5 / §11.3): accrues while a pointer is down, faster when still.
export const CHARGE_RATE_MOVE = 0.35; // per second while moving
export const CHARGE_RATE_STILL = 0.9; // per second while still
export const CHARGE_MAX = 3.0;        // cap on accrued charge (§11.3 "cap pre-commit charge")

// Fraction of MAX_RADIUS reachable; MAX_RADIUS itself is screen-relative (see env.js).
export const MAX_RADIUS_FRAC = 0.45;

// Four poles → element (§1.2). Angles measured screen-space (y down), 0 = +x (right).
// up = air, right = fire, down = earth, left = water.
export const POLES = [
  { angle: -Math.PI / 2, element: 'air' },
  { angle: 0,            element: 'fire' },
  { angle: Math.PI / 2,  element: 'earth' },
  { angle: Math.PI,      element: 'water' },
];

// Element behaviour + register (§4.1). `octave` multiplies the drifting fundamental.
// Octaves are pushed into the range phone speakers can reproduce (they roll off hard
// below ~400Hz): even earth's fundamental sits ~200Hz+ with strong harmonics above.
// Ordering (earth<water<fire<air) is preserved.
export const ELEMENTS = {
  air:   { speed: 240, life: 4,  octave: 3.5,  hue: 270, sat: 70, character: 'thin'   },
  fire:  { speed: 170, life: 6,  octave: 2.5,  hue: 14,  sat: 85, character: 'jitter' },
  water: { speed: 95,  life: 12, octave: 2.0,  hue: 190, sat: 80, character: 'glide'  },
  earth: { speed: 62,  life: 20, octave: 1.5,  hue: 40,  sat: 65, character: 'fat'    },
  null:  { speed: 120, life: 8,  octave: 2.0,  hue: 0,   sat: 0,  character: 'inert'  },
};

// Just-intonation ratios off the fundamental (§6).
export const RATIOS = [1 / 1, 9 / 8, 5 / 4, 4 / 3, 3 / 2, 5 / 3, 15 / 8];

// Tuning drift (§6): fundamental wanders within a 1.5-octave band, retargeting ~40s.
export const TUNE_BASE   = 220;                 // Hz, centre of the band
export const TUNE_BAND   = Math.pow(2, 1.5);    // 1.5 octaves total span
export const TUNE_RETARGET = 40;                // s between new targets
export const TUNE_SLEW   = 0.06;                // fundamental drift smoothing

// Field economy (§5). Tuned gentle: the "dense → hushed → recover" breathing stays,
// but costs are lower and refills faster so casual play never drains to silence.
export const FIELD = {
  plop: 0.07,               // cost on pointerdown
  moveCostPerSec: 0.025,    // × normalized speed while holding & moving
  voiceCostPerSec: 0.004,   // × intensity, per active collision voice
  refillIdle: 0.10,         // no pointer, no collisions
  refillBusy: 0.06,         // no pointer, collisions active
  refillHold: 0.045,        // holding still
};

// How much FIELD attenuates voice amplitude (§5). Floored so an exhausted field
// dims rather than silences — the visible luminance still reads the true level.
export const FIELD_VOICE_FLOOR = 0.5;

// Casting (§1.3): release velocity → expansion multiplier.
export const CAST_MULT_MIN = 0.6;
export const CAST_MULT_MAX = 1.8;
export const CAST_SPEED_REF = 1200; // px/s that maps to CAST_MULT_MAX

// Safety caps (§5) — governor, not design.
export const MAX_RINGS = 48;
export const MAX_PAIRS = 12;

// Contact tolerance (px). Rings read as "in contact" within this band of touching,
// not only at exact circle intersection — bigger, longer-lasting collision targets
// so meetings are easy to make and hear.
export const CONTACT_PAD = 30;

// Per-voice loudness. Contact amplitude is a product of sub-1 terms (banked,
// envelopes, field); this lifts it back to an audible level. Compressor + master
// gain keep the sum safe when many pairs voice at once.
export const VOICE_LEVEL = 1.3;

// Wavetable scan window (§9). A slice of the baked cycle, looped at pitch, is what
// the moving contact "reads". Smaller = brighter/formant-like.
export const SCAN_WIN = 1024;

// Sediment memory (§7).
export const SEDIMENT_LIFE = 30; // s
