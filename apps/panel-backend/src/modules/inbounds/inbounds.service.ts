import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import type { Inbound } from '../../generated/prisma/client.js';
import { prisma } from '../../prisma.js';
import { eventBus } from '../../lib/event-bus.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import {
  PROTOCOL_CONFIG_SCHEMAS,
  type CreateInboundInput,
  type ListInboundsQuery,
  type UpdateInboundInput,
} from './inbounds.schemas.js';

/**
 * Slice 24d (fix 2026-05-07) — auto-generate the SS2022 server-PSK at
 * inbound create. Length matches xray-core requirements:
 *   - `2022-blake3-aes-128-gcm`            → 16 bytes
 *   - `2022-blake3-aes-256-gcm`            → 32 bytes
 *   - `2022-blake3-chacha20-poly1305`      → 32 bytes
 *   - legacy AEAD (chacha20/aes-gcm)       → no spec, 32 bytes works fine
 */
function ssPskBytesForMethod(method: string): number {
  if (method === '2022-blake3-aes-128-gcm') return 16;
  return 32;
}

function generateSsServerPsk(method: string): string {
  return randomBytes(ssPskBytesForMethod(method)).toString('base64');
}

export class InboundNotFoundError extends Error {
  constructor() {
    super('Inbound not found');
    this.name = 'InboundNotFoundError';
  }
}

export class NodeNotFoundError extends Error {
  constructor() {
    super('Node not found');
    this.name = 'NodeNotFoundError';
  }
}

export class PortInUseError extends Error {
  constructor(nodeId: string, port: number) {
    super(`Node ${nodeId} already has an inbound on port ${port}`);
    this.name = 'PortInUseError';
  }
}

export class ProtocolMismatchError extends Error {
  constructor() {
    super('config does not match the inbound protocol');
    this.name = 'ProtocolMismatchError';
  }
}

export class InvalidPortHoppingRangeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'InvalidPortHoppingRangeError';
  }
}

/**
 * Slice 31.5 — cross-field validation for Hysteria port-hopping. Kept out of
 * the Zod schema so HysteriaConfigSchema stays a plain ZodObject (required
 * for the discriminated union). Throws with a user-friendly message when
 * one bound is set without the other, or when end <= start.
 */
function validateHysteriaPortHopping(cfg: Record<string, unknown>): void {
  const start = cfg.portHoppingStart as number | undefined;
  const end = cfg.portHoppingEnd as number | undefined;
  const sSet = typeof start === 'number';
  const eSet = typeof end === 'number';
  if (sSet !== eSet) {
    throw new InvalidPortHoppingRangeError(
      'portHoppingStart and portHoppingEnd must both be set or both empty',
    );
  }
  if (sSet && eSet && end <= start) {
    throw new InvalidPortHoppingRangeError(
      'portHoppingEnd must be greater than portHoppingStart',
    );
  }
}

export async function createInbound(input: CreateInboundInput): Promise<Inbound> {
  const node = await prisma.node.findFirst({
    where: { id: input.nodeId, deletedAt: null },
    select: { id: true },
  });
  if (!node) throw new NodeNotFoundError();

  // Slice 24d — auto-generate Server PSK for SS2022 inbounds when admin
  // didn't supply one. xray-core requires it for multi-user mode; nothing
  // useful comes from making the admin paste random bytes.
  let configToStore = input.config as Record<string, unknown>;
  if (input.protocol === 'hysteria') {
    validateHysteriaPortHopping(configToStore);
  }
  if (input.protocol === 'shadowsocks') {
    const ssCfg = configToStore as { method: string; serverPsk?: string };
    if (!ssCfg.serverPsk) {
      configToStore = {
        ...ssCfg,
        serverPsk: generateSsServerPsk(ssCfg.method),
      };
    }
  }
  // ShadowTLS: auto-generate the inner shadowsocks server key (ssPassword),
  // same length rules as SS2022 serverPsk. Per-user auth is the shadowtls
  // password (derived per user); this inner key is server-wide.
  if (input.protocol === 'shadowtls') {
    const stCfg = configToStore as { ssMethod: string; ssPassword?: string };
    if (!stCfg.ssPassword) {
      configToStore = {
        ...stCfg,
        ssPassword: generateSsServerPsk(stCfg.ssMethod),
      };
    }
  }

  let created: Inbound;
  try {
    // Slice 26 invariant — every new inbound gets attached to the "All" squad
    // synchronously, in the same transaction as the inbound row. Previously
    // this was an async fire-and-forget on the inbound.created event handler;
    // that opened a race window (inbound exists in DB but no group_inbound
    // row yet), and surfaced as ghost-empty subscription bodies right after
    // creating an inbound. Doing it here closes the gap.
    created = await prisma.$transaction(async (tx) => {
      const inbound = await tx.inbound.create({
        data: {
          nodeId: input.nodeId,
          protocol: input.protocol,
          name: input.name,
          port: input.port,
          enabled: input.enabled,
          publicHost: input.publicHost ?? null,
          publicPort: input.publicPort ?? null,
          config: configToStore as never,
        },
      });
      await tx.groupInbound.upsert({
        where: { groupId_inboundId: { groupId: ALL_SQUAD_ID, inboundId: inbound.id } },
        create: { groupId: ALL_SQUAD_ID, inboundId: inbound.id },
        update: {},
      });
      return inbound;
    });
  } catch (err) {
    if (isUniquePortError(err)) {
      throw new PortInUseError(input.nodeId, input.port);
    }
    throw err;
  }
  eventBus.emit('inbound.created', { inboundId: created.id, nodeId: created.nodeId });
  return created;
}

