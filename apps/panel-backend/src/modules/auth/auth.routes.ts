import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from './auth.hook.js';
import { findAdminById } from '../admin/admin.service.js';
import { LoginSchema, RegisterSchema, TotpCodeSchema } from './auth.schemas.js';
import * as authService from './auth.service.js';
import * as twofa from './twofa.service.js';
import * as adminService from '../admin/admin.service.js';
import { mapAdminToPublic } from '../admin/admin.mapper.js';
import { notifyTelegramAsync, escapeMarkdown, redactIp, redactUsername } from '../../lib/telegram-notify.js';
import { loginAttempts } from '../../lib/metrics.js';
import { config, subscriptionOrigin } from '../../config.js';

export async function authRoutes(app: FastifyInstance): Promise<void> {
  // GET /api/auth/status - public discovery: tells the frontend which auth
  // methods are enabled and whether bootstrap registration is still open.
  // Also returns the panel's public URL so the SPA can build full
  // subscription links (`<publicUrl>/sub/<token>`) for copy-paste, pre-
  // cycle #6 admins saw only the path `/sub/...` and had to mentally
  // prepend the domain. Now the UI displays the ready-to-paste URL.
  app.get('/api/auth/status', async () => {
    const adminCount = await adminService.countAdmins();
    return {
      authentication: {
        password: { enabled: true },
      },
      registration: {
        enabled: adminCount === 0,
      },
      panel: {
        // Origin the SPA prepends to a token for the copy-paste link. Client
        // facing, so it follows a subscription-domain split rather than the
        // panel's own address.
        publicUrl: subscriptionOrigin(),
        // Subscription path prefix. Default `/sub`, admin can override
        // via SUBSCRIPTION_PATH_PREFIX env to mask the Iceslab
        // signature (e.g. `/v` or `/get`). Always starts with `/`.
        subscriptionPathPrefix: config.SUBSCRIPTION_PATH_PREFIX,
      },
    };
  });

  // POST /api/auth/login: strict rate limit (anti-brute-force)
  app.post(
    '/api/auth/login',
    {
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
        },
      },
    },
    async (request, reply) => {
      const input = LoginSchema.parse(request.body);
      const peerIp = request.ip;
      try {
        const admin = await authService.login(input, peerIp);
        const token = await reply.jwtSign({
          sub: admin.id,
          role: admin.role,
        });
        // Slice 37 - also drop a same-origin cookie so server-rendered admin
        // tooling (Bull-board at /admin/queues) inherits the session without
        // requiring the SPA to manually copy localStorage to a header.
        // HttpOnly + SameSite=Strict, cookie is unreadable to JS and only
        // travels with first-party requests, so XSS can't exfil it and
        // CSRF can't ride it cross-site.
        reply.setCookie('iceslab_auth', token, {
          httpOnly: true,
          sameSite: 'strict',
          path: '/',
          maxAge: 60 * 60 * 24, // 24h, matches default JWT_EXPIRES_IN.
          // Wave-14 #6: was process.env.NODE_ENV. If config loads NODE_ENV
          // from .env but the actual process.env is empty (e.g. dotenv-only
          // setup with no shell-level export), this evaluated to false in
          // prod and the auth cookie shipped without Secure → JWT over
          // plain HTTP on MITM. Always read through config.
          secure: config.NODE_ENV === 'production',
        });
        if (config.TELEGRAM_NOTIFY_LOGIN_EVENTS) {
          notifyTelegramAsync(
            `🔓 *Admin login*\nuser: \`${escapeMarkdown(redactUsername(admin.username))}\`\nip: \`${escapeMarkdown(redactIp(peerIp))}\``,
          );
        }
        loginAttempts.inc({ result: 'ok' });
        return reply.send({
          admin: mapAdminToPublic(admin),
          token,
        });
      } catch (err) {
        if (err instanceof authService.AccountLockedError) {
          // 429 + Retry-After is the canonical lockout response. Body
          // discloses retryAfter so a friendly UI can countdown, but the
          // 401 vs 429 distinction also tells legit users they aren't
          // typing the wrong password, they're racing a stale lockout.
          loginAttempts.inc({ result: 'locked' });
          if (config.TELEGRAM_NOTIFY_LOGIN_EVENTS) {
            notifyTelegramAsync(
              `🔒 *Login locked out*\nuser: \`${escapeMarkdown(redactUsername(input.username))}\`\nip: \`${escapeMarkdown(redactIp(peerIp))}\`\nretry in: ${err.retryAfterSeconds}s`,
            );
          }
          reply.header('Retry-After', err.retryAfterSeconds.toString());
          return reply.code(429).send({
            error: 'ACCOUNT_LOCKED',
            message: err.message,
            retryAfterSeconds: err.retryAfterSeconds,
          });
        }
        if (err instanceof authService.InvalidCredentialsError) {
          loginAttempts.inc({ result: 'invalid' });
          return reply.code(401).send({
            error: 'INVALID_CREDENTIALS',
            message: err.message,
          });
        }
        // K8 - password was correct but 2FA is on and no code was sent yet.
        // 401 with a flag so the SPA shows the code field (not a hard fail).
        if (err instanceof authService.TotpRequiredError) {
          return reply.code(401).send({
            error: 'TOTP_REQUIRED',
            message: err.message,
            requires2fa: true,
          });
        }
        if (err instanceof authService.InvalidTotpError) {
          loginAttempts.inc({ result: 'invalid' });
          return reply.code(401).send({
            error: 'INVALID_TOTP',
            message: err.message,
            requires2fa: true,
          });
        }
        throw err;
      }
    },
  );

  // POST /api/auth/register: bootstrap only (no admins exist) + strict rate limit
  app.post(
    '/api/auth/register',
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: '5 minutes',
        },
      },
    },
    async (request, reply) => {
      const input = RegisterSchema.parse(request.body);
      try {
        const admin = await adminService.bootstrapFirstAdmin(input);
        return reply.code(201).send(admin);
      } catch (err) {
        if (err instanceof adminService.RegistrationDisabledError) {
          return reply.code(403).send({
            error: 'REGISTRATION_DISABLED',
            message: err.message,
          });
        }
        if (err instanceof adminService.AdminAlreadyExistsError) {
          return reply.code(409).send({
            error: 'CONFLICT',
            message: err.message,
          });
        }
        throw err;
      }
    },
  );

  // GET /api/auth/me - protected: returns current admin from JWT
  app.get(
    '/api/auth/me',
    { onRequest: [requireAuth] },
    async (request: FastifyRequest, reply: FastifyReply) => {
      const admin = await findAdminById(request.admin!.id);
      if (!admin) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Admin not found' });
      }
      return reply.send(mapAdminToPublic(admin));
    },
  );

  // ───── K8: 2FA (TOTP) management, all protected ─────

  // Map twofa service errors to HTTP. Shared by enable/disable/setup.
  function twofaError(reply: FastifyReply, err: unknown): FastifyReply | null {
    if (err instanceof twofa.TotpBadCodeError) {
      return reply.code(401).send({ error: 'INVALID_TOTP', message: err.message });
    }
    if (err instanceof twofa.TotpAlreadyEnabledError) {
      return reply.code(409).send({ error: 'CONFLICT', message: err.message });
    }
    if (err instanceof twofa.TotpNotSetupError) {
      return reply.code(409).send({ error: 'NOT_SETUP', message: err.message });
    }
    return null;
  }

  app.get(
    '/api/auth/2fa/status',
    { onRequest: [requireAuth] },
    async (request, reply) => reply.send(await twofa.getTotpStatus(request.admin!.id)),
  );

  // Generate a pending secret + otpauth URI for QR enrollment. Not enforced
  // until /enable confirms a code.
  app.post(
    '/api/auth/2fa/setup',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      try {
        return reply.send(await twofa.setupTotp(request.admin!.id));
      } catch (err) {
        return twofaError(reply, err) ?? Promise.reject(err);
      }
    },
  );

  app.post(
    '/api/auth/2fa/enable',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { code } = TotpCodeSchema.parse(request.body);
      try {
        await twofa.enableTotp(request.admin!.id, code);
        return reply.send({ ok: true, enabled: true });
      } catch (err) {
        return twofaError(reply, err) ?? Promise.reject(err);
      }
    },
  );

  app.post(
    '/api/auth/2fa/disable',
    { onRequest: [requireAuth] },
    async (request, reply) => {
      const { code } = TotpCodeSchema.parse(request.body);
      try {
        await twofa.disableTotp(request.admin!.id, code);
        return reply.send({ ok: true, enabled: false });
      } catch (err) {
        return twofaError(reply, err) ?? Promise.reject(err);
      }
    },
  );
}
