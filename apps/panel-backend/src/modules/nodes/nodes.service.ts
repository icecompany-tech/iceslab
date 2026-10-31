import { randomBytes } from 'node:crypto';
import { Prisma } from '../../generated/prisma/client.js';
import { issueNodeCert, encodeNodePayload } from '../keygen/keygen.service.js';
import { eventBus } from '../../lib/infra/event-bus.js';
import { prisma } from '../../prisma.js';
import { anyChanged } from '../../lib/util/same-value.js';
import { NODE_LINK_FIELDS } from '../hosts/hosts.freshness.js';
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
  NODE_DTO_FIELDS,
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
import { resolveCoreVersions, type EngineName } from '@iceslab/shared';
import { applyCoreVersionsPatch, readCoreVersions } from './node-core-versions.js';
import { hostsByEngine, withNeededBy } from './node-core-gate.js';
import { cascadeNeedsByNode, type CascadeEngineNeed } from './node-cascade-needs.js';
import { engineSet, resolveNodeEngines } from './node-intended-engines.js';
import { acmeHostnameFor } from '../inbounds/acme-hostname.js';
import { publicHysteriaTls, rotateHysteriaTls, type PublicHysteriaTls } from './hysteria-tls.js';
import { collectGeoUses } from '../geo-sets/geo-refs.js';
import { nodeGeoFor, publicIntended } from '../geo-sets/geo-push.js';
import { intendedEngines } from './node-engines.js';
import { isUniqueViolationOn } from '../../lib/util/unique-violation.js';
import { readCurrentVersion } from '../system/system.service.js';
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
      `Node "${nodeName}" is part of the cascade${cascades.length > 1 ? 's' : ''} ` +
        `${cascades.map((c) => `"${c}"`).join(', ')}. Deleting it would leave ${
          cascades.length > 1 ? 'those chains' : 'that chain'
        } pointing at a node that is gone, and the panel would stop pushing config to ` +
        `every node in ${cascades.length > 1 ? 'them' : 'it'}, now or the day ${
          cascades.length > 1 ? 'they are' : 'it is'
        } switched on. Move this node out of the cascade, or delete the cascade, and then ` +
        `delete this one.`,
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

/**
 * A write that passed the app-level checks and met a unique index: two saves
 * at once. The indexes are partial (`WHERE deleted_at IS NULL`, 20260506), so
 * a soft-deleted node holds neither its name nor its address.
 *
 * ⚠ Read from what the error NAMES (A-127, A-257). meta.target is absent
 * through the pg adapter, and reading it made every clash "name", an address
 * clash included. `nodes_source_id_key` is not here on purpose: no panel path
 * writes `source_id` (the import tool does), so a clash on it, like any other
 * index, is not worded as a name and goes up as it is.
 */
