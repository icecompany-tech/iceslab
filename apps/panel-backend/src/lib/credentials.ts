import { randomBytes, randomUUID, generateKeyPairSync, createHash } from 'node:crypto';

/**
 * Random URL-safe string of approximately N*4/3 characters.
 * Uses base64url (no '+', '/', or padding).
 */
function randomUrlSafe(byteLength: number): string {
  return randomBytes(byteLength).toString('base64url');
}

/**
 * Generate a raw Curve25519 (X25519) keypair as 32-byte buffers. Node exports
 * X25519 keys in DER (PKCS8 for private, SPKI for public). The actual 32-byte
 * key sits at the END of the DER blob — slice the last 32.
 */
function generateX25519Raw() {
  const { publicKey, privateKey } = generateKeyPairSync('x25519');
  const privDer = privateKey.export({ format: 'der', type: 'pkcs8' });
  const pubDer = publicKey.export({ format: 'der', type: 'spki' });
  return {
    privateKey: privDer.subarray(privDer.length - 32),
    publicKey: pubDer.subarray(pubDer.length - 32),
  };
}

/**
 * Curve25519 keypair as **standard base64** (with `+`/`/`, padded). Used by
 * WireGuard / AmneziaWG — matches `wg genkey` output, kernel module accepts.
 */
export function generateWireguardKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateX25519Raw();
  return {
    privateKey: privateKey.toString('base64'),
    publicKey: publicKey.toString('base64'),
  };
}

/**
 * Curve25519 keypair as **base64url** (`-`/`_`, no padding). Used by Xray
 * REALITY — `xray x25519` produces this form. The Xray config validator
 * rejects standard base64 (caught on VPS during slice-23 test on 2026-05-06).
 */
export function generateRealityKeyPair(): {
  privateKey: string;
  publicKey: string;
} {
  const { privateKey, publicKey } = generateX25519Raw();
  return {
    privateKey: privateKey.toString('base64url'),
    publicKey: publicKey.toString('base64url'),
  };
}

/**
 * All credentials/identifiers generated when creating a new user.
 */
export interface UserCredentials {
  hysteriaPassword: string;
  naivePassword: string;
  xrayUuid: string;
  amneziawgPrivateKey: string;
  amneziawgPublicKey: string;
  subscriptionToken: string;
  shortId: string;
}

export function generateUserCredentials(): UserCredentials {
  const wg = generateWireguardKeyPair();

  return {
    hysteriaPassword:    randomUrlSafe(24),  // ~32 chars
    naivePassword:       randomUrlSafe(24),  // ~32 chars
    xrayUuid:            randomUUID(),
    amneziawgPrivateKey: wg.privateKey,
    amneziawgPublicKey:  wg.publicKey,
    subscriptionToken:   randomUrlSafe(32),  // ~43 chars
    // REALITY shortIds must be hex (the Xray validator + adapter reject
    // base64url's '-', '_' and mixed case). 8 bytes -> 16 hex chars, the max
    // shortId length REALITY allows.
    shortId:             randomBytes(8).toString('hex'), // 16 hex chars
  };
}

/**
 * Fresh subscription token, same shape/entropy as the one minted at user
 * creation (~43 base64url chars). Used by rotate-subscription to kill a leaked
 * link and issue a new one.
 */
export function generateSubscriptionToken(): string {
  return randomUrlSafe(32);
}

/**
 * Deterministic per-user TUIC password derived from the user's existing UUID.
 * TUIC needs uuid + password; we reuse `xrayUuid` as the uuid and derive the
 * password here rather than adding a DB column (same "don't grow the credential
 * surface" approach as Shadowsocks/Mieru). The node receives it on the wire and
 * the subscription generator derives the identical value, so both stay in sync.
 */
export function deriveTuicPassword(xrayUuid: string): string {
  return createHash('sha256').update(`${xrayUuid}:tuic`).digest('base64url');
}