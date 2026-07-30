import { defineConfig } from "vite";

export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: true,
    target: "es2022",
    // Emit the AudioWorklet as a real file rather than inlining it as a data: URL.
    // Mobile Safari is unreliable loading worklets from data:/blob: URLs.
    assetsInlineLimit: 0,
  },
});
