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
    const { field, rings, gestures, contacts, now, firstRun, fps } = state;

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
    for (const g of gestures) this._drawCharge(ctx, g);
    for (const cp of contacts) this._drawContact(ctx, cp);

    ctx.globalCompositeOperation = 'source-over';

    if (firstRun) this._drawFirstRun(ctx, firstRun);
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

  _drawCharge(ctx, g) {
    if (g.committed) return;
    const glow = g.chargeGlow;
    const rad = CHARGE_RADIUS * (1 + glow * 0.6 + g.charge * 0.15);
    const col = this._elementColor('null', 60);
    const grad = ctx.createRadialGradient(g.px, g.py, 0, g.px, g.py, rad * 2.4);
    grad.addColorStop(0, `hsla(${col.h}, 20%, 85%, ${0.5 + glow * 0.4})`);
    grad.addColorStop(1, 'hsla(0,0%,100%,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(g.px, g.py, rad * 2.4, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawContact(ctx, cp) {
    const a = clamp01(cp.amp * 2.5);
    if (a <= 0.001) return;
    const rad = 6 + a * 14;
    const grad = ctx.createRadialGradient(cp.x, cp.y, 0, cp.x, cp.y, rad);
    grad.addColorStop(0, `rgba(255, 250, 235, ${0.8 * a})`);
    grad.addColorStop(0.4, `rgba(200, 220, 255, ${0.4 * a})`);
    grad.addColorStop(1, 'rgba(120,150,220,0)');
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(cp.x, cp.y, rad, 0, Math.PI * 2);
    ctx.fill();
  }

  _drawFirstRun(ctx, alpha) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle = 'rgba(180, 190, 210, 0.9)';
    ctx.font = '300 18px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText('tap and drag', env.w / 2, env.h / 2);
    ctx.restore();
  }
}
