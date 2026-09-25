import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { TRANSPORTS, type EngineName } from '@iceslab/shared';
import { requireAuth } from '../auth/auth.hook.js';
import { config } from '../../config.js';
import {
  CreateNodeSchema,
  UpdateNodeSchema,
  ListNodesQuerySchema,
  NodeIdParamSchema,
  type HardeningInput,
} from './nodes.schemas.js';
import * as nodesService from './nodes.service.js';
import { buildInstallCommand } from './nodes.service.js';
import { checkNodePortExposure } from './nodes.exposure.js';
import { getNodeSyncStatus } from './nodes.sync-status.js';
import { portClaimsOnNode } from './node-ports.js';
import { readChainSecret } from './chain-secret.js';
import { PolicyDoesNotFitNodeError } from '../node-policies/node-policies.service.js';
import * as bootstrap from './bootstrap.service.js';
import { getPanelPublicIp } from './panel-ip.js';

/**
 * Derive the panel URL the admin is currently using to talk to the API.
 * Prefers PUBLIC_URL env var (set in docker-compose) over request-derived
 * heuristics, the heuristic breaks when Caddy doesn't forward X-Forwarded-Proto.
 */
function publicUrlFromRequest(request: FastifyRequest): string {
  if (config.PUBLIC_URL) return config.PUBLIC_URL.replace(/\/$/, '');
  const xfHost = request.headers['x-forwarded-host']?.toString();
  const proto =
    request.headers['x-forwarded-proto']?.toString() ||
    (xfHost ? 'https' : (request as unknown as { protocol?: string }).protocol) ||
    'http';
  const host = xfHost || request.headers.host || 'localhost:3000';
  return `${proto}://${host}`;
}

const BootstrapTokenParam = z.object({ token: z.string().regex(/^bs_[A-Za-z0-9_-]+$/).max(64) });
const auth = { onRequest: [requireAuth] };

// The /api/nodes/:id/bootstrap endpoint renders the command without going
// through the service path; the renderer itself is the service's, so the two
// commands cannot drift.
async function renderRefreshBootstrapCommand(
  panelUrl: string,
  token: string,
  nodeAddress: string,
  hardening: HardeningInput | null | undefined,
  engines: readonly EngineName[],
): Promise<string> {
  return buildInstallCommand({
    panelUrl,
    token,
    nodeAddress,
    hardening,
    engines,
    panelIp: await getPanelPublicIp(),
    acmeEmail: (process.env.ACME_DEFAULT_EMAIL ?? '').trim(),
  });
}

