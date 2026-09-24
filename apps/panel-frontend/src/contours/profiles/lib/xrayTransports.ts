import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import type { SingboxXrayField } from '@/lib/domain/singboxXray';

// Xray stream transports. The whole stack already handles all six (Zod schema,
// node config.go renderer, client URI builder) - this is just the operator-
// facing picker that previously surfaced only raw/xhttp/grpc.
export const XRAY_TRANSPORTS: {
  value: FormValues['xrayNetwork'];
  label: string;
  hint: string;
}[] = [
  { value: 'raw', label: 'raw', hint: 'Plain TCP. Canonical REALITY + Vision, best latency, no CDN.' },
  { value: 'ws', label: 'ws', hint: 'WebSocket. CDN-frontable (Cloudflare etc). Set path + host.' },
  { value: 'grpc', label: 'gRPC', hint: 'HTTP/2 multiplexed. CDN-frontable. Set a serviceName.' },
  { value: 'xhttp', label: 'xhttp', hint: 'Chunked HTTP (ex-SplitHTTP). CDN-frontable, Vision-compatible.' },
  { value: 'httpupgrade', label: 'httpupgrade', hint: 'HTTP Upgrade. WebSocket-like without the WS handshake overhead.' },
  { value: 'kcp', label: 'mKCP', hint: 'UDP-based, resilient on lossy links. Do not share a UDP port with Hysteria/AWG.' },
];

/**
 * What the xray family can be on the sing-box engine: REALITY steal-others
 * over raw, and nothing else. The agent renders it that way only (singbox
 * config.go renderXrayFamilyConfig) and refuses the rest; TLS, none,
 * self-steal and every other transport stay on the xray core. The form
 * offers only this on the sing-box tile, so an operator does not walk into
 * the refusal.
 */
export const SINGBOX_XRAY = { network: 'raw', security: 'reality', realityMode: 'steal-others' } as const;

/**
 * The fields to change so an xray-family form fits the sing-box engine, or
 * {} when it already does (or is not on sing-box). Coming from the xray tile
 * with xhttp or self-steal would otherwise carry them onto a tile that
 * cannot render them.
 */
export function singboxXrayPatch(values: {
  protocol: string;
  engine: 'native' | 'singbox';
  xrayNetwork: string;
  xraySecurity: string;
  xrayRealityMode: string;
}): Partial<Pick<FormValues, 'xrayNetwork' | 'xraySecurity' | 'xrayRealityMode'>> {
  if (values.protocol !== 'xray' || values.engine !== 'singbox') return {};
  return {
    ...(values.xrayNetwork !== SINGBOX_XRAY.network ? { xrayNetwork: SINGBOX_XRAY.network } : {}),
    ...(values.xraySecurity !== SINGBOX_XRAY.security ? { xraySecurity: SINGBOX_XRAY.security } : {}),
    ...(values.xrayRealityMode !== SINGBOX_XRAY.realityMode ? { xrayRealityMode: SINGBOX_XRAY.realityMode } : {}),
  };
}

/** The form field behind each name the server refuses on, so the refusal
 *  lands as an error on the control the operator has to change. */
export const SINGBOX_XRAY_FORM_FIELD: Record<SingboxXrayField, 'xrayNetwork' | 'xraySecurity' | 'xrayRealityMode'> = {
  network: 'xrayNetwork',
  security: 'xraySecurity',
  realityMode: 'xrayRealityMode',
};

// Vision flow is only valid on raw/xhttp; other transports reject it.
export const FLOW_COMPATIBLE_TRANSPORTS = ['raw', 'xhttp'];
// path + host header apply to these transports (same URI param names).
export const PATH_HOST_TRANSPORTS = ['ws', 'xhttp', 'httpupgrade'];
