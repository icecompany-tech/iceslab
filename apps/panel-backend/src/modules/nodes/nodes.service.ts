import { randomBytes } from 'node:crypto';
import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import * as repo from './nodes.repository.js';
import { getPanelPublicIp } from './panel-ip.js';
import { issueBootstrapToken } from './bootstrap.service.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';
import {
  mapNodeToPublic,
  mapNodeWithPayload,
  type PublicNodeDto,
  type CreateNodeResponseDto,
  type BootstrapInfo,
} from './nodes.mapper.js';
import type { CreateNodeInput, UpdateNodeInput, ListNodesQuery } from './nodes.schemas.js';

// ───── Domain errors ─────

export class NodeAlreadyExistsError extends Error {
  constructor(public field: 'name' | 'address', public value: string) {
    super(`Node with ${field} "${value}" already exists`);
    this.name = 'NodeAlreadyExistsError';
  }
}

export class NodeNotFoundError extends Error {
  constructor(public id: string) {
    super(`Node ${id} not found`);
    this.name = 'NodeNotFoundError';
  }
}

// ───── Helpers ─────

const IPV4_RE = /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$/;

function buildSans(address: string): { type: 'dns' | 'ip'; value: string }[] {
  const host = address.split(':')[0]!;
  return [{ type: IPV4_RE.test(host) ? 'ip' : 'dns', value: host }];
}

// ───── Service methods ─────

export interface CreateNodeContext {
  /** Public URL of the panel as seen by the admin browser (used to render
   *  the bootstrap install command — node will hit this URL to fetch payload). */
  panelUrl: string;
}

export async function createNode(
  input: CreateNodeInput,
  ctx: CreateNodeContext,
): Promise<CreateNodeResponseDto> {
  // App-level checks against active (non-soft-deleted) rows.
  const byName = await repo.findActiveByName(input.name);
  if (byName) throw new NodeAlreadyExistsError('name', input.name);

  const byAddress = await repo.findActiveByAddress(input.address);
  if (byAddress) throw new NodeAlreadyExistsError('address', input.address);

  let node;
  try {
    node = await repo.create({
      name: input.name,
      address: input.address,
      protocol: input.protocol,
      countryCode: input.countryCode ?? null,
      consumptionMultiplier: BigInt(input.consumptionMultiplier),
      regionId: input.regionId ?? null,
      maxUsers: input.maxUsers ?? null,
      domain: input.domain ?? null,
      // Slice 38 — heartbeat-self-destruct secret. 32 bytes of entropy is
      // overkill for HMAC-SHA256 keying, but stays well under the 64-byte
      // block size and matches our convention for symmetric secrets.
      heartbeatSecret: randomBytes(32),
    });
  } catch (err) {
    // Catch DB-level UNIQUE violation. Soft-deleted rows still hold the
    // unique value at the DB level — the app-level checks above only see
    // active rows, so a soft-deleted node with the same name/address
    // surfaces here as P2002. Slice 24 will replace these with partial
    // unique indexes (`WHERE deleted_at IS NULL`); until then we map the
    // raw error to a friendly 409.
    if (isUniqueViolation(err)) {
      const target = ((err as { meta?: { target?: string[] | string } }).meta?.target ?? '') as
        | string
        | string[];
      const flat = Array.isArray(target) ? target.join(',') : target;
      const field: 'name' | 'address' = flat.includes('address') ? 'address' : 'name';
      throw new NodeAlreadyExistsError(field, field === 'address' ? input.address : input.name);
    }
    throw err;
  }

  const cert = await issueNodeCert({
    commonName: input.name,
    sans: buildSans(input.address),
  });
  const payload = encodeNodePayload(cert);

  const tokenInfo = await issueBootstrapToken(node.id);
  const bootstrap: BootstrapInfo = {
    token: tokenInfo.token,
    expiresAt: tokenInfo.expiresAt.toISOString(),
    command: await renderBootstrapCommand(
      ctx.panelUrl,
      tokenInfo.token,
      node.protocol,
      node.address,
    ),
  };

  // Trigger backfill so existing active users land on this fresh node.
  // Without this, addUser only fires on future user.created events; admins
  // would have to recreate every existing user, which we hit live during the
  // 2026-05-06 VPS test (Hysteria auth rejected pre-existing user).
  eventBus.emit('node.created', { nodeId: node.id, nodeName: node.name });

  return mapNodeWithPayload(node, payload, bootstrap);
}

