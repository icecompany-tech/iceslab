/**
 * Project links shown in the topbar. The panel is an AGPL project in public
 * alpha whose phase goal is community deployments, so the way to the repo and
 * the chat lives inside the product rather than only in the README.
 *
 * A blank entry renders nothing: this install ships only the channels it
 * actually has, and a fork points them at its own without touching AppLayout.
 * Override per build with the matching VITE_* env var.
 */

function link(value: string | undefined, fallback = ''): string {
  const v = (value ?? fallback).trim();
  return v.startsWith('http') ? v : '';
}

export const GITHUB_URL = link(
  import.meta.env.VITE_GITHUB_URL,
  'https://github.com/icecompany-tech/iceslab',
);
export const TELEGRAM_URL = link(import.meta.env.VITE_TELEGRAM_URL);
export const DISCORD_URL = link(import.meta.env.VITE_DISCORD_URL);
/** Donation / sponsor page. Amber heart chip, deliberately the only warm accent up there. */
export const SUPPORT_URL = link(import.meta.env.VITE_SUPPORT_URL);
