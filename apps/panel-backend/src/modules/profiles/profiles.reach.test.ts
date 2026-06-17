import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';
import { getProfileById, listProfiles } from './profiles.service.js';
import { createUser, deleteUser } from '../users/users.service.js';
import { CreateUserSchema } from '../users/users.schemas.js';

// Regression: a profile's "user reach" badge showed 4 when only 1 real user
// existed. Cause: deleteUser is a SOFT delete - it flips users.deletedAt but
// deliberately leaves the group_members row (for restore-ability, same as the
// squad member count). The reach query counted group_members without excluding
// soft-deleted users, so a profile on the "All" squad reported every ghost ever
// created. Both code paths (list aggregate + single-profile scoped count) must
// count only live users.
async function addUser(username: string): Promise<string> {
  const u = await createUser(CreateUserSchema.parse({ username }));
  return u.id;
}

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

describe('profile user reach (soft-delete aware)', () => {
  it('counts only live members of a squad, not soft-deleted ghosts', async () => {
    // A profile auto-attaches to "All"; a user with no squads picked auto-joins
    // "All". So reach == count of live users in this setup.
    const profile = await prisma.profile.create({
      data: { name: 'reach-p1', protocol: 'xray', config: {}, enabled: true },
    });
    await prisma.groupProfile.create({
      data: { groupId: ALL_SQUAD_ID, profileId: profile.id },
    });

    const ids: string[] = [];
    for (const name of ['alice', 'bob', 'carol', 'dave']) {
      ids.push(await addUser(name));
    }

    // 4 live users -> reach 4 on both the list aggregate and the scoped count.
    const listed = await listProfiles({});
    expect(listed.find((p) => p.id === profile.id)?.userCount).toBe(4);
    expect((await getProfileById(profile.id)).userCount).toBe(4);

    // Soft-delete 3 of them. Their group_members rows stay behind.
    await deleteUser(ids[1]!);
    await deleteUser(ids[2]!);
    await deleteUser(ids[3]!);

    // Reach must drop to the 1 live user, not keep reporting 4.
    const listedAfter = await listProfiles({});
    expect(listedAfter.find((p) => p.id === profile.id)?.userCount).toBe(1);
    expect((await getProfileById(profile.id)).userCount).toBe(1);

    // The ghost memberships are intentionally retained (restore-ability) - the
    // fix lives in the count query, not in deleting the join rows.
    expect(await prisma.groupMember.count()).toBe(4);
  });

  it('reports zero reach when every member is soft-deleted', async () => {
    const profile = await prisma.profile.create({
      data: { name: 'reach-p2', protocol: 'xray', config: {}, enabled: true },
    });
    await prisma.groupProfile.create({
      data: { groupId: ALL_SQUAD_ID, profileId: profile.id },
    });
    const id = await addUser('only-user');
    await deleteUser(id);

    const listed = await listProfiles({});
    expect(listed.find((p) => p.id === profile.id)?.userCount).toBe(0);
    expect((await getProfileById(profile.id)).userCount).toBe(0);
  });
});
