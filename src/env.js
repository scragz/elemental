// Shared, resize-aware environment values.
import { MAX_RADIUS_FRAC } from './config.js';

export const env = {
  w: window.innerWidth,
  h: window.innerHeight,
  dpr: Math.min(window.devicePixelRatio || 1, 2),
  maxRadius: 320,
};

export function updateEnv() {
  env.w = window.innerWidth;
  env.h = window.innerHeight;
  env.dpr = Math.min(window.devicePixelRatio || 1, 2);
  env.maxRadius = Math.min(env.w, env.h) * MAX_RADIUS_FRAC;
}

updateEnv();
