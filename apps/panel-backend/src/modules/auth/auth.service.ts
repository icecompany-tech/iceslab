import bcrypt from 'bcrypt';
import type { AdminUser } from '../../generated/prisma/client.js';
import {
  findAdminByUsername,
  verifyPassword,
  recordTotpStep,
} from '../admin/admin.service.js';
import type { LoginInput } from './auth.schemas.js';
import { redis } from '../../lib/redis.js';
import { config } from '../../config.js';
import { verifyTotpStep } from '../../lib/totp.js';

// Constant-work mitigation for username enumeration. When the username does
// not exist we skip the real bcrypt.compare, so the not-found branch returns
// in ~0ms while a real account spends ~250ms hashing (cost 12, see
// admin.service BCRYPT_COST). That timing gap is an oracle: an attacker can
// tell valid usernames from invalid ones. To close it we run a throwaway
// bcrypt.compare against this fixed, valid $2b$12$ hash on the not-found
// branch so both paths burn comparable CPU before failing identically.
// The plaintext behind this hash is irrelevant, the compare always fails;
// only the cost factor (12) matters and must match admin.service BCRYPT_COST.
const DUMMY_HASH = '$2b$12$C6UzMDM.H6dfI/f/IKcEeO3jKxHnL9Q8vLpJ9wq0r0aYzX1tVbW3K';

export class InvalidCredentialsError extends Error {
  constructor() {
    super('Invalid username or password');
    this.name = 'InvalidCredentialsError';
  }
}

export class AccountLockedError extends Error {
  constructor(public retryAfterSeconds: number) {
    super(`Account temporarily locked. Retry in ~${retryAfterSeconds}s`);
    this.name = 'AccountLockedError';
  }
}

// K8 - the admin has 2FA enabled but didn't supply a code yet. The route turns
// this into a non-fatal "now ask for the code" response, NOT a credentials
// error (password was already validated at this point).
export class TotpRequiredError extends Error {
  constructor() {
    super('Two-factor code required');
    this.name = 'TotpRequiredError';
  }
}

// K8 - 2FA enabled and a code was supplied but it didn't verify.
export class InvalidTotpError extends Error {
  constructor() {
    super('Invalid two-factor code');
    this.name = 'InvalidTotpError';
  }
}

// Wave-13 (2026-05-21) - per-(IP + username) scope. Pre-wave the key was
// username-only, so any bot doing 5 fails against `admin` locked the real
// admin out for the lockout window. Confirmed live on 2026-05-19→20 when a
// distributed brute from 4 IPs locked the operator out for 17 minutes.
//
// Per-IP Fastify rate-limit (5/min on /api/auth/login) is still the first
// line; this layer extends it across longer windows. Threat-model trade:
// a botnet that rotates IPs per request bypasses both layers, addressed
// separately by fail2ban on the host (install-iceslab.sh) and by Caddy
// front-door filtering of obvious probe patterns.
//
// `unknown` slot for clientIp covers tests + future code paths that
// genuinely don't have a request context. Treating empty IP as a distinct
// bucket means "no-IP attempts" still rate-limit themselves coherently.
const FAIL_KEY = (clientIp: string, username: string): string =>
  `auth:fail:${clientIp || 'unknown'}:${username.toLowerCase()}`;

async function checkLocked(clientIp: string, username: string): Promise<void> {
  const key = FAIL_KEY(clientIp, username);
  const current = await redis.get(key);
  if (current === null) return;
  const count = Number.parseInt(current, 10);
  if (Number.isFinite(count) && count >= config.LOGIN_LOCKOUT_FAILURES) {
    const ttl = await redis.ttl(key);
    throw new AccountLockedError(ttl > 0 ? ttl : 60);
  }
}

async function recordFailure(clientIp: string, username: string): Promise<void> {
  const key = FAIL_KEY(clientIp, username);
  const newCount = await redis.incr(key);
  if (newCount === 1) {
    // First failure inside the window, set short TTL so honest typos
    // don't accumulate forever.
    await redis.expire(key, config.LOGIN_LOCKOUT_WINDOW_MIN * 60);
  }
  if (newCount >= config.LOGIN_LOCKOUT_FAILURES) {
    // Threshold tripped, switch to the long lockout TTL.
    await redis.expire(key, config.LOGIN_LOCKOUT_DURATION_MIN * 60);
  }
}

async function clearFailures(clientIp: string, username: string): Promise<void> {
  await redis.del(FAIL_KEY(clientIp, username));
}

/**
 * Verify credentials and return the admin record.
 * The route will sign the JWT, service stays HTTP-agnostic.
 *
 * `clientIp` is the source IP from the request, used to scope lockout state
 * per-(IP, username) instead of per-username (which let any bot lock out a
 * legitimate admin from a different IP).
 */
export async function login(input: LoginInput, clientIp: string): Promise<AdminUser> {
  // Check lockout BEFORE looking up the admin so we don't even leak which
  // usernames exist via timing differences during a lockout.
  await checkLocked(clientIp, input.username);

  const admin = await findAdminByUsername(input.username);
  if (!admin) {
    // Burn comparable CPU to the admin-exists path before failing, so the
    // response time does not reveal whether the username exists. The compare
    // is expected to fail; we ignore its result and fail the same way as a
    // real wrong password below.
    await bcrypt.compare(input.password, DUMMY_HASH);
    await recordFailure(clientIp, input.username);
    throw new InvalidCredentialsError();
  }

  const ok = await verifyPassword(input.password, admin.passwordHash);
  if (!ok) {
    await recordFailure(clientIp, input.username);
    throw new InvalidCredentialsError();
  }

  // K8 - second factor. Only enforced when the admin enabled 2FA. A missing
  // code asks the UI to prompt (the password was already correct, so we don't
  // burn a lockout slot for that); a wrong code IS a failed attempt.
  if (admin.totpEnabled && admin.totpSecret) {
    if (!input.totpCode) {
      throw new TotpRequiredError();
    }
    // #14 - verify AND defeat replay: the matched time-step must be strictly
    // greater than the last accepted one, so a captured code can't be reused
    // inside its validity window (RFC 6238 section 5.2).
    const step = verifyTotpStep(admin.totpSecret, input.totpCode);
    if (
      step === null ||
      (admin.totpLastUsedStep !== null && step <= admin.totpLastUsedStep)
    ) {
      await recordFailure(clientIp, input.username);
      throw new InvalidTotpError();
    }
    await recordTotpStep(admin.id, step);
  }

  await clearFailures(clientIp, input.username);
  return admin;
}