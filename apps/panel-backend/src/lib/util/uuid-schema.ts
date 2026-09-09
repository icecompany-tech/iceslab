import { z } from 'zod';

/**
 * Permissive UUID validator: accepts any 8-4-4-4-12 hex shape, regardless
 * of version digit.
 *
 * Zod 4's built-in `z.uuid()` rejects UUIDs whose version digit (the first
 * char of the third group) isn't 1-8. That's stricter than RFC 9562 strictly
 * requires, and breaks our seeded "All" squad which uses
 * `00000000-0000-0000-0000-000000000001`, a hand-rolled, easy-to-spot,
 * sort-first id. Real generated rows use `gen_random_uuid()` which is v4
 * and would pass strict validation; the All squad is the one exception.
 *
 * Use this everywhere a request payload could carry the All squad id:
 * `groupIds` arrays on users/squads, `groupId` filters on user list,
 * squad path params, etc. For Prisma-generated ids (nodes, profiles,
 * bindings, inbounds) `z.uuid()` is fine.
 */
export const PermissiveUuid = z
  .string()
  .regex(
    /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
    'Invalid UUID',
  );
