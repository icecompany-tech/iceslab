import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildApp } from '../../app.js';
import { prisma } from '../../prisma.js';
import { closeRedis } from '../../lib/infra/redis.js';
import { cleanDatabase } from '../../../tests/helpers/db.js';
import { registerAndLogin } from '../../../tests/helpers/auth.js';
import { ALL_SQUAD_ID } from '../squads/squads.constants.js';

/**
 * A database without the system "All" squad (dev, 2026-09-23: a seed that
 * never had it). Every profile save answered 500 on a foreign key. The panel
 * repairs the row itself, and only the row.
 */
let app: FastifyInstance;
let token: string;

beforeEach(async () => {
  app = await buildApp();
  await cleanDatabase();
  token = await registerAndLogin(app);
  await prisma.group.deleteMany({ where: { id: ALL_SQUAD_ID } });
});

afterEach(async () => {
  await app.close();
});

afterAll(async () => {
  await prisma.$disconnect();
  await closeRedis();
});

const create = (name: string) =>
  app.inject({
    method: 'POST',
    url: '/api/profiles',
    headers: { authorization: `Bearer ${token}` },
    payload: { name, protocol: 'hysteria', config: {} },
  });

describe('a profile saved on a database that lost the All squad', () => {
  it('is saved, and the All squad is back with the profile in it', async () => {
    const res = await create('hy-1');
    expect(res.statusCode, res.body).toBe(201);
    const all = await prisma.group.findUnique({
      where: { id: ALL_SQUAD_ID },
      include: { groupProfiles: true, members: true },
    });
    expect(all?.name).toBe('All');
    expect(all?.groupProfiles.map((g) => g.profileId)).toEqual([JSON.parse(res.body).id]);
    // The row, not its membership: nobody was moved into "All" by a profile save.
    expect(all?.members).toEqual([]);
  });

  it('saves a user with no squad picked, and puts them in the All squad it brings back', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: 'no-squad-user' },
    });
    expect(res.statusCode, res.body).toBe(201);
    const all = await prisma.group.findUnique({ where: { id: ALL_SQUAD_ID }, include: { members: true } });
    expect(all?.name).toBe('All');
    expect(all?.members.map((m) => m.userId)).toEqual([JSON.parse(res.body).id]);
  });

  it('moves a user back to the All squad it brings back when their squads are cleared', async () => {
    // Created into an explicit squad, which needs no repair; then the edit
    // with no squads falls back to "All", on a database that lost it.
    const squad = await prisma.group.create({ data: { name: 'explicit' } });
    const created = await app.inject({
      method: 'POST',
      url: '/api/users',
      headers: { authorization: `Bearer ${token}` },
      payload: { username: 'squad-user', groupIds: [squad.id] },
    });
    expect(created.statusCode, created.body).toBe(201);
    const id = JSON.parse(created.body).id as string;
    expect(await prisma.group.findUnique({ where: { id: ALL_SQUAD_ID } })).toBeNull();

    const res = await app.inject({
      method: 'PUT',
      url: `/api/users/${id}`,
      headers: { authorization: `Bearer ${token}` },
      payload: { groupIds: [] },
    });
    expect(res.statusCode, res.body).toBe(200);
    const members = await prisma.groupMember.findMany({ where: { userId: id } });
    expect(members.map((m) => m.groupId)).toEqual([ALL_SQUAD_ID]);
  });

  it('names the system row apart when a squad called All already exists', async () => {
    await prisma.group.create({ data: { name: 'All' } });
    const res = await create('hy-2');
    expect(res.statusCode, res.body).toBe(201);
    const system = await prisma.group.findUnique({ where: { id: ALL_SQUAD_ID } });
    expect(system?.name).toBe('All (system)');
  });
});
