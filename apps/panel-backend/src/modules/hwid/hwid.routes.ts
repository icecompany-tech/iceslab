import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import * as svc from './hwid.service.js';

const UserIdParam = z.object({ userId: z.uuid() });
const DeviceIdParam = z.object({ id: z.uuid() });

/**
 * Admin routes for inspecting and revoking HWID-tracked devices. The
 * subscription endpoint creates rows lazily; these routes are how admins
 * intervene when a user complains "I lost my phone, please reset".
 */
export async function hwidRoutes(app: FastifyInstance): Promise<void> {
  // Wave-14 #15: per-route auth (see users.routes.ts header comment).
  const auth = { onRequest: [requireAuth] };

  app.get('/api/users/:userId/hwid-devices', auth, async (req, reply) => {
    const { userId } = UserIdParam.parse(req.params);
    const devices = await svc.listUserDevices(userId);
    return reply.send({
      devices: devices.map((d) => ({
        id: d.id,
        userId: d.userId,
        hwid: d.hwid,
        label: d.label,
        firstSeenAt: d.firstSeenAt.toISOString(),
        lastSeenAt: d.lastSeenAt.toISOString(),
      })),
    });
  });

  app.delete('/api/hwid-devices/:id', auth, async (req, reply) => {
    const { id } = DeviceIdParam.parse(req.params);
    await svc.deleteDevice(id);
    return reply.code(204).send();
  });
}
