// Small shared helpers.

export const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
export const clamp = (x, lo, hi) => (x < lo ? lo : x > hi ? hi : x);
export const lerp = (a, b, t) => a + (b - a) * t;
export const dist = (ax, ay, bx, by) => Math.hypot(ax - bx, ay - by);

let _id = 0;
export const nextId = () => ++_id;
