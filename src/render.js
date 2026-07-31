// ELEMENTAL — visual language (design spec §10). The screen is a readout, not a UI.
import { ELEMENTS, CHARGE_RADIUS } from './config.js';
import { env } from './env.js';
import { clamp01, clamp } from './util.js';

const SEGMENTS_MAX = 64; // per-ring stroke resolution (throttled down on slow frames)
const SEGMENTS_MIN = 28;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.resize();
  }

  resize() {
    const c = this.canvas;
    c.width = Math.floor(env.w * env.dpr);
    c.height = Math.floor(env.h * env.dpr);
    c.style.width = env.w + 'px';
    c.style.height = env.h + 'px';
    this.ctx.setTransform(env.dpr, 0, 0, env.dpr, 0, 0);
  }

  frame(state) {
    const ctx = this.ctx;
    const { field, rings, gestures, contacts, fps, fx } = state;

    // Self-throttle stroke resolution on slow frames so heavy fields stay smooth.
    let segments = SEGMENTS_MAX;
    if (fps < 50) segments = 48;
    if (fps < 40) segments = 36;
    if (fps < 30) segments = SEGMENTS_MIN;

    // Background luminance = FIELD (§5, §10). Motion-blur via low-alpha fill (§10).
    const lum = 3 + field * 20;
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = `rgba(${lum * 0.5}, ${lum * 0.6}, ${lum}, 0.20)`;
    ctx.fillRect(0, 0, env.w, env.h);

    // Additive compositing on rings and contacts only (§10).
    ctx.globalCompositeOperation = 'lighter';

    for (const r of rings) this._drawRing(ctx, r, segments);
    for (const g of gestures) this._drawGesture(ctx, g);
    for (const cp of contacts) this._drawContact(ctx, cp);

    ctx.globalCompositeOperation = 'source-over';

    if (fx) this._drawFx(ctx, fx);
  }

  // FX pinch indicator: a crosshair at the midpoint of the two fingers whose
  // horizontal arm = reverb and vertical arm = delay, over faint full-scale tracks,
  // with a connector and a glowing dot on each finger.
  _drawFx(ctx, fx) {
    const g = fx.active ? 1 : fx.glow;
    if (g <= 0.01 || !fx.p0 || !fx.p1) return;
    const a = fx.p0, b = fx.p1;
    const m = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const TWO_PI = Math.PI * 2;
    const L = 90; // full-scale arm length in px

    ctx.globalCompositeOperation = 'lighter';
    ctx.lineCap = 'round';

    // Connector between the two fingers.
    ctx.strokeStyle = `rgba(150, 200, 255, ${0.22 * g})`;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); ctx.stroke();

    // Glowing dot on each finger.
    for (const p of [a, b]) {
      const gr = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, 15);
      gr.addColorStop(0, `rgba(225, 240, 255, ${0.8 * g})`);
      gr.addColorStop(1, 'rgba(150, 200, 255, 0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(p.x, p.y, 15, 0, TWO_PI); ctx.fill();
    }

    // Full-scale tracks.
    ctx.strokeStyle = `rgba(255, 255, 255, ${0.12 * g})`;
    ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(m.x - L, m.y); ctx.lineTo(m.x + L, m.y); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(m.x, m.y - L); ctx.lineTo(m.x, m.y + L); ctx.stroke();

    // Reverb (horizontal) and delay (vertical) fills.
    const rl = L * fx.reverb;
    ctx.strokeStyle = `rgba(120, 190, 255, ${0.95 * g})`;
    ctx.beginPath(); ctx.moveTo(m.x - rl, m.y); ctx.lineTo(m.x + rl, m.y); ctx.stroke();
    const dl = L * fx.delay;
    ctx.strokeStyle = `rgba(185, 225, 255, ${0.95 * g})`;
    ctx.beginPath(); ctx.moveTo(m.x, m.y - dl); ctx.lineTo(m.x, m.y + dl); ctx.stroke();

    // Centre dot.
    ctx.fillStyle = `rgba(240, 250, 255, ${0.9 * g})`;
    ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, TWO_PI); ctx.fill();

    ctx.globalCompositeOperation = 'source-over';
  }

  _elementColor(element, l = 55) {
    const def = ELEMENTS[element === null ? 'null' : element];
    return { h: def.hue, s: def.sat, l };
  }

  _drawRing(ctx, r, segments) {
    const envn = r.envelope();
    if (envn <= 0.001 || r.r < 1) return;
    const col = this._elementColor(r.element);
    const wave = r.wave;
    const auth = r.auth;
    const nWave = wave.length;
    const nAuth = auth.length;
    const step = (Math.PI * 2) / segments;
    const massW = 0.6 + 0.4 * r.mass / 2;

    // Per-slot line width from wave[] and alpha from auth[] (§10).
    for (let i = 0; i < segments; i++) {
      const t0 = i / segments;
      const ang0 = r.phase + i * step;

      const wv = Math.abs(wave[Math.floor(t0 * nWave) % nWave]);
      const au = auth[Math.floor(t0 * nAuth) % nAuth] || 0.2;
      const alpha = clamp(au * envn * 0.9, 0, 1);
      if (alpha < 0.02) continue; // invisible — skip the stroke

      ctx.strokeStyle = `hsla(${col.h}, ${col.s}%, ${col.l + wv * 20}%, ${alpha})`;
      ctx.lineWidth = clamp(0.6 + wv * 5, 0.4, 7) * massW;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, ang0, ang0 + step);
      ctx.stroke();
    }

    // Concentric grooves make lap count legible (§10).
    const laps = Math.min(r.lapsCompleted, 8);
    for (let L = 1; L <= laps; L++) {
      const gr = r.r - L * 2.2;
      if (gr < 2) break;
      ctx.strokeStyle = `hsla(${col.h}, ${col.s}%, ${col.l}%, ${0.10 * envn})`;
      ctx.lineWidth = 0.6;
      ctx.beginPath();
      ctx.arc(r.x, r.y, gr, 0, Math.PI * 2);
      ctx.stroke();
    }
  }

  // Live gesture feedback — light up the path, show the element on commit, and the
  // drawing centre + reach ring so the gesture is legible as you make it.
  _drawGesture(ctx, g) {
    const committed = g.committed;
    const col = committed
      ? this._elementColor(g.element, 62)
      : { h: 200, s: 25, l: 85 };

    // Trail of where the finger has been.
    const tr = g.trail;
    if (tr && tr.length > 1) {
      ctx.lineCap = 'round';
      for (let i = 1; i < tr.length; i++) {
        const f = i / tr.length; // brighter toward the head
        ctx.strokeStyle = `hsla(${col.h}, ${col.s}%, ${col.l}%, ${0.45 * f})`;
        ctx.lineWidth = 1 + 3.5 * f;
        ctx.beginPath();
        ctx.moveTo(tr[i - 1].x, tr[i - 1].y);
        ctx.lineTo(tr[i].x, tr[i].y);
        ctx.stroke();
      }
    }

    if (committed) {
      const cx = g.commitX, cy = g.commitY;
      const rr = Math.hypot(g.px - cx, g.py - cy);
      // Reach ring: the current radius is exactly what's being inscribed.
      ctx.strokeStyle = `hsla(${col.h}, ${col.s}%, 65%, 0.45)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(cx, cy, Math.max(2, rr), 0, Math.PI * 2);
      ctx.stroke();
      // Spoke from centre to the pointer.
      ctx.strokeStyle = `hsla(${col.h}, ${col.s}%, 72%, 0.3)`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.lineTo(g.px, g.py);
      ctx.stroke();
      // Centre marker.
      ctx.fillStyle = `hsla(${col.h}, ${col.s}%, 82%, 0.85)`;
      ctx.beginPath();
      ctx.arc(cx, cy, 3.5, 0, Math.PI * 2);
      ctx.fill();
    } else {
      // Pre-commit charging disc.
      const glow = g.chargeGlow;
      const rad = CHARGE_RADIUS * (1 + glow * 0.6 + g.charge * 0.15) * 2.4;
      const grad = ctx.createRadialGradient(g.px, g.py, 0, g.px, g.py, rad);
      grad.addColorStop(0, `hsla(${col.h}, 25%, 90%, ${0.5 + glow * 0.4})`);
      grad.addColorStop(1, 'hsla(0,0%,100%,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(g.px, g.py, rad, 0, Math.PI * 2);
      ctx.fill();
    }

    // Bright head at the current pointer, always.
    const head = ctx.createRadialGradient(g.px, g.py, 0, g.px, g.py, 18);
    head.addColorStop(0, `hsla(${col.h}, ${col.s}%, 92%, 0.9)`);
    head.addColorStop(1, `hsla(${col.h}, ${col.s}%, 60%, 0)`);
    ctx.fillStyle = head;
    ctx.beginPath();
    ctx.arc(g.px, g.py, 18, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawContact(ctx, cp) {
    const a = clamp01(cp.amp * 2.5);
    if (a <= 0.001) return;
    const rad = 12 + a * 26; // bigger, easier-to-see collision glow
    const grad = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, rad);
    grad.addColorStop(0, `rgba(255, 250, 235, ${0.85 * a})`);
    grad.addColorStop(0.35, `rgba(200, 220, 255, ${0.45 * a})`);
    grad.addColorStop(1, 'rgba(120,150,220,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }
}
