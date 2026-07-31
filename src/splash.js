// ELEMENTAL — splash / onboarding overlay. Neon title + help text in Cantrip Mono,
// drawn as a DOM layer above the canvas so the glow (text-shadow) is cheap.
//
// Two stages, driven by the player's own actions (which is also what unlocks audio):
//   stage 1: logo + "drag to choose an element, release to cast a ripple"
//   → on their first cast, the logo fades and the line becomes the next hint
//   stage 2: "now let your ripples cross to make sound"
//   → dismissed by the next tap, or on its own after a short while.

const STAGE1 = 'drag to choose an element,\nrelease to cast a ripple';
const STAGE2 = 'now let your ripples cross\nto make sound';

const STYLE = `
#splash {
  position: fixed; inset: 0; z-index: 5;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4.5vh; text-align: center; padding: 0 6vw;
  pointer-events: none;
  transition: opacity 0.45s ease;
  font-family: 'Cantrip Mono', ui-monospace, Menlo, monospace;
}
#splash.hide { opacity: 0; }
#splash-title {
  font-size: clamp(54px, 17vw, 150px);
  letter-spacing: 0.06em;
  color: #ffd7ee;                 /* phosphor light pink */
  text-shadow:
    0 0 6px #ff8fd0,
    0 0 16px #ff53b1,
    0 0 34px #ff2d9b,             /* neon pink outer glow */
    0 0 66px #ff1e90;
  animation: splash-flicker 4.5s ease-in-out infinite;
  transition: opacity 0.5s ease, transform 0.5s ease;
}
#splash-title.dim { opacity: 0; transform: translateY(-2vh) scale(0.98); }
#splash-sub {
  font-size: clamp(15px, 4.6vw, 23px);
  line-height: 1.7;
  letter-spacing: 0.05em;
  color: #ddd7c8;                 /* dusty white */
  text-shadow: 0 0 6px rgba(255, 225, 244, 0.22);
  white-space: pre-line;
  max-width: 90vw;
  transition: opacity 0.35s ease;
}
#splash-sub.swap { opacity: 0; }
@keyframes splash-flicker {
  0%, 100% { opacity: 1; }
  47% { opacity: 1; } 48% { opacity: 0.82; } 49% { opacity: 1; }
  92% { opacity: 1; } 93% { opacity: 0.88; } 94% { opacity: 1; }
}
`;

export class Splash {
  constructor() {
    this.stage = 1;
    this._loadFont();

    const style = document.createElement('style');
    style.textContent = STYLE;
    document.head.appendChild(style);

    this.el = document.createElement('div');
    this.el.id = 'splash';
    this.title = document.createElement('div');
    this.title.id = 'splash-title';
    this.title.textContent = 'ELEMENTAL';
    this.sub = document.createElement('div');
    this.sub.id = 'splash-sub';
    this.sub.textContent = STAGE1;
    this.el.appendChild(this.title);
    this.el.appendChild(this.sub);
    document.body.appendChild(this.el);
  }

  _loadFont() {
    try {
      const url = new URL('./assets/cantrip-mono.ttf', import.meta.url);
      const face = new FontFace('Cantrip Mono', `url(${url})`);
      face.load().then((f) => document.fonts.add(f)).catch(() => {});
    } catch (_) { /* ignore */ }
  }

  // First cast (a ripple was released): drop the logo, swap in the stage-2 hint.
  onCast() {
    if (this.stage !== 1) return;
    this.stage = 2;
    this.title.classList.add('dim');
    setTimeout(() => { this.title.style.display = 'none'; }, 520);
    // Crossfade the help line.
    this.sub.classList.add('swap');
    setTimeout(() => {
      this.sub.textContent = STAGE2;
      this.sub.classList.remove('swap');
    }, 360);
    // Fades on its own if they don't tap again.
    this._auto = setTimeout(() => this.dismiss(), 7000);
  }

  // A tap while stage 2 is showing clears it.
  onTap() {
    if (this.stage === 2) this.dismiss();
  }

  dismiss() {
    if (this.stage === 3) return;
    this.stage = 3;
    clearTimeout(this._auto);
    this.el.classList.add('hide');
    setTimeout(() => this.el.remove(), 550);
  }
}
