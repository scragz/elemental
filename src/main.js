// ELEMENTAL — main loop & input orchestration.
import { MAX_RINGS, SPEED_REF } from './config.js';
import { env, updateEnv } from './env.js';
import { clamp01 } from './util.js';
import { Field } from './field.js';
import { Tuning } from './tuning.js';
import { Gesture } from './gesture.js';
import { Ring } from './ring.js';
import { AudioEngine } from './audio.js';
import { Interaction } from './interaction.js';
import { Renderer } from './render.js';
import { Splash } from './splash.js';
import { Fx } from './fx.js';

const canvas = document.getElementById('c');
const field = new Field();
const tuning = new Tuning();
const audio = new AudioEngine();
const interaction = new Interaction(audio);
const renderer = new Renderer(canvas);
const splash = new Splash();
const fx = new Fx(audio);

const rings = [];
const gestures = new Map(); // pointerId → Gesture

let firstTapped = false;
let lastT = performance.now() / 1000;
let fpsEMA = 60;

window.__audio = audio; // debug handle
window.__fx = fx;       // debug handle

// Optional on-screen diagnostics: open with ?debug (readable on a phone).
const debugHud = /[?&]debug\b/.test(location.search) ? makeDebugHud() : null;
function makeDebugHud() {
  const el = document.createElement('pre');
  el.style.cssText = [
    'position:fixed', 'top:0', 'left:0', 'margin:0', 'padding:8px 10px',
    'font:12px/1.45 ui-monospace,Menlo,monospace', 'color:#9fe',
    'background:rgba(0,0,0,0.55)', 'z-index:10', 'pointer-events:none',
    'white-space:pre', 'max-width:100vw', 'text-shadow:0 1px 2px #000',
  ].join(';');
  document.body.appendChild(el);
  return el;
}
function updateDebugHud() {
  const s = window.__elemental;
  debugHud.textContent =
    `audio ${s.audioState} | worklet ${s.workletOk} (${s.voiceKind})\n` +
    (s.initError ? `initError: ${s.initError}\n` : '') +
    `field ${s.field}  master ${s.masterGain}\n` +
    `rings ${s.rings}  pairs ${s.voicedPairs}  voices ${s.busyVoices}/${s.busyVoices + s.freeVoices}\n` +
    `contacts ${s.contacts}  fps ${s.fps}  sr ${s.sampleRate}`;
}

// ---- input (Pointer Events; multitouch supported, §11.5) ----

// Haptic feedback where supported (Android browsers via the Vibration API). iOS
// Safari has no web vibration API, so this silently no-ops there.
const canVibrate = typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function';
function haptic(ms) {
  if (canVibrate) {
    try { navigator.vibrate(ms); } catch (_) { /* ignore */ }
  }
}

// Start (or resume) the audio context, returning a promise that resolves once it's
// ready. Fixes the silent first tap: init() is async, so the first tick has to wait.
let audioStarting = null;
function ensureAudio() {
  if (audio.ready) { audio.resume(); return Promise.resolve(); }
  if (!audioStarting) audioStarting = audio.init().then(() => audio.resume());
  return audioStarting;
}

const activePointers = new Map(); // id → {x,y} — all fingers currently down
let pinchIds = null;              // [id, id] of the two fingers controlling FX

function pickPinchPair() {
  const ids = [...activePointers.keys()];
  return ids.length >= 2 ? [ids[0], ids[1]] : null;
}
function updatePinch() {
  if (!pinchIds) return;
  const a = activePointers.get(pinchIds[0]);
  const b = activePointers.get(pinchIds[1]);
  if (a && b) fx.update(a, b);
}

function pointerDown(e) {
  const t = performance.now() / 1000;
  activePointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

  // A second finger enters FX pinch mode: cancel any in-progress spell(s) and
  // take over. Horizontal spread → reverb, vertical spread → delay.
  if (activePointers.size >= 2) {
    if (!fx.active) {
      for (const id of gestures.keys()) gestures.delete(id); // no cast for those
      pinchIds = pickPinchPair();
      const a = activePointers.get(pinchIds[0]);
      const b = activePointers.get(pinchIds[1]);
      fx.begin(a, b);
      ensureAudio().then(() => fx.apply());
      haptic(8);
    }
    return;
  }

  // Single finger → cast a spell.
  if (!firstTapped) firstTapped = true;
  splash.onTap(); // a tap clears the stage-2 hint (harmless otherwise)

  const g = new Gesture(e.clientX, e.clientY, t);
  gestures.set(e.pointerId, g);

  field.plop();
  const pan = (e.clientX / env.w) * 2 - 1;
  // Subtle tick on every tap — plays as soon as audio is ready (first tap included).
  ensureAudio().then(() => audio.tick(pan));
  haptic(6); // faint buzz on touch
}

