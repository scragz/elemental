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

const canvas = document.getElementById('c');
const field = new Field();
const tuning = new Tuning();
const audio = new AudioEngine();
const interaction = new Interaction(audio);
const renderer = new Renderer(canvas);

const rings = [];
const gestures = new Map(); // pointerId → Gesture

let firstRun = 1;          // first-run text alpha; fades on first tap, never returns
let firstTapped = false;
let lastT = performance.now() / 1000;
let sedimentClock = 0;
let fpsEMA = 60;

window.__audio = audio; // debug handle

// ---- input (Pointer Events; multitouch supported, §11.5) ----

function pointerDown(e) {
  const t = performance.now() / 1000;
  if (!audio.ready) {
    audio.init().then(() => audio.resume());
  } else {
    audio.resume();
  }
  if (!firstTapped) firstTapped = true;

  const g = new Gesture(e.clientX, e.clientY, t);
  gestures.set(e.pointerId, g);

  field.plop();
  // Plop one-shot at a neutral pitch, panned to the tap (§9).
  const pan = (e.clientX / env.w) * 2 - 1;
  audio.plop(tuning.fundamental * 1.5, pan, field.level);
}

function pointerMove(e) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  const t = performance.now() / 1000;
  // Coalesced events give smoother travel/speed on fast flicks.
  const events = e.getCoalescedEvents ? e.getCoalescedEvents() : [e];
  for (const ev of events) g.moveTo(ev.clientX, ev.clientY, t);
}

function pointerUp(e) {
  const g = gestures.get(e.pointerId);
  if (!g) return;
  gestures.delete(e.pointerId);

  const baked = g.bake();
  if (rings.length >= MAX_RINGS) rings.shift(); // safety cap (§5)
  rings.push(new Ring(baked, g.speed, field.level));
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

  // Interactions → voices.
  if (audio.ready) {
    interaction.update(rings, tuning.fundamental, field.level);
    audio.setField(field.level);
  }

  // Field economy.
  field.update(dt, {
    pointerDown: gestures.size > 0,
    moving: anyMoving,
    normSpeed: maxNormSpeed,
    collisionCount: interaction.count,
    collisionIntensity: interaction.intensity,
    holdingStill: gestures.size > 0 && !anyMoving && anyHoldingStill,
  });

  // Deposit sediment at contact points, sparingly (§7).
  sedimentClock += dt;
  if (sedimentClock > 0.08) {
    sedimentClock = 0;
    for (const cp of interaction.contactsThisFrame) {
      if (cp.amp > 0.05) renderer.addSediment(cp.x, cp.y, now);
    }
  }

  // First-run text fades on first tap and never returns (§10).
  if (firstTapped) firstRun = Math.max(0, firstRun - dt * 1.2);

  if (dt > 0) fpsEMA = fpsEMA * 0.9 + (1 / dt) * 0.1;

  renderer.frame({
    field: field.level,
    rings,
    gestures: [...gestures.values()],
    contacts: interaction.contactsThisFrame,
    now,
    firstRun,
    fps: fpsEMA,
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
  };

  requestAnimationFrame(loop);
}

requestAnimationFrame(loop);
