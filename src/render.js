// ELEMENTAL — visual language (design spec §10). The screen is a readout, not a UI.
import { ELEMENTS, SEDIMENT_LIFE, CHARGE_RADIUS } from './config.js';
import { env } from './env.js';
import { clamp01, clamp } from './util.js';

const SEGMENTS_MAX = 64; // per-ring stroke resolution (throttled down on slow frames)
const SEGMENTS_MIN = 28;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.sediment = []; // { x, y, born }
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

  addSediment(x, y, now) {
    this.sediment.push({ x, y, born: now });
    if (this.sediment.length > 400) this.sediment.shift();
  }

  frame(state) {
    const ctx = this.ctx;
    const { field, rings, gestures, contacts, now, fps, fx } = state;

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

    // Sediment — faint deposits at contact points, fading over ~30s (§7).
    this._drawSediment(ctx, now);

    // Additive compositing on rings and contacts only (§10).
    ctx.globalCompositeOperation = 'lighter';

    for (const r of rings) this._drawRing(ctx, r, segments);
    for (const g of gestures) this._drawGesture(ctx, g);
    for (const cp of contacts) this._drawContact(ctx, cp);

    ctx.globalCompositeOperation = 'source-over';

    if (fx) this._drawOrb(ctx, fx);
  }

  // FX orb (bottom-right): reverb halo (left/right), delay echo rings (up/down),
  // with value bars while it's being dragged.
  _drawOrb(ctx, fx) {
    const o = fx.orb();
    const rev = fx.reverb, del = fx.delay;
    const active = fx.dragId !== null ? 1 : fx.glow;
    const TWO_PI = Math.PI * 2;

    ctx.globalCompositeOperation = 'lighter';

    // Reverb halo — larger, softer with more reverb.
    const haloR = o.r * (1.3 + rev * 2.8);
    const halo = ctx.createRadialGradient(o.x, o.y, o.r * 0.3, o.x, o.y, haloR);
    halo.addColorStop(0, `rgba(150, 200, 255, ${0.10 + 0.20 * rev})`);
    halo.addColorStop(1, 'rgba(120, 160, 255, 0)');
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(o.x, o.y, haloR, 0, TWO_PI);
    ctx.fill();

    // Delay — concentric echo rings.
    const echoes = Math.round(del * 4);
    for (let i = 1; i <= echoes; i++) {
      const rr = o.r + i * (o.r * 0.55);
      ctx.strokeStyle = `rgba(180, 220, 255, ${0.2 * del * (1 - i / (echoes + 1))})`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(o.x, o.y, rr, 0, TWO_PI);
      ctx.stroke();
    }

    // Core orb.
    const core = ctx.createRadialGradient(o.x, o.y, 0, o.x, o.y, o.r);
    core.addColorStop(0, 'rgba(240, 250, 255, 0.95)');
    core.addColorStop(0.5, 'rgba(150, 190, 255, 0.6)');
    core.addColorStop(1, 'rgba(120, 160, 255, 0)');
    ctx.fillStyle = core;
    ctx.beginPath();
    ctx.arc(o.x, o.y, o.r, 0, TWO_PI);
    ctx.fill();

    // Value bars while active: horizontal = reverb (above), vertical = delay (left).
    if (active > 0.01) {
      const a = active;
      const bw = o.r * 2.6;
      const bx = o.x - bw / 2, by = o.y - o.r - 16;
      ctx.lineCap = 'round';
      ctx.strokeStyle = `rgba(255,255,255,${0.14 * a})`;
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.stroke();
      ctx.strokeStyle = `rgba(150,200,255,${0.9 * a})`;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw * rev, by); ctx.stroke();

      const bh = o.r * 2.6;
      const vx = o.x - o.r - 16, vy = o.y + bh / 2;
      ctx.strokeStyle = `rgba(255,255,255,${0.14 * a})`;
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx, vy - bh); ctx.stroke();
      ctx.strokeStyle = `rgba(180,220,255,${0.9 * a})`;
      ctx.beginPath(); ctx.moveTo(vx, vy); ctx.lineTo(vx, vy - bh * del); ctx.stroke();
    }

    ctx.globalCompositeOperation = 'source-over';
  }

  _drawSediment(ctx, now) {
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.sediment.length - 1; i >= 0; i--) {
      const s = this.sediment[i];
      const age = now - s.born;
      if (age > SEDIMENT_LIFE) { this.sediment.splice(i, 1); continue; }
      const a = (1 - age / SEDIMENT_LIFE) * 0.12;
      ctx.fillStyle = `rgba(140, 170, 210, ${a})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, 2.2, 0, Math.PI * 2);
      ctx.fill();
    }
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
