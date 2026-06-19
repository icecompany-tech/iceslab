/// <reference types="vite/client" />

// Build-time constants injected by vite.config.ts → define.
// Source of truth: apps/panel-frontend/package.json version field.
// Bump that on tag, rebuild, UI reflects automatically.
declare const __APP_VERSION__: string;

// Demo-build flag, injected by vite.config.ts → define. `true` only for
// `pnpm build:demo` (VITE_DEMO_MODE=true); `false` in every normal build.
declare const __DEMO_MODE__: boolean;
