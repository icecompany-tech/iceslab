/**
 * ISO 3166-1 alpha-2 country code to its flag emoji.
 *
 * A flag emoji is a pair of Regional Indicator Symbols, one per letter, at
 * U+1F1E6 + (letter - 'A'). No table needed, and it works for codes we have
 * never heard of.
 *
 * Used in the server names a client displays. The panel's own "what people see"
 * preview has always shown the flag; until 2026-07-30 the subscription itself
 * did not, so the preview and the client disagreed.
 */
const REGIONAL_INDICATOR_A = 0x1f1e6;
const LETTER_A = 'A'.charCodeAt(0);

export function countryFlag(code: string | null | undefined): string {
  if (!code) return '';
  const upper = code.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(upper)) return '';
  return String.fromCodePoint(
    REGIONAL_INDICATOR_A + (upper.charCodeAt(0) - LETTER_A),
    REGIONAL_INDICATOR_A + (upper.charCodeAt(1) - LETTER_A),
  );
}

/**
 * The line a user reads in their client.
 *
 * A host's own name wins outright: it is the thing the operator wrote for
 * people to read, and repeating the internal node name in front of it ("ru-test1
 * · Ru-xhttp-reality") tells the user nothing they can act on. The node name is
 * the fallback for a host that was never named, which is what the auto-created
 * `Default` host is.
 *
 * The flag goes first because clients sort and truncate by this string, and a
 * leading flag survives truncation while a trailing one does not.
 */
export function subscriptionServerName(opts: {
  hostRemark?: string | null;
  nodeName: string;
  countryCode?: string | null;
}): string {
  const named = opts.hostRemark && opts.hostRemark !== 'Default' ? opts.hostRemark : opts.nodeName;
  const flag = countryFlag(opts.countryCode);
  return flag ? `${flag} ${named}` : named;
}

/**
 * The line a client shows for one way out of a cascade.
 *
 * What a subscriber picks here is a COUNTRY to leave from, so that is what the
 * label leads with. Until 2026-07-30 it read `se-01 · ru-01-xhttp-reality`,
 * gluing two of our internal names together: the exit machine and the host on
 * the entry the traffic happened to arrive through. Neither is a thing the
 * person choosing has an opinion about.
 *
 * The exit node name survives only as the fallback for a node with no country
 * set, where it is the sole thing distinguishing one way out from another.
 */
/**
 * The line a client shows for the AUTO way out: no country named, the entry
 * picks the fastest exit it can measure.
 *
 * Same shape as the per-direction label so the two sort together in a client
 * list, with a symbol in the flag's place: something has to occupy that column,
 * or the Auto row loses its left edge and stops looking like a sibling of the
 * rows above it. "Auto" stays in English deliberately: it is the word the
 * clients themselves use for this, in every locale.
 */
export function cascadeAutoProfileLabel(cascadeName: string): string {
  return `⚡ ${cascadeName} → Auto`;
}

export function cascadeProfileLabel(
  cascadeName: string,
  exitCountryCode: string | null | undefined,
  exitNodeName: string,
): string {
  const flag = countryFlag(exitCountryCode);
  // An arrow, not a separator dot. The first half is the cascade's NAME, which
  // an operator usually takes from where the traffic ENTERS, and the second is
  // where it leaves. Written as "ru · NL" that reads as "ru via NL", i.e.
  // backwards, and it was read that way the first time an operator saw it.
  if (!flag) return `${cascadeName} → ${exitNodeName}`;
  return `${flag} ${cascadeName} → ${exitCountryCode!.toUpperCase()}`;
}
