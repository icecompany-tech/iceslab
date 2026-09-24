/**
 * What a REALITY listener can relay of its camouflage target, E23.
 *
 * The listener forwards the target's first flight and gives up on any
 * handshake record longer than this, the 5-byte record header included:
 *   - sing-box 1.13.14 runs metacubex/utls v1.8.4: `realitySize = 8192` at
 *     reality.go:72, checked at reality.go:473;
 *   - xray 26.3.27 pins xtls/reality v0.0.0-20260322125925-9234c772ba8f:
 *     `size = 8192` at tls.go:140, checked at tls.go:334.
 * Upstream xtls/reality raised it to 17 KiB after that; neither pinned engine
 * has it. A target over the limit passes every other check (resolves, TLS 1.3,
 * h2) and not one handshake completes: www.microsoft.com sends its Certificate
 * as one 8273-byte record.
 *
 * One number for the panel's dest probe and the screen that shows it; moving
 * a pin past either anchor is the day to revisit it.
 */
export const REALITY_RECORD_LIMIT = 8192;

/**
 * Targets measured to pass with room to spare, named when one is refused.
 * Measured 2026-09-24 with the panel's own dest probe (the ClientHello asks
 * for the OCSP staple and SCTs, as browser fingerprints do): www.apple.com
 * 4738, www.samsung.com 4700, www.cloudflare.com about 2.7K in one record.
 */
export const REALITY_TARGET_SUGGESTIONS = ['www.apple.com', 'www.samsung.com', 'www.cloudflare.com'] as const;