function nodeClashOf(err: unknown, input: { name?: string; address?: string }): NodeAlreadyExistsError | null {
  if (isUniqueViolationOn(err, 'nodes_address_active_key', ['address'])) {
    return new NodeAlreadyExistsError('address', input.address ?? '');
  }
  if (isUniqueViolationOn(err, 'nodes_name_active_key', ['name'])) {
    return new NodeAlreadyExistsError('name', input.name ?? '');
  }
  return null;
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
  // The set of cores, the label derived from it and the sing-box flag, in step.
  const engines = resolveNodeEngines(input);

  let node;
  try {
    node = await repo.create({
      name: input.name,
      address: input.address,
      protocol: engines.protocol,
      intendedEngines: engines.intendedEngines,
      countryCode: input.countryCode ?? null,
      consumptionMultiplierTenths: Math.round(input.consumptionMultiplier * 10),
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
    throw nodeClashOf(err, input) ?? err;
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
 * The cores the node is installed with, Node.intendedEngines, as the one flag
 * that names them: `--engines a,b,c`, one core too. No --protocol beside it
 * (25.09: a node has no main core, the installer takes the set). The installer
 * still reads --protocol from the commands an older panel printed.
 *
 * In the order of ENGINE_NAMES, so one set is always one line. null for the
 * empty set: no flag, and the installer puts the agent alone.
 */
export function enginesFlag(engines: readonly EngineName[]): string | null {
  return engines.length > 0 ? `--engines ${engineSet(engines).join(',')}` : null;
}

export interface InstallCommandInput {
  panelUrl: string;
  token: string;
  nodeAddress?: string;
  hardening?: HardeningInput | null;
  engines: readonly EngineName[];
  /** The panel's public IP, or null when every probe failed. */
  panelIp: string | null;
  /** ACME_DEFAULT_EMAIL, trimmed; empty when unset. */
  acmeEmail: string;
  /** The panel's own version (readCurrentVersion). A release version pins
   *  the installer and the agent it installs to that tag (A-270). */
  panelVersion?: string;
}

/**
 * The git tag a panel version installs its nodes from (A-270), or null.
 *
 * A node created on a panel gets the agent of that panel's release: the
 * installer from the tag v<version> and ICESLAB_NODE_REF=v<version>, which the
 * installer clones (install-iceslab-node.sh: ICESLAB_NODE_REF, its own default
 * pinned to an older release). Before, the command took the installer from
 * main with no ref, and a node made on a 0.3.0-rc.1 panel came up on v0.2.1.
 *
 * Only a release version names a tag: major.minor.patch with an optional
 * pre-release ("0.3.0", "0.3.0-rc.1"). Anything else (unknown, a dev build,
 * empty, build metadata "+...") has no tag to point at and keeps the old
 * command: the installer from main, its own default ref.
 */
export function installRefOf(panelVersion: string | undefined): string | null {
  const v = (panelVersion ?? '').trim().replace(/^v/i, '');
  return /^\d+\.\d+\.\d+(-[0-9A-Za-z.]+)?$/.test(v) ? `v${v}` : null;
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
  const flags = [`--panel-url ${input.panelUrl}`, `--bootstrap ${input.token}`];
  const engines = enginesFlag(input.engines);
  if (engines) flags.push(engines);

  // Slice S7: the panel's egress IP locks the agent's UFW to it. When every
  // probe failed (offline egress?) the operator substitutes it by hand.
  if (input.panelIp) {
    flags.push(`--panel-ip ${input.panelIp}`);
  } else {
    flags.push('--panel-ip YOUR_PANEL_PUBLIC_IP');
    notes.push('# panel IP auto-detect failed: replace YOUR_PANEL_PUBLIC_IP below with the panel public IP');
  }

  // Hysteria is the only core that takes install-time ACME flags: the domain
  // and e-mail pre-baked here let its first config come up with a real name.
  // By the core being in the set, not by it being first: there is no first.
  // Naive / SS2022 / MTProto / Mieru take theirs from the panel's push.
  //
  // Only a name a public CA issues for (E30, 25.09: ru-01 on an IP got
  // `--hysteria-domain 46.149.66.235`, which Let's Encrypt refuses). Read the
  // way the push reads it, acmeHostnameFor: the node's ADDRESS, what a hysteria
  // client dials and sends as SNI, never `domain`, which is the REALITY
  // self-steal camouflage name and would give a certificate no client checks.
  const acmeDomain = acmeHostnameFor(input.nodeAddress);
  if (input.engines.includes('hysteria') && acmeDomain) {
    flags.push(`--hysteria-domain ${acmeDomain}`);
    // A-276: no email is a working install (the agent renders ACME without
    // one), and a placeholder is not: Let's Encrypt refuses a contact at
    // example.com/.net/.org (boulder policy/pa.go, forbiddenMailDomains), so
    // the admin@example.com this used to write never got a certificate.
    if (input.acmeEmail) {
      flags.push(`--hysteria-email ${input.acmeEmail}`);
    } else {
      // The ACME account's contact, nothing more: Let's Encrypt stopped its
      // expiry emails on 4 June 2025 (letsencrypt.org/2025/01/22/ending-expiration-emails).
      notes.push("# optional: --hysteria-email you@domain, the ACME account's contact");
    }
  }

  flags.push(...hardeningFlags(input.hardening));

  const ref = installRefOf(input.panelVersion);
  const installer = `https://raw.githubusercontent.com/icecompany-tech/iceslab/${ref ?? 'main'}/scripts/install-iceslab-node.sh`;
  return [
    ...notes,
    `${ref ? `ICESLAB_NODE_REF=${ref} ` : ''}bash <(curl -fsSL ${installer}) \\`,
    ...flags.map((f, i) => `  ${f}${i < flags.length - 1 ? ' \\' : ''}`),
  ].join('\n');
}

/**
 * The command a panel shows, its own version read where the update check
 * reads it (readCurrentVersion): one place, for node create and for a
 * refreshed bootstrap alike (A-270).
 */
export function panelInstallCommand(input: Omit<InstallCommandInput, 'panelVersion'>): string {
  return buildInstallCommand({ ...input, panelVersion: readCurrentVersion() });
}

async function renderBootstrapCommand(
  panelUrl: string,
  token: string,
  nodeAddress: string | undefined,
  hardening: HardeningInput | null | undefined,
  engines: readonly EngineName[],
): Promise<string> {
  return panelInstallCommand({
    panelUrl,
    token,
    nodeAddress,
    hardening,
    engines,
    panelIp: await getPanelPublicIp(),
    acmeEmail: (process.env.ACME_DEFAULT_EMAIL ?? '').trim(),
  });
}
export async function listNodes(query: ListNodesQuery): Promise<{
  nodes: PublicNodeDto[];
  total: number;
  page: number;
  limit: number;
  /** NODE_DTO_FIELDS: what this server renders, answered with no node too. */
  fields: readonly string[];
}> {
  const [{ nodes, total }, hidden] = await Promise.all([repo.list(query), getHiddenCascadeNodes()]);
  // One query each for the whole page, not one per node.
  const ids = nodes.map((n) => n.id);
  const [needed, cascadeNeeds, geoSites] = await Promise.all([
    hostsByEngine(ids),
    cascadeNeedsByNode(ids),
    collectGeoUses(),
  ]);
  const geoIntended = await Promise.all(nodes.map((n) => nodeGeoFor(n.id, { pinMissing: false, sites: geoSites })));
  return {
    nodes: nodes.map((n, i) => ({
      ...withHostCounts(n, hidden.get(n.id) ?? null, needed.get(n.id), cascadeNeeds.get(n.id) ?? []),
      geoIntended: publicIntended(geoIntended[i] ?? null),
    })),
    total,
    page: query.page,
    limit: query.limit,
    fields: NODE_DTO_FIELDS,
  };
}

export async function getNodeById(id: string): Promise<PublicNodeDto> {
  const node = await repo.findActiveById(id);
  if (!node) throw new NodeNotFoundError(id);
  const [hidden, needed, cascadeNeeds, geoIntended] = await Promise.all([
    getHiddenCascadeNodes(),
    hostsByEngine([id]),
    cascadeNeedsByNode([id]),
    nodeGeoFor(id, { pinMissing: false }),
  ]);
  return {
    ...withHostCounts(node, hidden.get(id) ?? null, needed.get(id), cascadeNeeds.get(id) ?? []),
    geoIntended: publicIntended(geoIntended),
  };
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
  // A-049: the warp block is part of the pushed config; without the event the
  // node kept its old egress until some unrelated edit pushed it.
  eventBus.emit('node.updated', { nodeId: id, nodeName: node.name });
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
  // A-049, as on register: the node drops the warp block on the push this starts.
  if (existing.warpEnabled) eventBus.emit('node.updated', { nodeId: id, nodeName: node.name });
  return mapNodeToPublic(node);
}

/** A rotation asked of a node whose hysteria takes ACME: there is nothing self-signed to rotate. */
export class HysteriaTlsNotSelfSignedError extends Error {
  readonly code = 'HYSTERIA_TLS_NOT_SELF_SIGNED';
  constructor(public nodeName: string) {
    super(`Node "${nodeName}" has a domain name as its address, so its hysteria takes an ACME certificate: there is no self-signed one to rotate`);
    this.name = 'HysteriaTlsNotSelfSignedError';
  }
}

/**
 * E30a: a new self-signed pair for the node's native hysteria, pushed at once.
 * Every link with the old pin stops connecting until its subscription is
 * refreshed: that is what rotating means.
 */
export async function rotateNodeHysteriaTls(id: string): Promise<PublicHysteriaTls> {
  const node = await repo.findActiveById(id);
  if (!node) throw new NodeNotFoundError(id);
  const fresh = await rotateHysteriaTls(id);
  if (!fresh) throw new HysteriaTlsNotSelfSignedError(node.name);
  eventBus.emit('node.updated', { nodeId: node.id, nodeName: node.name });
  return publicHysteriaTls(fresh)!;
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
  // The set, its label and the sing-box flag are not edited here (E42): they
  // follow what the node's env declares, written by the poller on every report
  // (intendedFromReport). `protocol` in a body is no edit either (25.09).
  if (input.countryCode !== undefined) data.countryCode = input.countryCode;
  if (input.consumptionMultiplier !== undefined) {
    // A-143: the schema let only steps of 0.1 through; stored in tenths.
    data.consumptionMultiplierTenths = Math.round(input.consumptionMultiplier * 10);
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

  // A-122: the address and the self-steal SNI are in every link of this node;
  // name and country only in its label (NODE_LINK_FIELDS).
  if (anyChanged(existing, data as Partial<typeof existing>, NODE_LINK_FIELDS)) data.linkChangedAt = new Date();

  let updated;
  try {
    updated = await repo.updateById(id, data);
  } catch (err) {
    throw nodeClashOf(err, input) ?? err;
  }

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

/**
 * A-279: what a deleted node no longer keeps, the fields of models/nodes.prisma
 * that are secrets or key material. The migration
 * 20261026100207_deleted_node_secrets clears the same on rows deleted before.
 */
export const TOMBSTONE_CLEARS = {
  chainSecret: null,
  hysteriaTls: Prisma.DbNull,
  warpAccount: Prisma.DbNull,
  publicKey: null,
} satisfies Prisma.NodeUpdateInput;

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
   * Refused rather than cascaded-deleted: taking somebody's chain down as a
   * side effect of retiring one VPS is a bigger decision than the click that
   * triggered it.
   *
   * ⚠ For a SWITCHED-OFF cascade too (A-126, rest of A-023). It used to be
   * allowed there, as "serving nobody", but the delete below drops only
   * cascades the node is a legacy hop of, so a v4 cascade kept its positions
   * and directions pointing at the deleted row, and switching it back on
   * repeated 2026-09-22 a step later. A disabled cascade is still a plan that
   * one toggle puts live.
   */
  const live = await prisma.cascade.findMany({
    where: {
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

  // The guard above refuses every cascade the node is in, legacy hops
  // included, so there is no cascade left to drop with it: the old delete of
  // the hop's whole cascade and the re-push of its survivors never runs now.
  //
  // One transaction: hard-delete this node's profile bindings (leaving them
  // made a re-install look double-bound), and soft-delete the node row (kept
  // for audit history).
  //
  // A-279: the row that stays is a tombstone. Its secrets go in the same
  // write (models/nodes.prisma: chain_secret, hysteria_tls, warp_account,
  // public_key); the id and heartbeat_secret stay for good, since the agent
  // removes itself only on the 410 a valid heartbeat token gets
  // (heartbeat.routes.ts), and an agent offline at the delete needs it later.
  await prisma.$transaction([
    prisma.profileNodeBinding.deleteMany({ where: { nodeId: id } }),
    prisma.node.update({ where: { id }, data: { deletedAt: new Date(), ...TOMBSTONE_CLEARS } }),
  ]);

  // Stop serving this node's endpoints now, or the subscription keeps
  // advertising a node that is gone.
  eventBus.emit('node.deleted', { nodeId: id });

  notifyTelegramAsync(
    `🗑 *Node deleted*\nname: \`${escapeMarkdown(node.name)}\`\naddress: \`${escapeMarkdown(node.address)}\``,
  );
}