export async function listInbounds(query: ListInboundsQuery): Promise<Inbound[]> {
  return prisma.inbound.findMany({
    where: {
      nodeId: query.nodeId,
      protocol: query.protocol,
    },
    orderBy: [{ nodeId: 'asc' }, { port: 'asc' }],
  });
}

export async function getInboundById(id: string): Promise<Inbound> {
  const inbound = await prisma.inbound.findUnique({ where: { id } });
  if (!inbound) throw new InboundNotFoundError();
  return inbound;
}

export async function updateInbound(
  id: string,
  input: UpdateInboundInput,
): Promise<Inbound> {
  const existing = await prisma.inbound.findUnique({ where: { id } });
  if (!existing) throw new InboundNotFoundError();

  let validatedConfig: unknown;
  if (input.config !== undefined) {
    const schema = PROTOCOL_CONFIG_SCHEMAS[existing.protocol as keyof typeof PROTOCOL_CONFIG_SCHEMAS];
    if (!schema) {
      throw new ProtocolMismatchError();
    }
    const parsed = schema.safeParse(input.config);
    if (!parsed.success) {
      throw new z.ZodError(parsed.error.issues);
    }
    validatedConfig = parsed.data;
    if (existing.protocol === 'hysteria') {
      validateHysteriaPortHopping(validatedConfig as Record<string, unknown>);
    }
  }

  let updated: Inbound;
  try {
    updated = await prisma.inbound.update({
      where: { id },
      data: {
        name: input.name ?? undefined,
        port: input.port ?? undefined,
        enabled: input.enabled ?? undefined,
        // null clears, undefined keeps current — Prisma honours that semantic.
        publicHost: input.publicHost === undefined ? undefined : input.publicHost,
        publicPort: input.publicPort === undefined ? undefined : input.publicPort,
        config: validatedConfig === undefined ? undefined : (validatedConfig as never),
      },
    });
  } catch (err) {
    if (isUniquePortError(err)) {
      throw new PortInUseError(existing.nodeId, input.port ?? existing.port);
    }
    throw err;
  }
  eventBus.emit('inbound.updated', { inboundId: updated.id, nodeId: updated.nodeId });
  return updated;
}

export async function deleteInbound(id: string): Promise<void> {
  // Look up nodeId BEFORE delete so the event payload still resolves the
  // node binding — by the time the handler reads from DB the row is gone.
  const existing = await prisma.inbound.findUnique({
    where: { id },
    select: { id: true, nodeId: true },
  });
  if (!existing) throw new InboundNotFoundError();

  try {
    await prisma.inbound.delete({ where: { id } });
  } catch (err) {
    if (isRecordNotFound(err)) throw new InboundNotFoundError();
    throw err;
  }
  eventBus.emit('inbound.deleted', { inboundId: existing.id, nodeId: existing.nodeId });
}

function isUniquePortError(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

function isRecordNotFound(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2025'
  );
}
