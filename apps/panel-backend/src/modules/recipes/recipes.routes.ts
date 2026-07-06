import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { getRecipeRegistry } from './recipes.registry.js';

/**
 * Transport-recipe registry endpoint. Serves the validated, version-gated
 * community recipe set the panel pulls from the public GitHub registry.
 * Best-effort and cached (6h): if the registry is unreachable the response
 * carries `stale: true` and the last good set (or an empty list), never an
 * error, so the RecipePicker degrades to built-in recipes only.
 */
const QuerySchema = z.object({
  protocol: z.string().max(32).optional(),
  region: z.string().max(16).optional(),
});

export async function recipesRoutes(app: FastifyInstance): Promise<void> {
  // Per-route auth (see users.routes.ts header comment). Admin-only.
  const auth = { onRequest: [requireAuth] };

  app.get('/api/recipes/registry', auth, async (req, reply) => {
    const q = QuerySchema.safeParse(req.query);
    const filters = q.success ? q.data : {};
    return reply.send(await getRecipeRegistry(filters));
  });
}
