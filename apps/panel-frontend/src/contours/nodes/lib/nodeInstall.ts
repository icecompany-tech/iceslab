import type { NodeHardening } from '@/lib/domain/nodes';
import type { Profile } from '@/lib/domain/profiles';
export const STEPS = [
  { key: 'params', label: 'nodeCreate.step1', hint: 'nodeCreate.step1Hint' },
  { key: 'hosts', label: 'nodeCreate.step2', hint: 'nodeCreate.step2Hint' },
  { key: 'install', label: 'nodeCreate.step3', hint: 'nodeCreate.step3Hint' },
] as const;

/**
 * Collapse the flat hardening fields into the blob the API stores. Null when
 * nothing is on, so an ordinary node keeps hardening = NULL and its install
 * command stays byte-identical to the default one.
 */
export function buildHardening(v: {
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}): NodeHardening | null {
  const allow = v.hardenSshAllowlist.map((s) => s.trim()).filter(Boolean);
  const h: NodeHardening = {};
  if (v.hardenUfw) h.ufwLockdown = true;
  if (v.hardenFail2ban) h.fail2ban = true;
  if (v.hardenRealisticFallback) h.realisticFallback = true;
  if (allow.length > 0) h.sshAllowlist = allow;
  return Object.keys(h).length > 0 ? h : null;
}

/** mm:ss for the heartbeat clock. */
export function clock(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

/** How long the token has left, in whole minutes. */
export function expiryLabel(iso: string, t: (k: string, o?: Record<string, unknown>) => string): string {
  const left = Math.max(0, Math.round((new Date(iso).getTime() - Date.now()) / 60000));
  return left <= 0 ? t('nodeCreate.expired') : t('nodeCreate.expiresIn', { min: left });
}

/**
 * Break the one-liner where the installer's own flags start, so a 300-char
 * command reads as four lines instead of one wrapped smear.
 */
export function splitCommand(cmd: string): string[] {
  const parts = cmd
    .split(/\s+(?=--)/)
    // The command may already carry its own line continuations; strip them so
    // the rendered block does not end up with a double backslash per line.
    .map((p) => p.replace(/\s*\\\s*$/, '').trim())
    .filter(Boolean);
  return parts.map((p, i) => (i === parts.length - 1 ? p : `${p} \\`));
}

/** One line of the profile's shape, in the operator's shorthand. */
export function profileMeta(p: Profile): string {
  const cfg = p.config as Record<string, unknown>;
  const bits: string[] = [];
  if (p.protocol === 'xray') {
    const sec = String(cfg['security'] ?? '');
    const net = String(cfg['network'] ?? '');
    if (sec === 'reality') bits.push('REALITY');
    else if (sec) bits.push(sec.toUpperCase());
    if (net) bits.push(net);
    if (cfg['realityMode'] === 'self-steal') bits.push('self-steal');
  } else {
    bits.push(p.protocol);
    const method = cfg['method'];
    if (typeof method === 'string') bits.push(method);
  }
  if (p.engine === 'singbox') bits.push('sing-box');
  return bits.filter(Boolean).join(' · ');
}

/** Which hardening switches are on, as one line for the summary table. */
export function hardeningSummary(
  v: { hardenUfw: boolean; hardenFail2ban: boolean; hardenRealisticFallback: boolean; hardenSshAllowlist: string[] },
  t: (k: string) => string,
): string {
  const on: string[] = [];
  if (v.hardenUfw) on.push('ufw');
  if (v.hardenFail2ban) on.push('fail2ban');
  if (v.hardenRealisticFallback) on.push('fallback');
  if (v.hardenSshAllowlist.length > 0) on.push(`ssh-allowlist(${v.hardenSshAllowlist.length})`);
  return on.length > 0 ? on.join(', ') : t('nodeCreate.sumHardeningNone');
}

/**
 * A verdict group: hosts that can land on this node, or hosts that cannot and
 * the reason each is out. The verdict colours the left edge, so the two blocks
 * read apart before a single word is read.
 */
