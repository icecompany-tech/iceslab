import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import * as repo from './nodes.repository.js';
import { getPanelPublicIp } from './panel-ip.js';
import { issueBootstrapToken } from './bootstrap.service.js';
import { registerWarpDevice } from '../warp/warp.service.js';
import { getHiddenCascadeNodes } from '../cascades/cascade.service.js';
import { assertPolicyFitsNode } from '../node-policies/node-policies.service.js';
import { notifyTelegramAsync, escapeMarkdown } from '../../lib/notify/telegram-notify.js';
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
import { resolveCoreVersions } from '@iceslab/shared';
import { applyCoreVersionsPatch, readCoreVersions } from './node-core-versions.js';
import { hostsByEngine, withNeededBy } from './node-core-gate.js';
import { cascadeNeedsByNode, type CascadeEngineNeed } from './node-cascade-needs.js';
import { resolveNodeEngines } from './node-intended-engines.js';
import { intendedEngines } from './node-engines.js';
export { CoreVersionIntentError } from './node-core-versions.js';
export { NodeEnginesError } from './node-intended-engines.js';

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

/**
 * The node is a hop or a way out of a cascade that is switched on.
 *
 * Deleting it used to be allowed, and on 2026-09-22 it cost two cascade entries
 * a day of pushes: the v4 topology kept pointing at the deleted row, the
 * renderer refused to build anything for the entries rather than half-render a
 * chain, and nothing said so until their cores were restarted and came up
 * empty.
 *
 * The cascades are named because the operator's next step is in them, not here:
 * either take the cascade down or move the way out to another node, and only
 * then retire this one.
 */
export class NodeInUseByCascadeError extends Error {
  readonly code = 'NODE_IN_USE_BY_CASCADE';

