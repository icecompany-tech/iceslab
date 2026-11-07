const UINT32_RANGE = 2 ** 32
const BYTE_RANGE = 256
const TOKEN_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789'

/**
 * Key material and values that must not fingerprint a deployment: only crypto.getRandomValues.
 * A draw past the last whole multiple of the range is thrown away, so no value comes up more often.
 */
export function randomInt(min: number, maxExclusive: number): number {
  const span = maxExclusive - min
  const limit = UINT32_RANGE - (UINT32_RANGE % span)
  const draw = new Uint32Array(1)
  for (;;) {
    crypto.getRandomValues(draw)
    const value = draw[0] ?? limit
    if (value < limit) return min + (value % span)
  }
}

export function randomToken(length: number): string {
  const limit = BYTE_RANGE - (BYTE_RANGE % TOKEN_ALPHABET.length)
  const draw = new Uint8Array(1)
  let token = ''
  while (token.length < length) {
    crypto.getRandomValues(draw)
    const value = draw[0] ?? limit
    if (value < limit) token += TOKEN_ALPHABET.charAt(value % TOKEN_ALPHABET.length)
  }
  return token
}
