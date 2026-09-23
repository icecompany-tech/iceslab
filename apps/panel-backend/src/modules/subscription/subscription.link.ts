import { config, subscriptionOrigin } from '../../config.js';
import { getSubscriptionSettings } from '../settings/settings.service.js';

/**
 * The origin every subscription link is printed on.
 *
 * The panel-settable host wins over the environment: an operator who moves
 * /sub to its own domain should not need a redeploy to make the panel say so.
 * Falls back to subscriptionOrigin(), which is SUBSCRIPTION_PUBLIC_URL or the
 * panel's own URL, exactly as before.
 *
 * Scheme is always https here: the host field stores a bare host, and there is
 * no case for handing subscribers a plaintext link.
 *
 * Its own module because the public page and the panel's endpoint list both
 * print links, and two copies of this rule are how one of them keeps printing
 * the old domain after the operator moved it.
 */
export async function subscriptionLinkOrigin(): Promise<string> {
  const { publicHost } = await getSubscriptionSettings();
  return publicHost ? `https://${publicHost}` : subscriptionOrigin();
}

/** The public subscription URL of a token, as the subscriber is given it. */
export async function subscriptionUrl(token: string): Promise<string> {
  return `${await subscriptionLinkOrigin()}${config.SUBSCRIPTION_PATH_PREFIX}/${token}`;
}

/**
 * The link to ONE node's AmneziaWG config.
 *
 * AmneziaWG has no URI scheme: a client takes a file, one [Interface] per file.
 * The wgconf format picks the node by `node=`, matched against the endpoint's
 * `nodeName` EXACTLY (formats/wgconf.ts), so the name passed here must be the
 * one the endpoint carries, flag and dedupe suffix included, not the node row's
 * name. The same shape the public page links to.
 */
export function awgConfUrl(subUrl: string, nodeName: string): string {
  return `${subUrl}?format=wgconf&node=${encodeURIComponent(nodeName)}`;
}
