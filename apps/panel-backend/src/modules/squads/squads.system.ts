import type { Prisma } from '../../generated/prisma/client.js';
import { ALL_SQUAD_ID, ALL_SQUAD_NAME } from './squads.constants.js';

/** The seed migration's wording, so a repaired row reads like a seeded one. */
const ALL_SQUAD_DESCRIPTION = 'Default group containing every inbound. Auto-membership for new users.';

/**
 * Make sure the system "All" squad exists, inside the caller's transaction.
 *
 * It is seeded by a migration, and everything that attaches to it (a new
 * profile, a new user) assumed the row was there. On a database seeded or
 * cleaned some other way it was not, and every profile save answered 500 on a
 * foreign key (dev, 2026-09-23: a 10 000-user seed with two squads and no
 * "All"). The panel can repair that itself, so it does.
 *
 * The ROW only, never its membership: backfilling who is in "All" decides who
 * sees what, and that is not a thing to do as a side effect of saving a profile.
 *
 * If a squad named "All" already exists under another id (the name is unique),
 * the system row takes a name that says what it is instead of failing.
 */
export async function ensureAllSquad(tx: Prisma.TransactionClient): Promise<void> {
  const present = await tx.group.findUnique({ where: { id: ALL_SQUAD_ID }, select: { id: true } });
  if (present) return;
  const nameTaken = await tx.group.findUnique({ where: { name: ALL_SQUAD_NAME }, select: { id: true } });
  await tx.group.create({
    data: {
      id: ALL_SQUAD_ID,
      name: nameTaken ? `${ALL_SQUAD_NAME} (system)` : ALL_SQUAD_NAME,
      description: ALL_SQUAD_DESCRIPTION,
    },
  });
}
