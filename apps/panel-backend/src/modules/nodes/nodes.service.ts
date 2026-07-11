import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import { eventBus } from '../../lib/event-bus.js';
import { prisma } from '../../prisma.js';
import * as repo from './nodes.repository.js';
import { getPanelPublicIp } from './panel-ip.js';
import { issueBootstrapToken } from './bootstrap.service.js';
import { registerWarpDevice } from '../warp/warp.service.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/telegram-notify.js';
import {
  mapNodeToPublic,
  mapNodeWithPayload,
  type PublicNodeDto,
  type CreateNodeResponseDto,
  type BootstrapInfo,
} from './nodes.mapper.js';
import type {
  CreateNodeInput,
  UpdateNodeInput,
  ListNodesQuery,
  HardeningInput,
} from './nodes.schemas.js';

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
   *  the bootstrap install command, node will hit this URL to fetch payload). */
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
      // G - Zashchita hardening blob. Prisma.JsonNull (not raw null) sets the
      // jsonb column to SQL NULL unambiguously; undefined would also work on
      // create but JsonNull keeps "no hardening" explicit. Cast mirrors the
      // jsonb-write pattern in profiles.service.ts (typed object -> InputJsonValue).
      hardening: (input.hardening as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      // Engine-choice: install sing-box alongside the native core when opted in.
      singboxEngine: input.singboxEngine,
      // Slice 38: heartbeat-self-destruct secret. 32 bytes of entropy is
      // overkill for HMAC-SHA256 keying, but stays well under the 64-byte
      // block size and matches our convention for symmetric secrets.
      heartbeatSecret: randomBytes(32),
    });
  } catch (err) {
    // Catch DB-level UNIQUE violation. Soft-deleted rows still hold the
    // unique value at the DB level, the app-level checks above only see
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
      input.hardening,
      node.singboxEngine,
    ),
  };

  // Trigger backfill so existing active users land on this fresh node.
  // Without this, addUser only fires on future user.created events; admins
  // would have to recreate every existing user, which we hit live during the
  // 2026-05-06 VPS test (Hysteria auth rejected pre-existing user).
  eventBus.emit('node.created', { nodeId: node.id, nodeName: node.name });

  return mapNodeWithPayload(node, payload, bootstrap);
}

/**
 * G - append node-hardening flags to the install command. Each key maps 1:1
 * to a flag in scripts/install-iceslab-node.sh. SHARED by both renderers
 * (service create-path + routes refresh-path) so the two stay byte-identical;
 * the install-command test asserts this contract.
 *
 * Mutates `lines` in place. If `hardening` is null/empty, emits nothing and
 * the command is byte-identical to the pre-hardening output. Honours the
 * existing line-continuation quirk: the previous last line has no trailing
 * `\`, so we add one before pushing more (same as the hysteria block).
 */
export function appendHardeningFlags(
  lines: string[],
  hardening?: HardeningInput | null,
): void {
  if (!hardening) return;
  const flags: string[] = [];
  // ufwLockdown: tighten the firewall beyond the default per-protocol allows
  // (rate-limit SSH, deny-by-default already on). Boolean flag.
  if (hardening.ufwLockdown) flags.push('--harden-ufw');
  // fail2ban: install + enable fail2ban with an sshd jail.
  if (hardening.fail2ban) flags.push('--fail2ban');
  // realisticFallback: REALITY/Caddy fallback serves a real-looking site
  // instead of a bare reset, raising active-probe cost.
  if (hardening.realisticFallback) flags.push('--realistic-fallback');
  // sshAllowlist: comma-joined IP/CIDR list -> ufw locks 22/tcp to these only.
  if (hardening.sshAllowlist && hardening.sshAllowlist.length > 0) {
    flags.push(`--ssh-allowlist ${hardening.sshAllowlist.join(',')}`);
  }
  if (flags.length === 0) return;
  lines[lines.length - 1] += ' \\';
  for (let i = 0; i < flags.length; i++) {
    lines.push(`  ${flags[i]}${i < flags.length - 1 ? ' \\' : ''}`);
  }
}

/**
 * Engine-choice: append `--with-singbox` when the node opts into the sing-box
 * engine alongside its native core (vless/vmess/trojan/hy2/ss served via
 * sing-box). Only the shared native protocols take it; tuic/anytls/shadowtls
 * already run on sing-box, so the installer ignores the flag and we skip it.
 * Shared by both renderers so they stay byte-identical.
 */
export function appendSingboxFlag(
  lines: string[],
  singboxEngine: boolean | undefined,
  protocol: string,
): void {
  if (!singboxEngine) return;
  if (!['xray', 'hysteria', 'shadowsocks'].includes(protocol)) return;
  lines[lines.length - 1] += ' \\';
  lines.push('  --with-singbox');
}