export async function nodesRoutes(app: FastifyInstance): Promise<void> {
  // Public bootstrap-redeem route: the token IS the credential (single-use,
  // 15-min TTL). Per-route auth opt-in pattern matches auth.routes.ts and
  // avoids the addHook scope ambiguity that previously made this 401.
  app.get('/api/internal/bootstrap/:token', {
    config: {
      // Token is a one-shot 192-bit secret, but we still don't want to be
      // a guessing oracle. 10 attempts/min/IP is enough for the legitimate
      // single redeem and slow enough that brute-forcing within the 15-min
      // TTL is infeasible.
      rateLimit: {
        max: config.RATE_LIMIT_BOOTSTRAP_PER_MIN,
        timeWindow: '1 minute',
      },
    },
  }, async (request, reply) => {
    const params = BootstrapTokenParam.parse(request.params);
    try {
      const payload = await bootstrap.redeemBootstrapToken(params.token);
      return reply.type('text/plain').send(payload);
    } catch (err) {
      if (err instanceof bootstrap.BootstrapTokenError) {
        return reply.code(err.httpStatus).send({
          error: err.reason,
          message: err.message,
        });
      }
      throw err;
    }
  });

  // Slice 38: heartbeat self-destruct. Public-but-Bearer-authed; the
  // bearer is an HMAC the agent received in its bootstrap payload.
  await app.register(
    async (s) => {
      const { heartbeatRoutes } = await import('./heartbeat.routes.js');
      await heartbeatRoutes(s);
    },
    { prefix: '/api/internal/nodes' },
  );

  app.post('/api/nodes', auth, async (request, reply) => {
    const input = CreateNodeSchema.parse(request.body);
    try {
      const node = await nodesService.createNode(input, {
        panelUrl: publicUrlFromRequest(request),
      });
      return reply.code(201).send(node);
    } catch (err) {
      if (err instanceof nodesService.NodeAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      // intendedEngines, protocol and singboxEngine that contradict each other.
      if (err instanceof nodesService.NodeEnginesError) {
        return reply.code(400).send({ error: err.code, message: err.message, path: [err.path] });
      }
      if (err instanceof nodesService.CoreVersionIntentError) {
        return reply
          .code(400)
          .send({ error: err.code, message: err.message, problems: err.problems });
      }
      throw err;
    }
  });

  app.post('/api/nodes/:id/bootstrap', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      const node = await nodesService.getNodeById(params.id);
      const tokenInfo = await bootstrap.issueBootstrapToken(node.id);
      return reply.code(201).send({
        token: tokenInfo.token,
        expiresAt: tokenInfo.expiresAt.toISOString(),
        command: await renderRefreshBootstrapCommand(
          publicUrlFromRequest(request),
          tokenInfo.token,
          node.address,
          node.hardening,
          node.intendedEngines,
        ),
      });
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  /**
   * The chain process's socks password, for acceptance on a stand.
   *
   * ⚠ THE ONLY WAY THIS SECRET LEAVES THE PANEL other than the chain block
   * itself, and the reason it exists at all is that the field test has to check
   * that the password the node's core presents is the one its chain expects.
   * The alternative is reading a config file over ssh, which is exactly the
   * manual step this panel is meant to remove.
   *
   * Behind the same admin auth as the bootstrap token, which is the access
   * class it belongs to: both hand over something that lets a holder talk to a
   * node as if they were us. It never mints, so asking about a node with no
   * chain answers `null` rather than quietly creating a credential.
   */
  app.get('/api/nodes/:id/chain-secret', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      await nodesService.getNodeById(params.id);
      return reply.send({ secret: await readChainSecret(params.id) });
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  /**
   * Is this port free on this node, and how sure are we?
   *
   * Its own endpoint rather than a warning on the 201, because the panel asks
   * when the operator leaves the port field, and a 201 arrives after the save
   * they were trying to get right.
   *
   * The answer never says "free" without saying how completely it looked.
   * Three sources claim a node's ports: bindings and cascade legs, which are
   * ours, and the services a core opens for itself, which only the node knows.
   * A node that has never reported, or one whose agent predates that field,
   * leaves the third source silent, and `certainty: 'partial'` is how the
   * screen says "nothing known against it" instead of "free".
   *
   * `ok` answers the question asked, so it is false only when something is
   * actually in the way. A partial answer with no conflicts is `ok: true,
   * certainty: 'partial'`: refusing on ignorance would block the port a node
   * has legitimately had free since before the agent could say so.
   */
  app.post('/api/nodes/:id/port-check', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    const body = z
      .object({
        port: z.number().int().min(1).max(65535),
        // Required, not defaulted: 443/TCP and 443/UDP are different sockets,
        // and a default here would answer a question nobody asked.
        transport: z.enum(TRANSPORTS),
        // The binding being edited, so an unchanged save does not report the
        // row colliding with itself.
        exceptBindingId: z.string().uuid().optional(),
      })
      .parse(request.body);
    try {
      // 404 before the check: "no conflicts on a node that does not exist" is
      // a true sentence and a useless one.
      await nodesService.getNodeById(params.id);
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
    const { owners, certainty } = await portClaimsOnNode(params.id, [body.port], {
      exceptBindingId: body.exceptBindingId,
    });
    const conflicts = owners.filter((o) => o.transport === body.transport);
    // Who holds the SAME number on the OTHER transport, when anybody does.
    //
    // The port is free and the screen should say more than "free": 443/UDP
    // beside a REALITY on 443/TCP is the pair the panel used to refuse, and an
    // operator who has just been told that is a collision deserves to be told,
    // by name, that it is not. The panel cannot work it out on its own, because
    // "who listens on the other socket" was never in any answer it gets.
    //
    // null when the number is free on both, so the screen has one thing to test
    // rather than an empty object to interpret.
    const other = owners.find((o) => o.transport !== body.transport);
    return reply.send({
      ok: conflicts.length === 0,
      certainty,
      conflicts,
      otherTransport: other ? { holder: other } : null,
      // A KEY, like ownerKey, for the same reason: the screen is bilingual and
      // writes the sentence itself. null when there is nothing to explain.
      note:
        certainty === 'full'
          ? null
          : 'reserved-ports-unknown',
    });
  });

  // WARP egress (feat/warp-native): register a free Cloudflare WARP device for
  // this node and enable per-node egress. The Cloudflare call lives in the warp
  // service; this is the live path of the registration spike.
  app.post('/api/nodes/:id/warp/register', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      return reply.send(await nodesService.registerNodeWarp(params.id));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // Turn off WARP egress (keeps the registered creds for instant re-enable).
  app.delete('/api/nodes/:id/warp', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      return reply.send(await nodesService.disableNodeWarp(params.id));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/nodes', auth, async (request, reply) => {
    const query = ListNodesQuerySchema.parse(request.query);
    return reply.send(await nodesService.listNodes(query));
  });

  app.get('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      return reply.send(await nodesService.getNodeById(params.id));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // Did the last save reach this machine? The node card draws "saved, not
  // applied yet" from this; see nodes.sync-status for why the answer needs the
  // bindings, profiles, hosts and cascades behind the node and not just its row.
  app.get('/api/nodes/:id/sync-status', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    const status = await getNodeSyncStatus(params.id);
    if (!status) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(status);
  });

  // G4 probe-exposure: compare the node's open ufw ports to the expected set.
  // Advisory + best-effort (an old/unreachable agent or ufw-less host returns
  // checked:false), so it never throws a 4xx/5xx for a reachable request.
  app.get('/api/nodes/:id/exposure', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    return reply.send(await checkNodePortExposure(params.id));
  });

  app.put('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    const input = UpdateNodeSchema.parse(request.body);
    try {
      return reply.send(await nodesService.updateNode(params.id, input));
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof nodesService.NodeAlreadyExistsError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      // Э3: the policy the operator just chose cannot be carried out here (a
      // WARP rule with no WARP on this node, a cascade direction it does not
      // dial). 409, and the message names the node and the reason: the core
      // would refuse it too, but minutes later and in a worker log.
      if (err instanceof PolicyDoesNotFitNodeError) {
        return reply
          .code(409)
          .send({ error: 'POLICY_DOES_NOT_FIT_NODE', message: err.message });
      }
      // A version the manifest does not list: no checksum to install it by.
      // `problems` names each component and what it can be instead.
      // intendedEngines, protocol and singboxEngine that contradict each other.
      if (err instanceof nodesService.NodeEnginesError) {
        return reply.code(400).send({ error: err.code, message: err.message, path: [err.path] });
      }
      if (err instanceof nodesService.CoreVersionIntentError) {
        return reply
          .code(400)
          .send({ error: err.code, message: err.message, problems: err.problems });
      }
      throw err;
    }
  });

  app.delete('/api/nodes/:id', auth, async (request, reply) => {
    const params = NodeIdParamSchema.parse(request.params);
    try {
      await nodesService.deleteNode(params.id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof nodesService.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      // The node is a hop or a way out of a cascade that is switched on.
      // Named separately from CONFLICT so the screen can link straight to the
      // cascades instead of leaving the operator to find them.
      if (err instanceof nodesService.NodeInUseByCascadeError) {
        return reply.code(409).send({
          error: err.code,
          message: err.message,
          cascades: err.cascades,
        });
      }
      throw err;
    }
  });
}
