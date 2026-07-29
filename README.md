# ELEMENTAL

> An instrument disguised as a toy. Tap to cast a ring. Gesture to carve it. Rings meet and read each other aloud.

No score, no goal, no save. The only thing that accumulates is fatigue in the field.

This is an implementation of the ELEMENTAL design spec (v0.2) — a browser-based
audio-visual instrument built with the Canvas 2D API and Web Audio (with an
`AudioWorklet` for wavetable scanning). The instrument itself has no runtime
dependencies; Vite bundles it and it deploys to Cloudflare Workers.

## Run it

```bash
npm install
npm run dev      # Vite dev server with HMR → http://localhost:5173/
```

Then **tap and drag**.

Other scripts:

| script | what it does |
|---|---|
| `npm run build` | bundle the app to `dist/` (Vite) |
| `npm run preview` | serve the production build locally |
| `npm run start` | run the Worker locally against `dist/` (`wrangler dev`) |
| `npm run deploy` | build + publish to Cloudflare Workers (`wrangler deploy`) |

The instrument is plain ES modules, so the source also runs from any static file
server (`python3 -m http.server`) without a build — it just needs HTTP, not
`file://`, because of the modules and the `AudioWorklet`.

## Deploy (Cloudflare Workers)

Static assets are served by the Workers **ASSETS** binding; a thin worker
(`src/worker/index.ts`) runs first only for `/api/*`, leaving room for future
endpoints. `wrangler deploy` runs `npm run build` (see `wrangler.jsonc`'s
`build.command`) and uploads `dist/`.

```bash
npx wrangler login   # once
npm run deploy
```

## How to play

- **Tap and hold** — a dense disc charges at your fingertip. Holding still is cheap and refills the field; the plop itself is the only expensive act.
- **Drag past ~40px** to *commit*. The direction you push chooses the element, once and forever:

  | drag | element | character |
  |---|---|---|
  | up | **air** | thin, high, escapes fast |
  | right | **fire** | unstable, detuned jitter |
  | down | **earth** | fat, low, stays for ages |
  | left | **water** | glides, mid register |

- **Keep moving** after commit. A write head sweeps the ring at a fixed rate (one lap every 2s). What your hand *does* — not where it goes — is inscribed into the ring's waveform. Each completed lap becomes a harmonic partial, weighted by how well it agrees with a reference that your *slowest* motions write. **Anchor slowly, then bow fast against the shape you declared.**
- **Release** to cast. Flick and it launches; let go still and it drifts. The ring bakes to a single-cycle wavetable and expands until it dies.
- **Release before committing** for a bare *null* plop — a neutral spacer that takes on the character of whatever it meets.

When two rings overlap, their contact points sweep across each other and read both
waveforms aloud. Same-element rings cast alike beat against each other in near-unison —
that's the centerpiece. Difference textures; sameness rewards.

Everything is ambient: **background luminance is the field level**, ring thickness is
the inscription, opacity is your authority. There is no HUD.

## Structure

| file | spec | role |
|---|---|---|
| `src/config.js` | §2, §4–6 | all constants (the "found by ear" numbers live here) |
| `src/gesture.js` | §1, §2, §3 | gesture lifecycle, inscription, consensus weighting, bake |
| `src/ring.js` | §4.1 | cast ring: physics, register, pitch, lifetime |
| `src/interaction.js` | §4.2 | contact geometry, pair ranking, voice allocation |
| `src/audio.js` | §9 | Web Audio graph, voice pool, convolver, plop, master gain |
| `src/voice-worklet.js` | §9 | windowed wavetable-scanning voice (AudioWorklet) |
| `src/tuning.js` | §6 | drifting fundamental + just-intonation ratios |
| `src/field.js` | §5 | shared field economy |
| `src/render.js` | §7, §10 | canvas readout: rings, contacts, sediment, luminance |
| `src/main.js` | — | loop, pointer input (multitouch), orchestration |
| `src/worker/index.ts` | — | Cloudflare Worker serving the built assets |

Build/deploy config lives in `vite.config.ts`, `wrangler.jsonc`, and `tsconfig.json`.

## Notes on interpretation

A few points in the spec left latitude; the choices made here:

- **Wavetable scan (§9).** The moving contact loops a Hann-windowed slice of the baked
  cycle at the pitch; two 50%-overlapped phasors sum to unity gain so the tone is steady
  while the timbre morphs as the contact sweeps. Water slews the scan position, fire adds
  per-read detune.
- **Open questions (§11).** `SPEED_REF`, `MAX_PARTIALS`, and charge behaviour are single
  constants in `config.js`; pre-commit charge is capped (§11.3) rather than allowed to run
  away. Multitouch (§11.5) is supported — each pointer is an independent gesture. Internal
  tangency (§11.6) currently ends contact silently.
