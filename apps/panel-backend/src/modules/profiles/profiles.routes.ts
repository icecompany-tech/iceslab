import type { FastifyInstance } from 'fastify';
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
import { getProfileKeyImpact } from './profiles.key-impact.js';
import * as svc from './profiles.service.js';

const KeypairQuery = z.object({
  protocol: z.enum(['xray', 'amneziawg']).default('amneziawg'),
});

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
      const p = await svc.createProfile(input);
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

  app.put('/api/profiles/:id', auth, async (req, reply) => {
    const { id } = ProfileIdParamSchema.parse(req.params);
    const input = UpdateProfileSchema.parse(req.body);
    try {
      return reply.send(await svc.updateProfile(id, input));
    } catch (err) {
      if (err instanceof svc.ProfileNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof svc.ProfileNameTakenError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
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
      throw err;
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
      if (
        err instanceof svc.PortInUseError ||
        err instanceof svc.NodeAlreadyBoundError
      ) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
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
    const input = UpdateBindingSchema.parse(req.body);
    try {
      return reply.send(await svc.updateBinding(id, input));
    } catch (err) {
      if (err instanceof svc.BindingNotFoundError) {
        return reply.code(404).send({ error: 'NOT_FOUND', message: err.message });
      }
      if (err instanceof svc.PortInUseError) {
        return reply.code(409).send({ error: 'CONFLICT', message: err.message });
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
