import { diffProfileRevision, listProfileRevisions, ProfileRevisionError, type RevisionMetadata } from './profiles.revisions.js';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import {
  generateWireguardKeyPair,
  generateRealityKeyPair,
} from '../../lib/auth/credentials.js';
import {
  BindingIdParamSchema,
  CreateBindingSchema,
  CreateProfileSchema,
  ListBindingsQuerySchema,
  ListProfilesQuerySchema,
  ProfileIdParamSchema,
  UpdateBindingSchema,
  UpdateProfileSchema,
} from './profiles.schemas.js';
import { resolveHostFields } from './host-fields.js';
import { profileFormats } from './profile-formats.js';
import { getProfileKeyImpact } from './profiles.key-impact.js';
import { coreGateReply } from '../nodes/node-core-gate.js';
import { AdapterSlotTakenError, MieruMtuMismatchError } from '../nodes/node-adapter-slot.js';
import * as svc from './profiles.service.js';
import { prisma } from '../../prisma.js';
import { isRestrictedToken, withStoredSecrets } from '../auth/token-secrets.js';

const KeypairQuery = z.object({
  protocol: z.enum(['xray', 'amneziawg']).default('amneziawg'),
});

const FormatsQuery = z.object({
  securityLayer: z.enum(['default', 'tls', 'none']).optional(),
});

const RevisionNumber = z.number().int().positive().max(2_147_483_647);
const RevisionListQuery = z.object({ before: z.coerce.number().pipe(RevisionNumber).optional() });
const RevisionParams = ProfileIdParamSchema.extend({ revision: z.coerce.number().pipe(RevisionNumber) });
const RestoreRevisionBody = z.object({ expectedCurrentRevision: RevisionNumber });
const RevisionSource = z.enum(['form', 'console', 'recipe', 'import']);

async function revisionMetadata(req: FastifyRequest): Promise<RevisionMetadata> {
  const source = RevisionSource.safeParse((req.body as { revisionSource?: unknown } | null)?.revisionSource).data;
  if (req.apiToken) return { source, actor: { type: 'apiToken', name: req.apiToken.name } };
  if (!req.admin) return { source };
  const admin = await prisma.adminUser.findUnique({
    where: { id: req.admin.id }, select: { username: true },
  });
  return { source, actor: admin ? { type: 'admin', name: admin.username } : undefined };
}

function replyProfileEditError(err: unknown, reply: FastifyReply) {
  if (err instanceof ProfileRevisionError) {
    const status = err.code === 'PROFILE_REVISION_NOT_FOUND' ? 404 : 409;
    return reply.code(status).send({ error: err.code, currentRevision: err.currentRevision });
  }
  if (err instanceof svc.ProfileNotFoundError) {
    return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
  }
  if (err instanceof svc.ProfileNameTakenError) {
    return reply.code(409).send({ error: 'CONFLICT', message: err.message });
  }
  if (err instanceof svc.ProfileEngineNotForSubprotocolError) {
    return reply.code(400).send({ error: err.code, message: err.message });
  }
  if (err instanceof svc.ProfileAwgProtocolNotAwgError) {
    return reply.code(400).send({ error: err.code, message: err.message, path: err.path });
  }
  // A-055 on an edit: the adapter the profile moves onto is taken on one of
  // its nodes. The same body as a binding gets.
  if (err instanceof MieruMtuMismatchError) {
    return reply.code(409).send({ error: err.code, message: err.message, nodeName: err.nodeName, mtu: err.mtu, wanted: err.wanted, heldBy: err.heldBy });
  }
  if (err instanceof AdapterSlotTakenError) {
    return reply.code(409).send({
      error: err.code,
      message: err.message,
      nodeName: err.nodeName,
      protocol: err.protocol,
      engine: err.engine,
      heldBy: err.heldBy,
    });
  }
  // Moving the profile to 3.1 while a node it is on runs a 1.x module:
  // AWG_PROTOCOL_MISMATCH, the answer a binding gets.
  const core = coreGateReply(err);
  if (core) return reply.code(core.status).send(core.body);
  // The field sing-box cannot serve on an xray-family profile, with its
  // path, as the create path's schema issue carries it.
  if (err instanceof svc.ProfileEngineNotForTransportError) {
    return reply.code(400).send({ error: err.code, message: err.message, path: err.path });
  }
  // Switching the engine would leave this profile deployed on a node whose
  // cores cannot serve it. Named separately from CONFLICT so the screen can
  // point at the node instead of at the field.
  if (err instanceof svc.ProfileDoesNotRunOnNodeError) {
    return reply.code(409).send({
      error: 'PROFILE_DOES_NOT_RUN_ON_NODE',
      message: err.message,
      // The same answer in machine form, so the sentence can one day be
      // rebuilt in the operator's language without changing this contract.
      // See ProfileDoesNotRunOnNodeError for what each one means.
      nodeName: err.nodeName,
      neededEngine: err.neededEngine,
      reportedEngines: err.reportedEngines,
      canWait: err.canWait,
    });
  }
  // The edit moves the profile onto the other transport, and somebody else
  // already holds that socket on one of its nodes. Named separately from
  // CONFLICT for the same reason as above: the screen points at the nodes,
  // and the list of them travels in machine form.
  if (err instanceof svc.TransportMoveBlockedError) {
    return reply.code(409).send({
      error: 'TRANSPORT_MOVE_BLOCKED',
      message: err.message,
      transport: err.transport,
      conflicts: err.conflicts,
    });
  }
  throw err;
}

