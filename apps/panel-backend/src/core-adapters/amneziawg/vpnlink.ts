import { deflateSync } from 'node:zlib';
import {
  buildAmneziawgClientConfig,
  type AmneziawgClientConfigOpts,
} from './wgconf.js';

/**
 * AmneziaVPN "vpn://" connection-key builder for an AmneziaWG tunnel.
 *
 * The AmneziaVPN app (the flagship, NOT the standalone AmneziaWG app) scans a
 * QR that encodes its own connection key starting with `vpn://`, never a raw
 * wg-quick .conf. Generating one lets that QR import directly.
 *
 * Format (verified against amnezia-client exportController.cpp + two working
 * third-party encoders):
 *
 *   JSON object (minified utf8)
 *     -> Qt qCompress: 4-byte BIG-ENDIAN uncompressed length, then zlib level 8
 *     -> base64url, NO padding
 *     -> prefix "vpn://"
 *
 * The 4-byte length prefix is the #1 gotcha: Qt's qUncompress rejects a bare
 * zlib stream, and a missing/empty container envelope both surface as the app's
 * "error 900" (ImportInvalidConfigError). Node's zlib emits a correct zlib
 * stream (right adler32), so the browser-CompressionStream adler32 patch others
 * need does NOT apply here.
 *
 * Sources:
 *   amnezia-client exportController.cpp (qCompress(json, 8) + Base64UrlEncoding
 *   | OmitTrailingEquals), configKeys.h (the literal JSON keys), and the
 *   andr13/amnezia-config-decoder + auswuchs/awg-converter reference encoders.
 */

// Container-type literal. `amnezia-awg` is the canonical string in Amnezia's
// own configKeys.h and what the app's export/import round-trips. The app tags a
// plain `amnezia-awg` config "AmneziaWG Legacy" UNLESS isThirdPartyConfig is set
// (both display checks - containersModel.cpp + serverDescription.cpp - are gated
// on `&& !isThirdPartyConfig`); we set that flag below. It is accurate (this is
// an externally generated config) and removes the deprecation nag while keeping
// the v1 wire protocol our amneziawg-go / kernel nodes actually speak (a real
// AWG handshake completes - verified in the app log). `amnezia-awg2` is genuine
// AmneziaWG 2.0 (ranged H1-H4 + active S3/S4) and would need a node-side core
// upgrade + regenerated peers, so do NOT switch to it for our v1 nodes.
const AWG_CONTAINER = 'amnezia-awg';

export interface AmneziaVpnLinkOpts extends AmneziawgClientConfigOpts {
  /** Optional preshared key. Empty when the inbound uses none (our default). */
  pskKey?: string;
  /** Display name shown in the AmneziaVPN app. */
  description?: string;
}

/**
 * Encode any config object into a `vpn://` key. Minified JSON -> 4-byte BE
 * uncompressed-length header + zlib(level 8) (Qt qCompress) -> base64url
 * (no padding) -> "vpn://".
 */
export function encodeAmneziaVpnKey(config: unknown): string {
  const json = Buffer.from(JSON.stringify(config), 'utf8');
  const header = Buffer.alloc(4);
  header.writeUInt32BE(json.length, 0); // uncompressed length, big-endian
  const compressed = deflateSync(json, { level: 8 });
  return 'vpn://' + Buffer.concat([header, compressed]).toString('base64url');
}

