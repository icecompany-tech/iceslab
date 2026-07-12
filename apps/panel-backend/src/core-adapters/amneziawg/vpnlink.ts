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
  /** Client MTU written into the structured block. Default 1280. */
  mtu?: number;
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
  // present both at the awg-server level and inside last_config. CRITICAL: on
  // connect the AmneziaVPN daemon REBUILDS the [Interface] from these structured
  // keys (it ignores the embedded .conf text), and it treats an empty string as
  // "present" - so emitting I1="".."I5="" injects blank `I1 = ` lines that break
  // the AmneziaWG handshake. THIS is why the key imported but would not connect
  // while the raw .conf (which omits empty I-fields) did. Mirror buildWgQuickConf:
  // emit I-fields ONLY when non-empty. S1-S4 stay (the working .conf carries
  // S3/S4 even at 0).
  const obf: Record<string, string> = {
    Jc: String(opts.jc),
    Jmin: String(opts.jmin),
    Jmax: String(opts.jmax),
    S1: String(opts.s1),
    S2: String(opts.s2),
  };
  // S3/S4 are AmneziaWG 2.0 additions. The AmneziaVPN iOS network-extension
  // parser (verified on 4.8.19 / iOS 26) can't parse the S3/S4 keys AT ALL —
  // even S3=0/S4=0 → TunnelConfiguration.ParseError code 9, connection never
  // starts. So only emit them for a real 2.0 config (non-zero); otherwise omit
  // so the 1.x-only NE parser accepts the config. (Same reason empty I-fields
  // are omitted below.) Confirmed live: dropping S3/S4=0 + the empty PSK made
  // the exact config connect on iOS.
  if (opts.s3) obf.S3 = String(opts.s3);
  if (opts.s4) obf.S4 = String(opts.s4);
  obf.H1 = String(opts.h1);
  obf.H2 = String(opts.h2);
  obf.H3 = String(opts.h3);
  obf.H4 = String(opts.h4);
  [opts.i1, opts.i2, opts.i3, opts.i4, opts.i5].forEach((v, idx) => {
    if (v && v.length > 0) obf[`I${idx + 1}`] = v;
  });

  // Inner client config. `config` (the .conf text) is required; an empty one is
  // the schema half of "error 900". last_config is DOUBLE-encoded (a stringified
  // JSON), per the app's AwgProtocolConfig::toJson.
  const lastConfig: Record<string, unknown> = {
    ...obf,
    allowed_ips: allowed,
    clientId: '',
    client_ip: opts.allowedIp,
    client_priv_key: opts.privateKey,
    client_pub_key: '',
    config: conf,
    hostName: opts.host,
    isThirdPartyConfig: true,
    mtu: String(opts.mtu ?? 1280),
    persistent_keep_alive: String(opts.persistentKeepalive ?? 25),
    port: opts.port,
    server_pub_key: opts.serverPublicKey,
  };
  // Emit psk_key ONLY when there's a real preshared key. An empty psk_key made
  // the app rebuild `PresharedKey = ` (empty) into the [Interface], which the
  // iOS NE parser rejects (ParseError 9). Omit → no PresharedKey line.
  if (opts.pskKey) lastConfig.psk_key = opts.pskKey;

  const awg = {
    ...obf,
    // Suppresses the "AmneziaWG Legacy" label/nag (see AWG_CONTAINER note). Set
    // at both the awg-container level (where serverDescription reads it) and
    // inside last_config, since the app parses isThirdPartyConfig from both.
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