export async function profilesRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  // curve25519 keypair for REALITY (xray) or AmneziaWG. Same crypto, the
  // alphabets differ, REALITY needs base64url, AWG needs standard base64.
  app.post('/api/profiles/generate-keypair', auth, async (req, reply) => {
    const { protocol } = KeypairQuery.parse(req.query);
    const pair =
      protocol === 'xray' ? generateRealityKeyPair() : generateWireguardKeyPair();
    return reply.send(pair);
  });

  // ───── Profiles ─────

  app.post('/api/profiles', auth, async (req, reply) => {
    const input = CreateProfileSchema.parse(req.body);
    try {
      const p = await svc.createProfile(input, await revisionMetadata(req));
      return reply.code(201).send(p);
    } catch (err) {
      if (err instanceof svc.ProfileNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/profiles', auth, async (req, reply) => {
    const q = ListProfilesQuerySchema.parse(req.query);
    return reply.send({ profiles: await svc.listProfiles(q) });
  });

  app.get('/api/profiles/:id', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getProfileById(id));
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // What regenerating this profile's key would cost. The confirm dialog had
  // honest counts for hosts and nodes and an empty slot for the one number that
  // matters, how many client configs stop working: that is a question about
  // squad ACL, which only the panel can answer.
  app.get('/api/profiles/:id/key-impact', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const impact = await getProfileKeyImpact(id);
    if (!impact) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(impact);
  });

  // Which Host fields mean anything for this profile, plus what each one
  // inherits when the host leaves it NULL. The set depends on the profile's
  // config (transport, security layer), not just its protocol, so it is
  // resolved per profile rather than served as a static table. See
  // host-fields.ts for why most fields are dead outside xray.
  app.get('/api/profiles/:id/host-fields', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    try {
      const p = await svc.getProfileById(id);
      return reply.send({ fields: resolveHostFields(p.protocol, p.config) });
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // Which subscription formats carry this profile, and why not where they do
  // not: { door, formats: [{ format, carried, why, reason }] }, one entry per
  // FORMAT_NAMES. `?securityLayer=` is the host screen's own override (tls /
  // none), because a REALITY profile fronted by a TLS host reaches formats the
  // bare profile does not; 'default' or absent means the profile's own.
  app.get('/api/profiles/:id/formats', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const { securityLayer } = FormatsQuery.parse(req.query);
    try {
      const p = await svc.getProfileById(id);
      return reply.send(profileFormats(p.protocol, p.config, securityLayer));
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.get('/api/profiles/:id/revisions', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const { before } = RevisionListQuery.parse(req.query);
    try {
      return reply.send(await listProfileRevisions(id, before));
    } catch (err) {
      return replyProfileEditError(err, reply);
    }
  });

  app.get('/api/profiles/:id/revisions/:revision/diff', auth, async (req, reply) => {
    const { id, revision } = RevisionParams.parse(req.params);
    try {
      return reply.send(await diffProfileRevision(id, revision));
    } catch (err) {
      return replyProfileEditError(err, reply);
    }
  });

  app.post('/api/profiles/:id/revisions/:revision/restore', auth, async (req, reply) => {
    const { id, revision } = RevisionParams.parse(req.params);
    const { expectedCurrentRevision } = RestoreRevisionBody.parse(req.body);
    try {
      const { actor } = await revisionMetadata(req);
      return reply.send(await svc.restoreProfileRevision(id, { revision, expectedCurrentRevision }, { actor }));
    } catch (err) {
      return replyProfileEditError(err, reply);
    }
  });

  app.put('/api/profiles/:id', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const input = UpdateProfileSchema.parse(req.body);
    try {
      const metadata = await revisionMetadata(req);
      return reply.send(await svc.updateProfile(id, input, { ...metadata, keepSecrets: isRestrictedToken(req) }));
    } catch (err) {
      return replyProfileEditError(err, reply);
    }
  });

  app.delete('/api/profiles/:id', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    try {
      await svc.deleteProfile(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  // ───── Bindings ─────

  app.post('/api/bindings', auth, async (req, reply) => {
    const input = CreateBindingSchema.parse(req.body);
    try {
      const b = await svc.createBinding(input);
      return reply.code(201).send(b);
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError || err instanceof svc.NodeNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      // Who holds the port, in the same three codes and the same union the
      // port check answers with, so one screen draws both. The English
      // message stays as the fallback; the words belong to the panel, which
      // has them in the operator's language and in the right case.
      if (
        err instanceof svc.PortInUseError ||
        err instanceof svc.PortHeldByCascadeError ||
        err instanceof svc.PortHeldByCoreServiceError
      ) {
        return reply
          .code(409)
          .send({ error: err.code, message: err.message, conflicts: err.conflicts });
      }
      // A-055: the same body as the host route.
      if (err instanceof MieruMtuMismatchError) {
        return reply.code(409).send({ error: err.code, message: err.message, nodeName: err.nodeName, mtu: err.mtu, wanted: err.wanted, heldBy: err.heldBy });
      }
      if (err instanceof AdapterSlotTakenError) {
        return reply.code(409).send({
          error: err.code,
          message: err.message,
          nodeName: err.nodeName,
        protocol: err.protocol,
          engine: err.engine,
          heldBy: err.heldBy,
        });
      }
      // The node's core for this profile is not installed, runs a version this
      // panel refuses, or its AmneziaWG module cannot speak the profile's
      // generation: CORE_NOT_ON_NODE / CORE_VERSION_REFUSED /
      // AWG_PROTOCOL_MISMATCH.
      const core = coreGateReply(err);
      if (core) return reply.code(core.status).send(core.body);
      if (err instanceof svc.ProfileEngineNotForTransportError) {
        return reply.code(400).send({ error: err.code, message: err.message, path: err.path });
      }
      // No core on this node renders this profile, so the inbound would never
      // come up: the agent answers such a push 200 with `skipped`, and the
      // subscription would keep handing out an endpoint nobody listens on.
      if (err instanceof svc.ProfileDoesNotRunOnNodeError) {
        return reply.code(409).send({
          error: 'PROFILE_DOES_NOT_RUN_ON_NODE',
          message: err.message,
          // The same answer in machine form, so the sentence can one day be
          // rebuilt in the operator's language without changing this contract.
          // See ProfileDoesNotRunOnNodeError for what each one means.
          nodeName: err.nodeName,
          neededEngine: err.neededEngine,
          reportedEngines: err.reportedEngines,
          canWait: err.canWait,
        });
      }
      throw err;
    }
  });

  app.get('/api/bindings', auth, async (req, reply) => {
    const q = ListBindingsQuerySchema.parse(req.query);
    return reply.send({ bindings: await svc.listBindings(q) });
  });

  // F-P1-b: suggest a free listen port for a NEW binding on a node, so the
  // deploy modal stops defaulting to 443 (which 409s the moment a node already
  // runs a protocol there). Static path wins over `:id` in find-my-way.
  app.get('/api/bindings/next-free-port', auth, async (req, reply) => {
    const { nodeId } = z
      .object({ nodeId: z.string().uuid() })
      .parse(req.query);
    return reply.send({ port: await svc.nextFreePortForNode(nodeId) });
  });

  app.get('/api/bindings/:id', auth, async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    try {
      return reply.send(await svc.getBindingById(id));
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });

  app.put('/api/bindings/:id', auth, async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    const input = UpdateBindingSchema.parse(await withStoredSecrets(req, 'overrides', async () =>
      (await prisma.profileNodeBinding.findUnique({ where: { id }, select: { overrides: true } }))?.overrides));
    try {
      return reply.send(await svc.updateBinding(id, input));
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (
        err instanceof svc.PortInUseError ||
        err instanceof svc.PortHeldByCascadeError ||
        err instanceof svc.PortHeldByCoreServiceError
      ) {
        return reply
          .code(409)
          .send({ error: err.code, message: err.message, conflicts: err.conflicts });
      }
      if (err instanceof svc.ProfileEngineNotForTransportError) {
        return reply.code(400).send({ error: err.code, message: err.message, path: err.path });
      }
      // A-199: an MTU in the overrides that the node's mieru does not run.
      if (err instanceof MieruMtuMismatchError) {
        return reply.code(409).send({ error: err.code, message: err.message, nodeName: err.nodeName, mtu: err.mtu, wanted: err.wanted, heldBy: err.heldBy });
      }
      throw err;
    }
  });

  app.delete('/api/bindings/:id', auth, async (req, reply) => {
    const { id } = BindingIdParamSchema.parse(req.params);
    try {
      await svc.deleteBinding(id);
      return reply.code(204).send();
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      throw err;
    }
  });
}
