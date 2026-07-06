import type { FastifyInstance } from 'fastify';
import { requireAuth } from '../auth/auth.hook.js';
import { prisma } from '../../prisma.js';
import {
  CreateSrrSchema,
  UpdateSrrSchema,
  SrrIdParamSchema,
  TestSrrSchema,
} from './srr.schemas.js';
import { matchFormatForUserAgent, invalidateSrrCache } from './srr.service.js';

export async function srrRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  // GET /api/srr: list rules in evaluation order (priority ASC)
  app.get('/api/srr', auth, async (_request, reply) => {
    const rules = await prisma.subscriptionResponseRule.findMany({
      orderBy: { priority: 'asc' },
    });
    return reply.send({ rules });
  });

  // POST /api/srr
  app.post('/api/srr', auth, async (request, reply) => {
    const input = CreateSrrSchema.parse(request.body);
    try {
      const rule = await prisma.subscriptionResponseRule.create({
        data: input,
      });
      invalidateSrrCache();
      return reply.code(201).send(rule);
    } catch (err) {
      if (isUniqueConstraintError(err)) {
        return reply.code(409).send({
          error: 'CONFLICT',
          message: `Rule named "${input.name}" already exists`,
        });
      }
      throw err;
    }
  });

  // PUT /api/srr/:id
  app.put('/api/srr/:id', auth, async (request, reply) => {
    const params = SrrIdParamSchema.parse(request.params);
    const input = UpdateSrrSchema.parse(request.body);
    try {
      const rule = await prisma.subscriptionResponseRule.update({
        where: { id: params.id },
        data: input,
      });
      invalidateSrrCache();
      return reply.send(rule);
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule not found' });
      }
      if (isUniqueConstraintError(err)) {
        return reply.code(409).send({
          error: 'CONFLICT',
          message: `Rule with that name already exists`,
        });
      }
      throw err;
    }
  });

  // DELETE /api/srr/:id
  app.delete('/api/srr/:id', auth, async (request, reply) => {
    const params = SrrIdParamSchema.parse(request.params);
    try {
      await prisma.subscriptionResponseRule.delete({
        where: { id: params.id },
      });
      invalidateSrrCache();
      return reply.code(204).send();
    } catch (err) {
      if (isRecordNotFoundError(err)) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: 'Rule not found' });
      }
      throw err;
    }
  });

  // POST /api/srr/test: evaluate a UA against the current rule set
  app.post('/api/srr/test', auth, async (request, reply) => {
    const input = TestSrrSchema.parse(request.body);
    const matched = await matchFormatForUserAgent(input.userAgent);
    return reply.send({ format: matched, userAgent: input.userAgent });
  });
}

function isUniqueConstraintError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2002';
}

function isRecordNotFoundError(err: unknown): boolean {
  return typeof err === 'object' && err !== null && 'code' in err && (err as { code?: string }).code === 'P2025';
}