export function buildAmneziaVpnLink(opts: AmneziaVpnLinkOpts): string {
  // The full wg-quick text drives the tunnel; the structured fields mirror it
  // so the app can populate its UI and reconnect.
  const conf = buildAmneziawgClientConfig(opts);
  const allowed = opts.clientAllowedIps?.length ? opts.clientAllowedIps : ['0.0.0.0/0', '::/0'];

  // Obfuscation params as strings (the app serializes them as JSON strings),
  // inside last_config only. CRITICAL: on connect every AmneziaVPN client
  // builds the tunnel from these structured keys and ignores the embedded .conf
  // text (docs/plan/amnezia-key-recon.md, section 3), and releases before the
  // current one treated an empty string as "present" - so emitting I1="".."I5=""
  // injected blank `I1 = ` lines that broke the AmneziaWG handshake. THIS is why
  // the key imported but would not connect while the raw .conf (which omits
  // empty I-fields) did. Mirror buildWgQuickConf: emit I-fields ONLY when
  // non-empty, and S3/S4 only when non-zero (below).
  const obf: Record<string, string> = {
    Jc: String(opts.jc),
    Jmin: String(opts.jmin),
    Jmax: String(opts.jmax),
    S1: String(opts.s1),
    S2: String(opts.s2),
    H1: String(opts.h1),
    H2: String(opts.h2),
    H3: String(opts.h3),
    H4: String(opts.h4),
  };
  // S3/S4 are AmneziaWG 2.0 additions, emitted ONLY when non-zero. The
  // AmneziaVPN iOS network extension (checked on 4.8.19) cannot parse the
  // S3/S4 keys at all, even at 0: it aborts with ParseError 9 and the tunnel
  // never starts. Omitting them leaves a 1.x-shaped config every client
  // accepts. This supersedes the earlier note that S3/S4 could stay at 0,
  // which held on desktop and Android but not on iOS.
  if (opts.s3) obf.S3 = String(opts.s3);
  if (opts.s4) obf.S4 = String(opts.s4);
  [opts.i1, opts.i2, opts.i3, opts.i4, opts.i5].forEach((v, idx) => {
    if (v && v.length > 0) obf[`I${idx + 1}`] = v;
  });

  // Inner client config, DOUBLE-encoded (a stringified JSON), per the app's
  // AwgProtocolConfig::toJson. Only what a client reads (amnezia-client 94b51df,
  // docs/plan/amnezia-key-recon.md):
  //   - the connection fields every platform builds the tunnel from; Android
  //     requires client_ip, allowed_ips (array), hostName, port (number),
  //     client_priv_key, server_pub_key;
  //   - `config`, the .conf text: the tunnel does not use it, but the app's
  //     client-settings page for the protocol opens only when it is non-empty,
  //     and that page is where a person reads their Jc/S/H while working out why
  //     a tunnel does not come up.
  // Left out on purpose: `mtu` (the import overwrites it with the app's own
  // default, importController.cpp:775-776), `isThirdPartyConfig` (read at the awg
  // level only), and the empty `clientId` / `client_pub_key`.
  const lastConfig: Record<string, unknown> = {
    ...obf,
    allowed_ips: allowed,
    client_ip: opts.allowedIp,
    client_priv_key: opts.privateKey,
    config: conf,
    hostName: opts.host,
    persistent_keep_alive: String(opts.persistentKeepalive ?? 25),
    port: opts.port,
    server_pub_key: opts.serverPublicKey,
  };
  // Same rule as the empty I-fields: emit psk_key ONLY for a real preshared
  // key. An empty one made the app rebuild a blank `PresharedKey = ` line into
  // the [Interface], which the iOS parser rejects.
  if (opts.pskKey) lastConfig.psk_key = opts.pskKey;

  // The awg (server) level carries no copy of the obfuscation params: the
  // connection reads last_config only, and the app uses the server copy just to
  // label the protocol version, which is empty for 1.x either way
  // (serverDescription.cpp:67-71).
  const awg = {
    // Suppresses the "AmneziaWG Legacy" label/nag (see AWG_CONTAINER note). Read
    // at this level only (AwgServerConfig, awgProtocolConfig.cpp:203); the client
    // part of the key does not parse it.
    isThirdPartyConfig: true,
    last_config: JSON.stringify(lastConfig),
    port: String(opts.port),
    transport_proto: 'udp',
  };

  // Outer envelope. containers[] + defaultContainer are the required structure;
  // without them the app reports "config does not contain containers" (error 900).
  const envelope: Record<string, unknown> = {
    containers: [{ awg, container: AWG_CONTAINER }],
    defaultContainer: AWG_CONTAINER,
    description: opts.description ?? `AmneziaWG ${opts.host}`,
    hostName: opts.host,
  };
  if (opts.dns?.[0]) envelope.dns1 = opts.dns[0];
  if (opts.dns?.[1]) envelope.dns2 = opts.dns[1];

  return encodeAmneziaVpnKey(envelope);
}
