import type { FormValues } from '@/contours/profiles/lib/profileFormValues';
import type { SingboxXrayField } from '@/lib/old/singboxXray';

// Xray stream transports the operator picks from.
export const XRAY_TRANSPORTS: {
  value: FormValues['xrayNetwork'];
  label: string;
}[] = [
  { value: 'raw', label: 'raw' },
  { value: 'ws', label: 'ws' },
  { value: 'grpc', label: 'gRPC' },
  { value: 'xhttp', label: 'xhttp' },
  { value: 'httpupgrade', label: 'httpupgrade' },
  { value: 'kcp', label: 'mKCP' },
];

/**
 * mKCP is not offered: the agent renders it with a `header` the pinned xray refuses (ARCH 07.11), so
 * the profile would not come up on a node. A profile already on it, stored or brought by someone
 * else's recipe, still shows it as it is, next to the sentence saying so.
 */
export function transportsFor(stored: unknown, current: FormValues['xrayNetwork']): typeof XRAY_TRANSPORTS {
  return XRAY_TRANSPORTS.filter((t) => t.value !== 'kcp' || stored === 'kcp' || current === 'kcp');
}

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
export const SINGBOX_XRAY_FORM_FIELD: Record<
  SingboxXrayField,
  'xrayNetwork' | 'xraySecurity' | 'xrayRealityMode' | 'xrayServerNames'
> = {
  network: 'xrayNetwork',
  security: 'xraySecurity',
  realityMode: 'xrayRealityMode',
  realityServerNames: 'xrayServerNames',
};

// Vision flow is only valid on raw/xhttp; other transports reject it.
export const FLOW_COMPATIBLE_TRANSPORTS = ['raw', 'xhttp'];
// path + host header apply to these transports (same URI param names).
export const PATH_HOST_TRANSPORTS = ['ws', 'xhttp', 'httpupgrade'];
