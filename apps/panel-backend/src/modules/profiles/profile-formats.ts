import {
  FORMAT_NAMES,
  PROTOCOL_NAMES,
  doorOf,
  formatCarries,
  type Door,
  type FormatWhy,
  type ProtocolName,
  type SubscriptionFormat,
  type XraySubprotocol,
} from '@iceslab/shared';

/**
 * Which subscription formats carry a profile's door, and why not where they
 * do not: GET /api/profiles/:id/formats. The host screen draws its per-format
 * switches from it, so a switch for a format that never carries this profile
 * reads as such instead of being a toggle that changes nothing.
 *
 * Read from FORMAT_DOORS through formatCarries, the same function the
 * subscription gate uses (endpointsForFormat), so the screen and the file a
 * client receives are one decision.
 */
export interface ProfileFormat {
  format: SubscriptionFormat;
  carried: boolean;
  why: FormatWhy;
}

export interface ProfileFormats {
  door: Door;
  formats: ProfileFormat[];
}

type SecurityLayer = 'default' | 'tls' | 'none';

/**
 * The security layer a client sees on this profile's endpoints, the way the
 * subscription service works it out: a host override of tls/none wins, else
 * the profile's own (reality is 'default'), and vmess never rides REALITY.
 */
export function clientSecurityLayer(
  config: unknown,
  hostOverride?: SecurityLayer | null,
): SecurityLayer {
  const cfg = (config ?? {}) as { security?: string; subprotocol?: string };
  let layer: SecurityLayer =
    hostOverride === 'tls' || hostOverride === 'none'
      ? hostOverride
      : cfg.security === 'none'
        ? 'none'
        : cfg.security === 'tls'
          ? 'tls'
          : 'default';
  if (cfg.subprotocol === 'vmess' && layer === 'default') layer = 'none';
  return layer;
}

export function profileFormats(
  storedProtocol: string,
  config: unknown,
  hostOverride?: SecurityLayer | null,
): ProfileFormats {
  // The column is a string; the schema only ever writes a ProtocolName.
  if (!(PROTOCOL_NAMES as readonly string[]).includes(storedProtocol)) {
    throw new Error(`profile protocol "${storedProtocol}" is not one this panel knows`);
  }
  const protocol = storedProtocol as ProtocolName;
  const sub = (config as { subprotocol?: XraySubprotocol } | null)?.subprotocol;
  const door = doorOf({ protocol, subprotocol: protocol === 'xray' ? sub : undefined });
  const security = protocol === 'xray' ? clientSecurityLayer(config, hostOverride) : undefined;
  // The cipher decides Outline (no 2022-blake3 there); absent, formatCarries
  // answers as carried.
  const ssMethod =
    protocol === 'shadowsocks' ? (config as { method?: string } | null)?.method : undefined;
  return {
    door,
    formats: FORMAT_NAMES.map((format) => ({ format, ...formatCarries(format, door, security, ssMethod) })),
  };
}
