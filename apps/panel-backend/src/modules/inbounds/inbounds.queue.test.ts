import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { fetchActiveUsers } from './inbounds.queue.js';
import { createUser, deleteUser, updateUser } from '../users/users.service.js';
import { CreateUserSchema } from '../users/users.schemas.js';

/**
 * Whoever this returns is pushed onto the node and can connect. Deletion is
 * soft, so "who exists" has to be asked with the deletion filter every single
 * time; the moment one caller forgets, a removed person is handed back to the
 * fleet on the next inbound change and keeps connecting with the credentials
 * their client already has.
 *
 * That is exactly what happened in the field on 2026-08-10: adding a second
 * inbound on a node re-seeded 19 users onto it while the panel held one.
 */

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const names = async () => (await fetchActiveUsers()).map((u) => u.username).sort();

// Through the schema, so the test creates users the same way the route does
// (defaults included) rather than a hand-built object the service never sees.
const make = (input: Record<string, unknown>) => createUser(CreateUserSchema.parse(input));

describe('users a node is told to serve', () => {
  it('includes an ordinary active user', async () => {
    await make({ username: 'stays' });
    expect(await names()).toEqual(['stays']);
  });

  it('drops a deleted user', async () => {
    await make({ username: 'stays' });
    const gone = await make({ username: 'deleted' });

    await deleteUser(gone.id);

    expect(await names()).toEqual(['stays']);
  });

  it('drops a disabled user', async () => {
    const u = await make({ username: 'disabled_one' });
    await updateUser(u.id, { status: 'disabled' });
    expect(await names()).toEqual([]);
  });

  it('drops a user whose subscription has expired', async () => {
    await make({
      username: 'expired_one',
      expireAt: new Date(Date.now() - 60_000).toISOString(),
    });
    expect(await names()).toEqual([]);
  });

  it('keeps a user whose expiry is still ahead', async () => {
    await make({
      username: 'future_one',
      expireAt: new Date(Date.now() + 86_400_000).toISOString(),
    });
    expect(await names()).toEqual(['future_one']);
  });
});
