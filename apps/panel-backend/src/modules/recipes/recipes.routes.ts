import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { requireAuth } from '../auth/auth.hook.js';
import { getRecipeRegistry } from './recipes.registry.js';
import { addSource, deleteSource, getSources, updateSource } from './recipes.sources.js';
import { importRecipes } from './recipes.import.js';
import {
  ImportRequestSchema,
  SourceInputSchema,
  SourceUpdateSchema,
} from './recipes.schemas.js';
import { assertFetchableUrl } from './recipes.ssrf.js';

/**
 * Transport-recipe endpoints. Recipes are pulled from operator-managed
 * sources (bring your own GitHub) plus the curated default, merged, validated
 * and version-gated. Best-effort and cached: an unreachable source flags the
 * response `stale` and the RecipePicker degrades to whatever loaded plus
 * built-ins, never an error.
 *
 *   GET    /api/recipes/registry    merged recipes (filters: protocol, region)
 *   GET    /api/recipes/sources     list configured sources
 *   POST   /api/recipes/sources     add a source
 *   PATCH  /api/recipes/sources/:id enable / rename / repoint a source
 *   DELETE /api/recipes/sources/:id remove a source
 *   POST   /api/recipes/import      validate ad-hoc recipes (url or pasted json)
 */
const QuerySchema = z.object({
  protocol: z.string().max(32).optional(),
  region: z.string().max(16).optional(),
});
const IdParam = z.object({ id: z.string().min(1).max(64) });

function badUrl(reply: import('fastify').FastifyReply, err: unknown) {
  return reply
    .code(400)
    .send({ error: 'BAD_SOURCE', message: (err as Error).message });
}

export async function recipesRoutes(app: FastifyInstance): Promise<void> {
  // Per-route auth (see users.routes.ts header comment). Admin-only.
  const auth = { onRequest: [requireAuth] };

  app.get('/api/recipes/registry', auth, async (req, reply) => {
    const q = QuerySchema.safeParse(req.query);
    return reply.send(await getRecipeRegistry(q.success ? q.data : {}));
  });

  app.get('/api/recipes/sources', auth, async (_req, reply) => {
    return reply.send({ sources: await getSources() });
  });

  app.post('/api/recipes/sources', auth, async (req, reply) => {
    const input = SourceInputSchema.parse(req.body);
    // Guard here so a bad URL is a clean 400; DB failures inside addSource
    // still propagate to the global 500 handler.
    try {
      assertFetchableUrl(input.url);
    } catch (err) {
      return badUrl(reply, err);
    }
    const created = await addSource(input);
    return reply.code(201).send(created);
  });

  app.patch('/api/recipes/sources/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const patch = SourceUpdateSchema.parse(req.body);
    if (patch.url !== undefined) {
      try {
        assertFetchableUrl(patch.url);
      } catch (err) {
        return badUrl(reply, err);
      }
    }
    const updated = await updateSource(id, patch);
    if (!updated) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.send(updated);
  });

  app.delete('/api/recipes/sources/:id', auth, async (req, reply) => {
    const { id } = IdParam.parse(req.params);
    const ok = await deleteSource(id);
    if (!ok) return reply.code(404).send({ error: 'NOT_FOUND' });
    return reply.code(204).send();
  });

  app.post('/api/recipes/import', auth, async (req, reply) => {
    const body = ImportRequestSchema.parse(req.body);
    try {
      const recipes = await importRecipes(body);
      return reply.send({ recipes });
    } catch (err) {
      return reply
        .code(400)
        .send({ error: 'IMPORT_FAILED', message: (err as Error).message });
    }
  });
}
