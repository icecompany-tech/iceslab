/**
 * Hysteria 2 URI builder. The wire format is consumed directly by Hiddify,
 * NekoRay, v2rayN, the upstream `hysteria` client, and IcePath-VPN.
 *
 * Slice 16: minimal builder (host:port + password + name fragment).
 * Slice 17 (inbounds CRUD) will extend with SNI / obfs / insecure / pinSHA256
 * once inbounds carry per-instance config.
 */

export interface HysteriaUriOpts {
  password: string;
  /** Host portion only, port is supplied separately so callers can split
   *  the control-plane port (panel↔node mTLS) from the client-facing UDP. */
  host: string;
  /** Public Hysteria2 UDP port the client connects to. */
  port: number;
  /** URL fragment shown in clients (typically the node name). */
  name: string;
  /** Salamander obfuscation password. When set, emitted as `obfs=salamander`
   *  + `obfs-password=...` query params. Critical on RU/IR/CN ISPs where
   *  bare QUIC is throttled or dropped by DPI mid-session. */
  obfsPassword?: string;
  /** Brutal CC bandwidth declaration in Mbps, required for the Hysteria
   *  client to negotiate a non-zero send window. Without these, Brutal
   *  picks 0 and the tunnel handshakes successfully but `tx=0` for every
   *  request, exact "connected but no traffic" symptom. Cycle #5 ground
   *  truth. Defaults are tuned for residential broadband; admins can
   *  override per binding when the node is on a faster/slower link. */
  upMbps?: number;
  downMbps?: number;
  /** Port-hopping range (slice 31.5). When set, emits `mport=START-END` so
   *  clients rotate destination UDP port within the range. Server-side
   *  must have iptables UDP REDIRECT in place over the same range pointing
   *  at the actual listen port, install-iceslab-node.sh handles that. Defeats
   *  fixed-port UDP throttle on RU TSPU / IR / CN ISPs. */
  portHoppingStart?: number;
  portHoppingEnd?: number;
}

export function buildHysteriaUri(opts: HysteriaUriOpts): string {
  // Hiddify's outbound parser was failing on bare `hysteria2://...:443/#name`
  // ("Unknown parse outbound") on 2026-05-06. Adding an explicit `sni` query
  // param fixes it, even when SNI matches host (which Hysteria infers
  // automatically), some clients want it spelled out.
  const params = new URLSearchParams();
  params.set('sni', opts.host);
  if (opts.obfsPassword) {
    params.set('obfs', 'salamander');
    params.set('obfs-password', opts.obfsPassword);
  }
  // Brutal CC bandwidth, see HysteriaUriOpts.upMbps comment. Default
  // 50/100 if caller didn't specify so we never emit a 0-window URI.
  params.set('upmbps', String(opts.upMbps ?? 50));
  params.set('downmbps', String(opts.downMbps ?? 100));
  // Slice 31.5: port-hopping. `mport` is the parameter Hiddify / sing-box /
  // NekoBox honour (mihomo accepts the same form via a `ports:` field
  // emitted separately by the Clash formatter). Wire form is `START-END`.
  if (
    typeof opts.portHoppingStart === 'number' &&
    typeof opts.portHoppingEnd === 'number'
  ) {
    params.set('mport', `${opts.portHoppingStart}-${opts.portHoppingEnd}`);
  }
  return `hysteria2://${encodeURIComponent(opts.password)}@${opts.host}:${opts.port}/?${params.toString()}#${encodeURIComponent(opts.name)}`;
}