  constructor(
    public nodeName: string,
    public cascades: string[],
  ) {
    super(
      `Node "${nodeName}" is part of the enabled cascade${cascades.length > 1 ? 's' : ''} ` +
        `${cascades.map((c) => `"${c}"`).join(', ')}. Deleting it would leave ${
          cascades.length > 1 ? 'those chains' : 'that chain'
        } pointing at a node that is gone, and the panel would stop pushing config to ` +
        `every node in ${cascades.length > 1 ? 'them' : 'it'}. Take the cascade down, or move ` +
        `the way out to another node, and then delete this one.`,
    );
    this.name = 'NodeInUseByCascadeError';
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

  // Checked before the row exists: a refused version creates nothing.
  const coreVersions = applyCoreVersionsPatch({}, input.coreVersions ?? {});
  // The engines, the primary's label and the sing-box flag, in step.
  const engines = resolveNodeEngines(input);

  let node;
  try {
    node = await repo.create({
      name: input.name,
      address: input.address,
      protocol: engines.protocol,
      intendedEngines: engines.intendedEngines,
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
      // Э3 F: the resolver this node's users get. Same jsonb-write pattern.
      dns: (input.dns as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      // Engine-choice: "singbox is in intendedEngines", kept as its own column.
      singboxEngine: engines.singboxEngine,
      // Which core versions to install; '{}' (every pin) when none were chosen.
      coreVersions,
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
  // The same core versions the bootstrap redeem hands out, for the operator who
  // pastes this payload instead of using the token.
  const payload = encodeNodePayload({ ...cert, coreVersions: resolveCoreVersions(coreVersions) });

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
      intendedEngines(node),
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
 * G - the node-hardening flags of the install command, in a fixed order. Each
 * maps 1:1 to a flag in scripts/install-iceslab-node.sh. Empty for null or an
 * empty object, so a node without hardening gets the command it always got.
 */
export function hardeningFlags(hardening?: HardeningInput | null): string[] {
  if (!hardening) return [];
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
  return flags;
}

/**
 * Append the hardening flags to a command built as lines. The previous last
 * line gets its continuation, the last flag has none. Kept for callers that
 * assemble lines themselves; buildInstallCommand is the one that renders.
 */
export function appendHardeningFlags(lines: string[], hardening?: HardeningInput | null): void {
  const flags = hardeningFlags(hardening);
  if (flags.length === 0) return;
  lines[lines.length - 1] += ' \\';
  flags.forEach((f, i) => lines.push(`  ${f}${i < flags.length - 1 ? ' \\' : ''}`));
}

/**
 * The cores the node is installed with, from Node.intendedEngines (the main one
 * first, the one --protocol runs on).
 *
 *   one core            nothing: --protocol already says it;
 *   main core + singbox `--with-singbox`, the spelling EVERY installer knows;
 *   anything else       `--engines a,b,c`.
 *
 * Why the old spelling where it is enough: the command fetches the installer
 * from `main`, which can be older than this panel, and an installer that does
 * not know --engines stops at "Unknown arg". The one shape it cannot express
 * (a third core) is also the one it could never install.
 */
export function enginesFlag(engines: readonly string[]): string | null {
  const extra = engines.slice(1);
  if (extra.length === 0) return null;
  return extra.length === 1 && extra[0] === 'singbox' ? '--with-singbox' : `--engines ${engines.join(',')}`;
}

export interface InstallCommandInput {
  panelUrl: string;
  token: string;
  protocol: string;
  nodeAddress?: string;
  hardening?: HardeningInput | null;
  engines?: readonly string[];
  /** The panel's public IP, or null when every probe failed. */
  panelIp: string | null;
  /** ACME_DEFAULT_EMAIL, trimmed; empty when unset. */
  acmeEmail: string;
}

/**
 * The install command the panel shows, for node create and for a refreshed
 * bootstrap alike: one function, so the two cannot drift.
 *
 * ⚠ No `#` inside the command, ever. The placeholders used to carry their note
 * on the same line ("--panel-ip YOUR_PANEL_PUBLIC_IP  # auto-detect failed"),
 * and every flag after them was appended with a ` \` that landed INSIDE that
 * comment: the command ended there and the hardening flags behind it were
 * silently dropped. The notes are now comment lines above the command, and
 * every command line but the last ends in ` \`.
 */
export function buildInstallCommand(input: InstallCommandInput): string {
  const notes: string[] = [];
  const flags = [`--panel-url ${input.panelUrl}`, `--bootstrap ${input.token}`, `--protocol ${input.protocol}`];

  const engines = enginesFlag(input.engines ?? []);
  if (engines) flags.push(engines);

  // Slice S7: the panel's egress IP locks the agent's UFW to it. When every
  // probe failed (offline egress?) the operator substitutes it by hand.
  if (input.panelIp) {
    flags.push(`--panel-ip ${input.panelIp}`);
  } else {
    flags.push('--panel-ip YOUR_PANEL_PUBLIC_IP');
    notes.push('# panel IP auto-detect failed: replace YOUR_PANEL_PUBLIC_IP below with the panel public IP');
  }

  // Hysteria is the only protocol that takes install-time ACME flags: the
  // domain and e-mail pre-baked here let its first config come up with a real
  // name. Naive / SS2022 / MTProto / Mieru take theirs from the panel's push.
  const acmeDomain = input.nodeAddress?.split(':')[0] ?? '';
  if (input.protocol === 'hysteria' && acmeDomain) {
    flags.push(`--hysteria-domain ${acmeDomain}`);
    if (input.acmeEmail) {
      flags.push(`--hysteria-email ${input.acmeEmail}`);
    } else {
      flags.push('--hysteria-email admin@example.com');
      notes.push('# set ACME_DEFAULT_EMAIL on the panel to inject the address automatically; replace admin@example.com below');
    }
  }

  flags.push(...hardeningFlags(input.hardening));

  return [
    ...notes,
    'bash <(curl -fsSL https://raw.githubusercontent.com/icecompany-tech/iceslab/main/scripts/install-iceslab-node.sh) \\',
    ...flags.map((f, i) => `  ${f}${i < flags.length - 1 ? ' \\' : ''}`),
  ].join('\n');
}

async function renderBootstrapCommand(
  panelUrl: string,
  token: string,
  protocol: string,
  nodeAddress?: string,
  hardening?: HardeningInput | null,
  engines: readonly string[] = [],
): Promise<string> {
  return buildInstallCommand({
    panelUrl,
    token,
    protocol,
    nodeAddress,
    hardening,
    engines,
    panelIp: await getPanelPublicIp(),
    acmeEmail: (process.env.ACME_DEFAULT_EMAIL ?? '').trim(),
  });
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
  const [{ nodes, total }, hidden] = await Promise.all([repo.list(query), getHiddenCascadeNodes()]);
  // One query each for the whole page, not one per node.
  const ids = nodes.map((n) => n.id);
  const [needed, cascadeNeeds] = await Promise.all([hostsByEngine(ids), cascadeNeedsByNode(ids)]);
  return {
    nodes: nodes.map((n) =>
      withHostCounts(n, hidden.get(n.id) ?? null, needed.get(n.id), cascadeNeeds.get(n.id) ?? []),
    ),
    total,
    page: query.page,
    limit: query.limit,
  };
}

export async function getNodeById(id: string): Promise<PublicNodeDto> {
  const node = await repo.findActiveById(id);
  if (!node) throw new NodeNotFoundError(id);
  const [hidden, needed, cascadeNeeds] = await Promise.all([
    getHiddenCascadeNodes(),
    hostsByEngine([id]),
    cascadeNeedsByNode([id]),
  ]);
  return withHostCounts(node, hidden.get(id) ?? null, needed.get(id), cascadeNeeds.get(id) ?? []);
}

/** The DTO as the list and GET by id serve it: the hiding cascade, `neededBy`
 *  on every core row that names its engine, and what the cascades need. */
function withHostCounts(
  node: Parameters<typeof mapNodeToPublic>[0],
  hiddenByCascade: PublicNodeDto['hiddenByCascade'],
  counts: Map<string, number> | undefined,
  cascadeNeedsEngines: CascadeEngineNeed[],
): PublicNodeDto {
  const dto = mapNodeToPublic(node);
  return { ...dto, cores: withNeededBy(dto.cores, counts), hiddenByCascade, cascadeNeedsEngines };
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
  // The engines, the primary's label and the sing-box flag move together, and
  // only when the body touches one of them.
  if (
    input.intendedEngines !== undefined ||
    input.protocol !== undefined ||
    input.singboxEngine !== undefined
  ) {
    const engines = resolveNodeEngines(input, {
      intendedEngines: intendedEngines(existing),
      protocol: existing.protocol,
      singboxEngine: existing.singboxEngine,
    });
    data.intendedEngines = engines.intendedEngines;
    data.protocol = engines.protocol;
    data.singboxEngine = engines.singboxEngine;
  }
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
  // Э3 F: the node's resolver. Prisma.JsonNull for the same reason as hardening
  // above: clearing a jsonb column needs JsonNull, not raw null.
  if (input.dns !== undefined) {
    data.dns = (input.dns as Prisma.InputJsonValue | null) ?? Prisma.JsonNull;
  }
  // Э3: attaching or detaching the node-level policy. Checked BEFORE the write,
  // so a policy this node cannot carry out (a WARP rule with no WARP here, a
  // cascade direction this node does not dial) is refused on the screen where
  // the operator chose it, rather than by the core minutes later in a worker log.
  if (input.policyId !== undefined) {
    if (input.policyId) await assertPolicyFitsNode(input.policyId, id);
    data.policyId = input.policyId;
  }
  // Which core versions the operator wants. `'coreVersions' in input`, not
  // `??`: an absent key is no edit, null is "every pin", and a map patches per
  // component. Checked against the manifest on the merged result.
  if ('coreVersions' in input && input.coreVersions !== undefined) {
    data.coreVersions = applyCoreVersionsPatch(
      readCoreVersions(existing.coreVersions),
      input.coreVersions,
    );
  }

  // Three fields feed the config we push to the agent, so editing any of them
  // has to re-push it. Detect them before the write, otherwise the live config
  // drifts until an unrelated binding/profile edit or an agent restart happens
  // to fire a sync. Caught in review 2026-06-17.
  //   domain  → per-node REALITY self-steal serverNames (and the client SNI)
  //   address → the name hysteria's ACME certificate is issued for, which has
  //             to match what clients dial; without a push the node keeps
  //             serving a certificate for the address it no longer has
  const domainChanged =
    input.domain !== undefined && input.domain !== existing.domain;
  const addressChanged =
    input.address !== undefined && input.address !== existing.address;
  //   dns     → the `dns` section of the node's core config. Clearing it counts:
  //             the config has to be rewritten WITHOUT the section, or the node
  //             keeps answering through a resolver the panel no longer shows.
  //             Compared by rendered form, the value carries arrays.
  const dnsChanged =
    input.dns !== undefined &&
    JSON.stringify(input.dns ?? null) !== JSON.stringify(existing.dns ?? null);

  // Attaching, swapping or detaching a policy changes what this node does with
  // traffic, so it has to reach the node. Detaching counts: the config must be
  // rewritten WITHOUT the rules, or the node keeps routing by a policy the
  // operator has just taken off it.
  const policyChanged =
    input.policyId !== undefined && input.policyId !== existing.policyId;

  const updated = await repo.updateById(id, data);

  if (domainChanged || addressChanged || dnsChanged) {
    eventBus.emit('node.updated', { nodeId: id, nodeName: updated.name });
  }
  if (policyChanged) {
    eventBus.emit('policy.changed', {
      policyId: input.policyId ?? existing.policyId ?? '',
      nodeIds: [id],
    });
  }
  // Read caches hold the node row as the subscription renders it, so any edit
  // can make them wrong, not just the domain. Moving a node to a new address
  // and having clients dial the old one for another minute is the case that
  // matters. Separate from node.updated on purpose: this must not re-push
  // config and restart the protocol server (see the event's declaration).
  if (Object.keys(data).length > 0) {
    eventBus.emit('node.changed', { nodeId: id });
  }

  return mapNodeToPublic(updated);
}

export async function deleteNode(id: string): Promise<void> {
  const node = await prisma.node.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, name: true, address: true },
  });
  if (!node) throw new NodeNotFoundError(id);

  /**
   * A live cascade keeps its node.
   *
   * THE INCIDENT, 2026-09-22. A node was deleted while an enabled cascade
   * routed a direction through it. Nothing stopped that: the code below drops
   * cascades the node is a legacy HOP of, and the v4 topology, where the node
   * was a direction member, was left pointing at a row with no address. From
   * then on the renderer refused to build a push for the cascade's entries at
   * all, so the two RU entries stopped receiving config, and nobody found out
   * until their cores were restarted a day later and came up empty.
   *
   * Refused rather than cascaded-deleted, and only for ENABLED cascades: taking
   * somebody's live chain down as a side effect of retiring one VPS is a bigger
   * decision than the click that triggered it. A disabled cascade is not
   * serving anyone, so the old behaviour stands there.
   */
  const live = await prisma.cascade.findMany({
    where: {
      enabled: true,
      OR: [
        { hops: { some: { nodeId: id } } },
        { positions: { some: { nodes: { some: { nodeId: id } } } } },
        { directions: { some: { nodes: { some: { nodeId: id } } } } },
      ],
    },
    select: { name: true },
  });
  if (live.length > 0) {
    throw new NodeInUseByCascadeError(node.name, live.map((c) => c.name));
  }

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

  // Stop serving this node's endpoints now. cascade.changed below fires only
  // when the node happened to be a hop, so an ordinary delete needs its own
  // signal or the subscription keeps advertising a node that is gone.
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