async function renderBootstrapCommand(
  panelUrl: string,
  token: string,
  protocol: string,
  nodeAddress?: string,
  hardening?: HardeningInput | null,
  singboxEngine?: boolean,
): Promise<string> {
  // Slice S7: auto-detect or accept env-override of the panel's egress
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
  // masquerade etc. live on the Profile, no install-time flags exist
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

  // G - node hardening flags. Shared helper keeps this byte-identical with
  // renderRefreshBootstrapCommand in nodes.routes.ts.
  appendHardeningFlags(lines, hardening);
  appendSingboxFlag(lines, singboxEngine, protocol);

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

/**
 * Register (or re-register) a free Cloudflare WARP device for this node and turn
 * on per-node WARP egress. Stores the creds blob in node.warpAccount and flips
 * warpEnabled; the node renders the `warp` block on its next config push. The
 * Cloudflare call is the live path of the registration spike (see warp.service).
 */
export async function registerNodeWarp(id: string): Promise<PublicNodeDto> {
  const existing = await repo.findActiveById(id);
  if (!existing) throw new NodeNotFoundError(id);
  const creds = await registerWarpDevice();
  const node = await repo.updateById(id, {
    warpEnabled: true,
    warpAccount: creds as unknown as Prisma.InputJsonValue,
  });
  return mapNodeToPublic(node);
}

/**
 * Turn off WARP egress for this node. Keeps the registered creds (warpAccount)
 * so re-enabling is instant; the node reverts to direct egress on the next push.
 */
export async function disableNodeWarp(id: string): Promise<PublicNodeDto> {
  const existing = await repo.findActiveById(id);
  if (!existing) throw new NodeNotFoundError(id);
  const node = await repo.updateById(id, { warpEnabled: false });
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
  // G - Zashchita hardening. Prisma.JsonNull (not raw null) so clearing the
  // jsonb column maps to SQL NULL unambiguously (avoids DbNull/JsonNull mixup).
  if (input.hardening !== undefined) {
    data.hardening =
      (input.hardening as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;
  }
  if (input.singboxEngine !== undefined) data.singboxEngine = input.singboxEngine;

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

  // A cascade is a chain: drop one hop and it can't route. So deleting a node
  // that's a hop deletes the whole cascade(s) it belongs to. We collect the
  // OTHER members first to re-push them afterwards (they go back to plain
  // nodes). Without this the hops dangle, pointing at a soft-deleted node that
  // the cascade view renders as UNKNOWN forever.
  const affectedCascades = await prisma.cascade.findMany({
    where: { hops: { some: { nodeId: id } } },
    select: { id: true, name: true, hops: { select: { nodeId: true } } },
  });
  const cascadeIds = affectedCascades.map((c) => c.id);
  const survivorNodeIds = [
    ...new Set(affectedCascades.flatMap((c) => c.hops.map((h) => h.nodeId))),
  ].filter((nid) => nid !== id);

  // One transaction: drop the cascades (their hops go via FK onDelete: Cascade),
  // hard-delete this node's profile bindings (leaving them made a re-install
  // look double-bound), and soft-delete the node row (kept for audit history).
  await prisma.$transaction([
    ...(cascadeIds.length > 0
      ? [prisma.cascade.deleteMany({ where: { id: { in: cascadeIds } } })]
      : []),
    prisma.profileNodeBinding.deleteMany({ where: { nodeId: id } }),
    prisma.node.update({ where: { id }, data: { deletedAt: new Date() } }),
  ]);

  // Bust the subscription bindings cache immediately so this node's endpoints
  // stop being served (otherwise they linger up to the 60s TTL). cascade.changed
  // below only fires when the node was a cascade hop, so a plain node delete
  // needs its own event (review M5).
  eventBus.emit('node.deleted', { nodeId: id });

  // Re-render the surviving cascade members as plain nodes (drop link fragments).
  if (survivorNodeIds.length > 0) {
    eventBus.emit('cascade.changed', { nodeIds: survivorNodeIds });
  }

  notifyTelegramAsync(
    `🗑 *Node deleted*\nname: \`${escapeMarkdown(node.name)}\`\naddress: \`${escapeMarkdown(node.address)}\``,
  );
  if (affectedCascades.length > 0) {
    const names = affectedCascades.map((c) => `\`${escapeMarkdown(c.name)}\``).join(', ');
    notifyTelegramAsync(`🔗 *Cascade removed* (member node deleted): ${names}`);
  }
}
