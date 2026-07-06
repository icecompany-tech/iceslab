import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { Prisma } from '../../generated/prisma/client.js';
import { requireAuth } from '../auth/auth.hook.js';
import { prisma } from '../../prisma.js';

/**
 * Slice 27.5: admin CRUD for `regions`. Plain identity table with
 * (name, code), no business logic yet. Slice 28 will read `code`
 * against GeoIP at /sub/:token to score nodes; here we just give
 * admins the chair to create them.
 */

const RegionIdParam = z.object({ id: z.uuid() });

const CreateRegion = z.object({
  name: z.string().min(1).max(64),
  code: z.string().min(1).max(16),
});

const UpdateRegion = CreateRegion.partial();

function regionToDto(r: { id: string; name: string; code: string; createdAt: Date; updatedAt: Date }) {
  return {
    id: r.id,
    name: r.name,
    code: r.code,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function regionsRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  app.get('/api/regions', auth, async (_req, reply) => {
    const rows = await prisma.region.findMany({
      orderBy: [{ name: 'asc' }],
      include: { _count: { select: { nodes: true } } },
    });
    return reply.send({
      regions: rows.map((r) => ({ ...regionToDto(r), nodeCount: r._count.nodes })),
    });
  });

  app.post('/api/regions', auth, async (req, reply) => {
    const input = CreateRegion.parse(req.body);
    try {
      const created = await prisma.region.create({ data: input });
      return reply.code(201).send(regionToDto(created));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply.code(409).send({
          error: 'CONFLICT',
          message: 'Region name or code already taken',
        });
      }
      throw err;
    }
  });

  app.put('/api/regions/:id', auth, async (req, reply) => {
    const { id } = RegionIdParam.parse(req.params);
    const input = UpdateRegion.parse(req.body);
    try {
      const updated = await prisma.region.update({ where: { id }, data: input });
      return reply.send(regionToDto(updated));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          return reply.code(404).send({ error: 'NOT_FOUND' });
        }
        if (err.code === 'P2002') {
          return reply.code(409).send({
            error: 'CONFLICT',
            message: 'Region name or code already taken',
          });
        }
      }
      throw err;
    }
  });

  app.delete('/api/regions/:id', auth, async (req, reply) => {
    const { id } = RegionIdParam.parse(req.params);
    // Foreign-key on `nodes.region_id` is ON DELETE SET NULL, we don't
    // need to clear nodes manually; they just become "regionless" again.
    try {
      await prisma.region.delete({ where: { id } });
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ error: 'NOT_FOUND' });
      }
      throw err;
    }
  });
}
