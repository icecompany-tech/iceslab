import type { NodeProtocol } from '@/lib/domain/nodes';
export interface FormValues {
  name: string;
  host: string;
  port: number | '';
  protocol: NodeProtocol;
  countryCode: string;
  consumptionMultiplier: number | '';
  domain: string;
  singboxEngine: boolean;
  hardenUfw: boolean;
  hardenFail2ban: boolean;
  hardenRealisticFallback: boolean;
  hardenSshAllowlist: string[];
}

// Listen ports handed to new hosts, in preference order. Mirrors the backend's
// CANDIDATE_PORTS so the ports promised here are the ports actually bound.
export const CANDIDATE_PORTS = [443, 8443, 2053, 2083, 2087, 2096];

/** Next candidate port not already handed to another host on this node. */
export function pickFreePort(used: number[]): number {
  const taken = new Set(used);
  for (const p of CANDIDATE_PORTS) if (!taken.has(p)) return p;
  for (let p = 20000; p <= 65000; p++) if (!taken.has(p)) return p;
  return 443;
}

/** What the third step needs to remember about the node it just registered. */
export interface Registered {
  id: string;
  name: string;
  address: string;
  token: string;
  expiresAt: string;
  command: string;
  payload: string;
  /** Profile name and port per host that was attached, for the timeline. */
  hosts: { name: string; port: number }[];
}