async function renderBootstrapCommand(
  panelUrl: string,
  token: string,
  protocol: string,
  nodeAddress?: string,
): Promise<string> {
  // Slice S7 — auto-detect or accept env-override of the panel's egress
  // IP so the install command can lock the agent's UFW to it. See
  // panel-ip.ts for resolution order. When all probes fail (offline
  // egress?) we still emit a non-shell-breaking placeholder; admin
  // substitutes manually.
  const panelIp = await getPanelPublicIp();
  const lines = [
    'bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) \\',
    `  --panel-url ${panelUrl} \\`,
    `  --bootstrap ${token} \\`,
    `  --protocol ${protocol} \\`,
  ];
  if (panelIp) {
    lines.push(`  --panel-ip ${panelIp}`);
  } else {
    lines.push('  --panel-ip YOUR_PANEL_PUBLIC_IP  # auto-detect failed, replace with panel IP');
  }

  // Hysteria is the only protocol that takes install-time ACME flags.
  // It fights a chicken-and-egg with `hysteria-server.service` from
  // `get.hy2.sh` upstream that starts before the panel can push config;
  // pre-baking the domain + email into the install command lets that
  // service come up cleanly.
  //
  // Naive / SS2022 / MTProto / Mieru stay idle after bootstrap and
  // wait for the panel's applyInbound payload. Domain, email,
  // masquerade etc. live on the Profile — no install-time flags exist
  // for them in install-iceslab-node.sh, so don't emit any here.
  const acmeDomain = nodeAddress?.split(':')[0] ?? '';
  const acmeEmail = (process.env.ACME_DEFAULT_EMAIL ?? '').trim();
  if (protocol === 'hysteria' && acmeDomain) {
    lines[lines.length - 1] += ' \\';
    lines.push(`  --hysteria-domain ${acmeDomain} \\`);
    if (acmeEmail) {
      lines.push(`  --hysteria-email ${acmeEmail}`);
    } else {
      lines.push('  --hysteria-email admin@example.com  # set ACME_DEFAULT_EMAIL env to inject automatically');
    }
  }
  return lines.join('\n');
}

function isUniqueViolation(err: unknown): boolean {
  return (
    typeof err === 'object' &&
    err !== null &&
    'code' in err &&
    (err as { code?: string }).code === 'P2002'
  );
}

export async function listNodes(query: ListNodesQuery): Promise<{
  nodes: PublicNodeDto[];
  total: number;
  page: number;
  limit: number;
}> {
  const { nodes, total } = await repo.list(query);
  return {
    nodes: nodes.map(mapNodeToPublic),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getNodeById(id: string): Promise<PublicNodeDto> {
  const node = await repo.findActiveById(id);
  if (!node) throw new NodeNotFoundError(id);
  return mapNodeToPublic(node);
}

export async function updateNode(id: string, input: UpdateNodeInput): Promise<PublicNodeDto> {
  const existing = await repo.findActiveById(id);
  if (!existing) throw new NodeNotFoundError(id);

  if (input.name && input.name !== existing.name) {
    const dupe = await repo.findActiveByName(input.name);
    if (dupe) throw new NodeAlreadyExistsError('name', input.name);
  }
  if (input.address && input.address !== existing.address) {
    const dupe = await repo.findActiveByAddress(input.address);
    if (dupe) throw new NodeAlreadyExistsError('address', input.address);
  }

  const data: Parameters<typeof repo.updateById>[1] = {};
  if (input.name !== undefined) data.name = input.name;
  if (input.address !== undefined) data.address = input.address;
  if (input.protocol !== undefined) data.protocol = input.protocol;
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.consumptionMultiplier !== undefined) {
    data.consumptionMultiplier = BigInt(input.consumptionMultiplier);
  }
  if (input.regionId !== undefined) data.regionId = input.regionId;
  if (input.maxUsers !== undefined) data.maxUsers = input.maxUsers;
  if (input.domain !== undefined) data.domain = input.domain;

  // A Node.domain change alters the per-node REALITY self-steal serverNames
  // pushed to the agent (inbounds.queue) and the client SNI (subscription).
  // Detect it before the write so we can re-push the inbound set; otherwise the
  // live node config drifts until an unrelated binding/profile edit or agent
  // restart fires a sync. Caught in review 2026-06-17.
  const domainChanged =
    input.domain !== undefined && input.domain !== existing.domain;

  const updated = await repo.updateById(id, data);

  if (domainChanged) {
    eventBus.emit('node.updated', { nodeId: id, nodeName: updated.name });
  }

  return mapNodeToPublic(updated);
}

export async function deleteNode(id: string): Promise<void> {
  const node = await prisma.node.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, address: true },
  });
  if (!node) throw new NodeNotFoundError(id);
  // Hard-cascade profile bindings (and their hosts via FK cascade) — leaving
  // them around made re-installs look like the profile was bound twice (one
  // to the soft-deleted node, one to the freshly-created replacement). The
  // node row itself stays soft-deleted so audit-trail / lastStatusChange
  // history isn't lost.
  await prisma.profileNodeBinding.deleteMany({ where: { nodeId: id } });
  await repo.softDelete(id);
  notifyTelegramAsync(
    `🗑 *Node deleted*\nname: \`${escapeMarkdown(node.name)}\`\naddress: \`${escapeMarkdown(node.address)}\``,
  );
}
