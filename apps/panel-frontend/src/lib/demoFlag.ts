/**
 * Build-time demo flag for the read-only landing-page demo.
 *
 * `VITE_DEMO_MODE=true vite build` (see `pnpm build:demo`) produces the demo
 * build: auto-login, all API calls served from local fixtures, every mutation a
 * no-op. Unset / any other value = the normal panel - Vite inlines this to
 * `false` at build time and dead-code-eliminates every `if (DEMO_MODE)` branch
 * plus the dynamic `import('./demo/install')` in main.tsx, so no demo code or
 * fixtures ever reach the production bundle.
 */
// `__DEMO_MODE__` is a real boolean literal injected by vite.config.ts → define
// (true only for `build:demo`). Using a define'd constant - not a runtime
// `import.meta.env` lookup - lets Rollup statically fold `if (DEMO_MODE)` and
// dead-code-eliminate the dynamic `import('./demo/install')` plus all fixtures
// from the normal build.
export const DEMO_MODE = __DEMO_MODE__;

// Frozen "now" for the demo. The fixtures are anchored to this exact moment
// (fixtures.ts BASE = DEMO_NOW), so relative-time labels and online/offline
// computations must measure against it, not the wall clock - otherwise the demo
// "ages" (relative times drift, users flip to OFFLINE while the header still
// says N online).
export const DEMO_NOW = 1781848500000; // 2026-06-19T05:55:00.000Z

// "Now" in epoch ms. Demo build returns the frozen anchor; the normal build
// folds to plain Date.now() (__DEMO_MODE__ === false at build) and DEMO_NOW is
// tree-shaken out.
export function now(): number {
  return __DEMO_MODE__ ? DEMO_NOW : Date.now();
}