function pointerMove(e) {
  const ap = activePointers.get(e.pointerId);
  if (ap) { ap.x = e.clientX; ap.y = e.clientY; }

  if (fx.active) { updatePinch(); return; }

  const g = gestures.get(e.pointerId);
  if (!g) return;
  const t = performance.now() / 1000;
  // Coalesced events give smoother travel/speed on fast flicks.
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) {
    const committed = g.moveTo(ev.clientX, ev.clientY, t);
    if (committed) {
      // Element chosen by the initial slide — sound its distinct voice.
      const pan = (ev.clientX / env.w) * 2 - 1;
      audio.elementSound(g.element, tuning.fundamental, pan);
      haptic([0, 14, 8, 14]); // a distinct double-pulse on commit
    }
  }
}

function pointerUp(e) {
  activePointers.delete(e.pointerId);

  if (fx.active) {
    if (activePointers.size < 2) { fx.end(); pinchIds = null; }
    else { pinchIds = pickPinchPair(); } // a pinch finger lifted; keep controlling
    return;
  }

  const g = gestures.get(e.pointerId);
  if (!g) return;
  gestures.delete(e.pointerId);

  const baked = g.bake();
  if (rings.length >= MAX_RINGS) rings.shift(); // safety cap (§5)
  rings.push(new Ring(baked, g.speed, field.level));

  // Soft "let go" on release.
  const pan = (e.clientX / env.w) * 2 - 1;
  audio.releaseSound(g.element, tuning.fundamental, pan);
  haptic(10);

  splash.onCast(); // first ripple cast → advance the intro to its second hint
}

canvas.addEventListener('pointerdown', pointerDown);
canvas.addEventListener('pointermove', pointerMove);
canvas.addEventListener('pointerup', pointerUp);
canvas.addEventListener('pointercancel', pointerUp);
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

window.addEventListener('resize', () => {
  updateEnv();
  renderer.resize();
});

// ---- main loop ----

function loop() {
  const now = performance.now() / 1000;
  let dt = now - lastT;
  lastT = now;
  if (dt > 0.1) dt = 0.1; // clamp long stalls

  tuning.update(dt);
  fx.tick(dt);

  // Advance gestures (charge + inscription).
  let anyMoving = false;
  let anyHoldingStill = false;
  let maxNormSpeed = 0;
  for (const g of gestures.values()) {
    g.tick(dt);
    const ns = clamp01(g.speed / SPEED_REF);
    maxNormSpeed = Math.max(maxNormSpeed, ns);
    if (g.speed >= 40) anyMoving = true; else anyHoldingStill = true;
  }

  // Advance rings; drop the dead.
  for (let i = rings.length - 1; i >= 0; i--) {
    rings[i].update(dt);
    if (rings[i].dead) rings.splice(i, 1);
  }

  // Interactions → voices (contact glows populate even before audio unlocks;
  // voice allocation inside no-ops until the pool exists).
  interaction.update(rings, tuning.fundamental, field.level);
  if (audio.ready) audio.setField(field.level);

  // Field economy.
  field.update(dt, {
    pointerDown: gestures.size > 0,
    moving: anyMoving,
    normSpeed: maxNormSpeed,
    collisionCount: interaction.count,
    collisionIntensity: interaction.intensity,
    holdingStill: gestures.size > 0 && !anyMoving && anyHoldingStill,
  });

  if (dt > 0) fpsEMA = fpsEMA * 0.9 + (1 / dt) * 0.1;

  renderer.frame({
    field: field.level,
    rings,
    gestures: [...gestures.values()],
    contacts: interaction.contactsThisFrame,
    now,
    fps: fpsEMA,
    fx,
  });

  // Lightweight diagnostic snapshot (harmless; read by tests / curious consoles).
  window.__elemental = {
    audioReady: audio.ready,
    audioState: audio.ctx ? audio.ctx.state : 'none',
    field: +field.level.toFixed(3),
    rings: rings.length,
    ringElements: rings.map((r) => r.element),
    activeGestures: gestures.size,
    voicedPairs: interaction.count,
    contacts: interaction.contactsThisFrame.length,
    fundamental: +tuning.fundamental.toFixed(1),
    fps: +fpsEMA.toFixed(1),
    busyVoices: audio.voices ? audio.voices.filter((v) => v.busy).length : 0,
    freeVoices: audio.freeVoices ? audio.freeVoices.length : 0,
    masterGain: audio.master ? +audio.master.gain.value.toFixed(3) : null,
    sampleRate: audio.ctx ? audio.ctx.sampleRate : null,
    workletOk: audio.workletOk ?? null,
    voiceKind: audio.voices && audio.voices[0] ? audio.voices[0].kind : null,
    initError: audio.initError ?? null,
  };

  if (debugHud) updateDebugHud();

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
