import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import { refuseApiToken } from './audit.hook.js';
import { AuditListQuerySchema } from './audit.schemas.js';
import { BadCursorError, listAudit } from './audit.service.js';

export async function auditRoutes(app: FastifyInstance): Promise<void> {
  // 200 AdminAuditListResponse; 400 VALIDATION_ERROR, BAD_CURSOR; 403
  // AUDIT_ADMIN_ONLY for any API token, scoped or full.
  app.get('/api/audit', { onRequest: [requireAuth, refuseApiToken] }, async (request, reply) => {
    const query = AuditListQuerySchema.parse(request.query);
    try {
      return reply.send(await listAudit(query));
    } catch (err) {
      if (err instanceof BadCursorError) return reply.code(400).send({ error: err.code, message: err.message });
      throw err;
    }
  });
}
