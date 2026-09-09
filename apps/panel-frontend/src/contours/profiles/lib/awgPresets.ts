// Values bounded by upstream AmneziaWG v2.0 spec (docs.amnezia.org):
//   - Jc 0..10, Jmin/Jmax 64..1024, S1-S3 0..64, S4 0..32
//
// S3 and S4 forced to ZERO due to upstream bug
// https://github.com/amnezia-vpn/amnezia-client/issues/2582 -
// AmneziaVPN client 4.8.15.x (Android + iOS, awg-go v0.2.16 under
// the hood) DROPS all transport traffic when server has non-zero
// S3/S4. Connection reaches "CONNECTED" state but handshake retries
// forever and zero bytes flow. Bug open since Feb 2026, claimed
// fixed in 4.8.12.9 but persisted into 4.8.15.5. Reproduced live
// on iOS 26.4 client cycle #6 2026-05-13 with our awg-VPS - same
// "Connected, but no traffic, handshake retries every 5s" symptom.
// Workaround: server must set S3=0 S4=0. Lift these defaults to
// non-zero again when upstream fixes the client.
//
// S1 and S2 stay non-zero - they were in AmneziaWG since v1.5, the
// bug only affects the v2.0-added S3+S4 fields. Junk-packet (Jc)
// obfuscation also remains active.
export const TSPU_PRESET = { jc: 4, jmin: 64, jmax: 128, s1: 32, s2: 56, s3: 0, s4: 0 };
export const MOBILE_PRESET = { jc: 3, jmin: 64, jmax: 100, s1: 32, s2: 56, s3: 0, s4: 0 };

/**
 * AmneziaWG H1-H4 magic-header bytes. Spec says they must be:
 *   - strictly > 4 (1-4 are reserved for actual WireGuard message types)
 *   - pairwise distinct (otherwise DPI sees repeated patterns)
 *   - random in int32 range so they don't fingerprint Iceslab deployments
 *
 * Replaces the previous "run `shuf -i 5-2147483647 -n 4` yourself" admin
 * hint - admin shouldn't need a shell to set up obfuscation.
 */
export function randomAwgHeaders(): { h1: number; h2: number; h3: number; h4: number } {
  const seen = new Set<number>();
  const vals: number[] = [];
  while (vals.length < 4) {
    // Math.random() floors to int32 max ≈ 2.14e9. Skip 1-4 as required.
    const n = 5 + Math.floor(Math.random() * (2_147_483_643 - 5));
    if (!seen.has(n)) {
      seen.add(n);
      vals.push(n);
    }
  }
  return { h1: vals[0]!, h2: vals[1]!, h3: vals[2]!, h4: vals[3]! };
}
