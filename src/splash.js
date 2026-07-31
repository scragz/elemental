// ELEMENTAL — splash / onboarding overlay. Neon title + help text in Cantrip Mono,
// drawn as a DOM layer above the canvas so the glow (text-shadow) is cheap. Fades
// out fast on first real interaction.

const STYLE = `
#splash {
  position: fixed; inset: 0; z-index: 5;
  display: flex; flex-direction: column; align-items: center; justify-content: center;
  gap: 4.5vh; text-align: center; padding: 0 6vw;
  pointer-events: none;
  transition: opacity 0.4s ease;
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
}
#splash-sub {
  font-size: clamp(14px, 4.3vw, 22px);
  line-height: 1.75;
  letter-spacing: 0.05em;
  color: #ddd7c8;                 /* dusty white */
  text-shadow: 0 0 6px rgba(255, 225, 244, 0.22);
  opacity: 0.9;
  max-width: 90vw;
}
@keyframes splash-flicker {
  0%, 100% { opacity: 1; }
  47% { opacity: 1; }
  48% { opacity: 0.82; }
  49% { opacity: 1; }
  92% { opacity: 1; }
  93% { opacity: 0.88; }
  94% { opacity: 1; }
}
`;

export class Splash {
  constructor() {
    this.faded = false;
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
    this.sub.textContent = 'cast spells to create music';
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

  // Swap the help line for the how-to, once the demo has shown a collision.
  showInstructions() {
    if (this.faded || this._instructed) return;
    this._instructed = true;
    this.sub.innerHTML =
      'drag to choose your elemental<br>' +
      'gesture to build a spell<br>' +
      'release to cast';
  }

  // Fade out fast on first real interaction, then remove.
  fadeOut() {
    if (this.faded) return;
    this.faded = true;
    this.el.classList.add('hide');
    setTimeout(() => this.el.remove(), 500);
  }
}
