import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { Prisma } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { MAX_DIRECTION_ORDINAL } from '../cascades/cascade.config.js';

// A4 ad-split: a named route-policy (extra, ordinal >= 1) the operator can grant
// to squads. The plain profile (ordinal 0) is implicit and never a row here.
//
// Until 2026-07-30 this module was list-only, with its own comment calling a
// create surface a fast-follow. The follow never came, so ad-split shipped in
// E1 as a mechanism nobody could operate: policies could only appear by writing
// SQL by hand. Everything below closes that.
export interface PublicRoutePolicyDto {
  id: string;
  name: string;
  ordinal: number;
  directDomains: string[];
  blockDomains: string[];
}

/** A geosite/domain matcher as xray accepts it: `geosite:category-ads-all`,
 *  `domain:example.com`, `regexp:.*\.ru$`, or a bare hostname. Kept permissive
 *  on purpose, xray owns the grammar; we only bound the size. */
const DomainRule = z.string().min(1).max(253);

const PolicyBody = {
  name: z.string().min(1).max(64),
  directDomains: z.array(DomainRule).max(512).default([]),
  blockDomains: z.array(DomainRule).max(512).default([]),
};

const CreatePolicySchema = z
  .object({
    ...PolicyBody,
    /** Tag band. Omitted = next free one, which is what a UI should send. */
    ordinal: z.number().int().min(1).max(MAX_DIRECTION_ORDINAL).optional(),
  })
  .refine((v) => v.directDomains.length > 0 || v.blockDomains.length > 0, {
    message: 'a policy with no domains does nothing: add at least one direct or block rule',
    path: ['blockDomains'],
  });

const UpdatePolicySchema = z.object({
  name: z.string().min(1).max(64).optional(),
  directDomains: z.array(DomainRule).max(512).optional(),
  blockDomains: z.array(DomainRule).max(512).optional(),
  // `ordinal` is deliberately absent: it is the tag band, it travels inside
  // every subscriber's UUID, and changing it would silently reroute everyone
  // already holding a link. Delete and recreate if it truly must move.
});

const IdParam = z.object({ id: z.uuid() });

export async function listRoutePolicies(): Promise<PublicRoutePolicyDto[]> {
  const rows = await prisma.routePolicy.findMany({ orderBy: { ordinal: 'asc' } });
  return rows.map(toDto);
}

function toDto(p: {
  id: string;
  name: string;
  ordinal: number;
  directDomains: string[];
  blockDomains: string[];
}): PublicRoutePolicyDto {
  return {
    id: p.id,
    name: p.name,
    ordinal: p.ordinal,
    directDomains: p.directDomains,
    blockDomains: p.blockDomains,
  };
}

/**
 * Lowest unused ordinal from 1 up.
 *
 * Reuses gaps on purpose, unlike direction tags. A policy ordinal only means
 * something while the policy exists: it is resolved fresh on every push, and a
 * deleted policy's rules are gone from every node. Burning ordinals here would
 * exhaust a 255-wide space for no safety gain.
 */
async function nextOrdinal(): Promise<number> {
  const taken = new Set((await prisma.routePolicy.findMany({ select: { ordinal: true } })).map((p) => p.ordinal));
  for (let i = 1; i <= MAX_DIRECTION_ORDINAL; i++) {
    if (!taken.has(i)) return i;
  }
  throw new PolicySpaceExhaustedError();
}

export class PolicySpaceExhaustedError extends Error {
  constructor() {
    super(
      `no free policy band left: ${MAX_DIRECTION_ORDINAL} policies already exist. Delete one before adding another.`,
    );
    this.name = 'PolicySpaceExhaustedError';
  }
}

/** Policy rules are rendered into every cascade ENTRY's config, so any change
 *  here has to reach the nodes. Without this a saved policy sits in the
 *  database and nothing on the fleet knows about it. */
async function repushCascadeEntries(): Promise<void> {
  const entries = await prisma.cascadeHop.findMany({
    where: { position: 0, cascade: { enabled: true } },
    select: { nodeId: true },
  });
  if (entries.length === 0) return;
  eventBus.emit('cascade.changed', { nodeIds: [...new Set(entries.map((e) => e.nodeId))] });
}

export async function routePolicyRoutes(app: FastifyInstance): Promise<void> {
  // Per-route auth (see users.routes.ts header for the Fastify v5 rationale).
  const auth = { onRequest: [requireAuth] };

  app.get('/api/route-policies', auth, async () => ({ policies: await listRoutePolicies() }));

  app.post('/api/route-policies', auth, async (req, reply) => {
    const input = CreatePolicySchema.parse(req.body);
    // Both `name` and `ordinal` are unique, and an operator needs to know WHICH
    // one collided: the fixes are different (rename vs pick another band).
    // Checked up front rather than by reading a P2002, whose `meta.target`
    // shape is a Prisma implementation detail we would be parsing blind.
    const clash = await prisma.routePolicy.findFirst({
      where: {
        OR: [{ name: input.name }, ...(input.ordinal ? [{ ordinal: input.ordinal }] : [])],
      },
      select: { name: true, ordinal: true },
    });
    if (clash) {
      return reply.code(409).send({
        error: 'CONFLICT',
        message:
          clash.name === input.name
            ? `a policy named "${input.name}" already exists`
            : `policy band ${input.ordinal} is already taken by "${clash.name}"`,
      });
    }
    try {
      const created = await prisma.routePolicy.create({
        data: {
          name: input.name,
          ordinal: input.ordinal ?? (await nextOrdinal()),
          directDomains: input.directDomains,
          blockDomains: input.blockDomains,
        },
      });
      await repushCascadeEntries();
      return reply.code(201).send(toDto(created));
    } catch (err) {
      if (err instanceof PolicySpaceExhaustedError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      // Still possible under a race between the check above and this insert.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        return reply
          .code(409)
          .send({ error: 'CONFLICT', message: 'name or band was taken while saving, try again' });
      }
      throw err;
    }
  });

  app.put('/api/route-policies/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const input = UpdatePolicySchema.parse(req.body);
    try {
      const updated = await prisma.routePolicy.update({ where: { id }, data: input });
      await repushCascadeEntries();
      return reply.send(toDto(updated));
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError) {
        if (err.code === 'P2025') {
          return reply.code(404).send({ error: 'NOT_FOUND', message: `policy ${id} not found` });
        }
        if (err.code === 'P2002') {
          return reply
            .code(409)
            .send({ error: 'CONFLICT', message: `a policy named "${input.name}" already exists` });
        }
      }
      throw err;
    }
  });

  app.delete('/api/route-policies/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    try {
      // Grants go with it (GroupRoutePolicy cascades), so squads holding this
      // policy simply stop offering it. Their members fall back to the plain
      // profile, which is always available.
      await prisma.routePolicy.delete({ where: { id } });
      await repushCascadeEntries();
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2025') {
        return reply.code(404).send({ error: 'NOT_FOUND', message: `policy ${id} not found` });
      }
      throw err;
    }
  });
}
