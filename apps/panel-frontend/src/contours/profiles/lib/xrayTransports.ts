import type { FormValues } from '@/contours/profiles/lib/profileFormValues';

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

// Vision flow is only valid on raw/xhttp; other transports reject it.
export const FLOW_COMPATIBLE_TRANSPORTS = ['raw', 'xhttp'];
// path + host header apply to these transports (same URI param names).
export const PATH_HOST_TRANSPORTS = ['ws', 'xhttp', 'httpupgrade'];
