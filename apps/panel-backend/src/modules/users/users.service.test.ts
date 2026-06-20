import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as repo from './users.repository.js';
import { eventBus } from '../../lib/event-bus.js';
import {
  createUser,
  getUserById,
  updateUser,
  deleteUser,
  revokeSubscription,
  rotateSubscription,
  resetUserTraffic,
  UserAlreadyExistsError,
  UserNotFoundError,
} from './users.service.js';

vi.mock('./users.repository.js');
vi.mock('../../lib/event-bus.js', () => ({
  eventBus: { emit: vi.fn() },
}));
vi.mock('../../lib/credentials.js', () => ({
  generateUserCredentials: vi.fn(() => ({
    hysteriaPassword: 'hyst-pass',
    naivePassword: 'naive-pass',
    xrayUuid: '00000000-0000-0000-0000-000000000000',
    amneziawgPrivateKey: 'awgpriv',
    amneziawgPublicKey: 'awgpub',
    subscriptionToken: 'subtok',
    shortId: 'shortabc',
  })),
  generateSubscriptionToken: vi.fn(() => 'rotated-subtok'),
}));

const FAKE_ID = '22222222-2222-2222-2222-222222222222';

function makeFakeUser(overrides: Partial<repo.UserWithTraffic> = {}): repo.UserWithTraffic {
  return {
    id: FAKE_ID,
    shortId: 'shortabc',
    username: 'testuser',
    status: 'active',
    expireAt: null,
    trafficLimitBytes: null,
    trafficLimitStrategy: 'no_reset',
    subscriptionToken: 'subtok',
    subRevokedAt: null,
    hysteriaPassword: 'hyst-pass',
    naivePassword: 'naive-pass',
    xrayUuid: '00000000-0000-0000-0000-000000000000',
    amneziawgPrivateKey: 'awgpriv',
    amneziawgPublicKey: 'awgpub',
    hwidDeviceLimit: null,
    description: null,
    tag: null,
    telegramId: null,
    email: null,
    createdAt: new Date('2026-05-04T00:00:00Z'),
    updatedAt: new Date('2026-05-04T00:00:00Z'),
    deletedAt: null,
    traffic: null,
    ...overrides,
  } as repo.UserWithTraffic;
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('revokeSubscription', () => {
  it('stamps subRevokedAt and emits user.updated', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(makeFakeUser({ subRevokedAt: null }));
    vi.mocked(repo.updateById).mockResolvedValue(
      makeFakeUser({ subRevokedAt: new Date('2026-06-20T00:00:00Z') }),
    );

    const dto = await revokeSubscription(FAKE_ID);

    const arg = vi.mocked(repo.updateById).mock.calls[0]![1]!;
    expect(arg.subRevokedAt).toBeInstanceOf(Date);
    expect(dto.subRevokedAt).not.toBeNull();
    expect(eventBus.emit).toHaveBeenCalledWith('user.updated', {
      userId: FAKE_ID,
      changes: ['subRevokedAt'],
    });
  });

  it('throws UserNotFoundError for a missing user', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(null);
    await expect(revokeSubscription(FAKE_ID)).rejects.toBeInstanceOf(UserNotFoundError);
    expect(repo.updateById).not.toHaveBeenCalled();
  });
});

describe('rotateSubscription', () => {
  it('issues a fresh token and clears any prior revoke', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(
      makeFakeUser({ subscriptionToken: 'subtok', subRevokedAt: new Date() }),
    );
    vi.mocked(repo.updateById).mockResolvedValue(
      makeFakeUser({ subscriptionToken: 'rotated-subtok', subRevokedAt: null }),
    );

    const dto = await rotateSubscription(FAKE_ID);

    const arg = vi.mocked(repo.updateById).mock.calls[0]![1]!;
    expect(arg.subscriptionToken).toBe('rotated-subtok');
    expect(arg.subRevokedAt).toBeNull();
    expect(dto.subscriptionToken).toBe('rotated-subtok');
    expect(dto.subRevokedAt).toBeNull();
  });

  it('throws UserNotFoundError for a missing user', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(null);
    await expect(rotateSubscription(FAKE_ID)).rejects.toBeInstanceOf(UserNotFoundError);
    expect(repo.updateById).not.toHaveBeenCalled();
  });
});

describe('resetUserTraffic', () => {
  it('resets traffic and emits user.traffic-reset with the previous usage', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(
      makeFakeUser({
        traffic: { usedTrafficBytes: 123n } as unknown as repo.UserWithTraffic['traffic'],
      }),
    );
    vi.mocked(repo.resetTraffic).mockResolvedValue(undefined);

    await resetUserTraffic(FAKE_ID);

    expect(repo.resetTraffic).toHaveBeenCalledWith(FAKE_ID);
    expect(eventBus.emit).toHaveBeenCalledWith('user.traffic-reset', {
      userId: FAKE_ID,
      previousUsedBytes: 123n,
    });
  });

  it('throws UserNotFoundError for a missing user', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(null);
    await expect(resetUserTraffic(FAKE_ID)).rejects.toBeInstanceOf(UserNotFoundError);
    expect(repo.resetTraffic).not.toHaveBeenCalled();
  });
});

describe('createUser', () => {
  it('throws UserAlreadyExistsError when username is taken', async () => {
    vi.mocked(repo.findActiveByUsername).mockResolvedValue(makeFakeUser());

    await expect(
      createUser({
        username: 'testuser',
        groupIds: [],
        trafficLimitStrategy: 'no_reset',
      }),
    ).rejects.toBeInstanceOf(UserAlreadyExistsError);

    expect(repo.create).not.toHaveBeenCalled();
  });

  it('creates a user, persists creds, and emits user.created', async () => {
    vi.mocked(repo.findActiveByUsername).mockResolvedValue(null);
    vi.mocked(repo.create).mockResolvedValue(makeFakeUser());

    const dto = await createUser({
      username: 'testuser',
      groupIds: [],
      trafficLimitStrategy: 'no_reset',
    });

    expect(repo.create).toHaveBeenCalledOnce();
    const createArg = vi.mocked(repo.create).mock.calls[0]![0]!;
    expect(createArg.username).toBe('testuser');
    expect(createArg.hysteriaPassword).toBe('hyst-pass');
    expect(createArg.xrayUuid).toBe('00000000-0000-0000-0000-000000000000');

    expect(eventBus.emit).toHaveBeenCalledWith('user.created', {
      userId: FAKE_ID,
      username: 'testuser',
    });
    expect(dto.id).toBe(FAKE_ID);
    expect(dto.username).toBe('testuser');
  });

  it('converts trafficLimitGb to bytes and expireDays to a future Date', async () => {
    vi.mocked(repo.findActiveByUsername).mockResolvedValue(null);
    vi.mocked(repo.create).mockResolvedValue(makeFakeUser());

    const before = Date.now();
    await createUser({
      username: 'testuser',
      groupIds: [],
      trafficLimitStrategy: 'month',
      trafficLimitGb: 5,
      expireDays: 30,
    });
    const after = Date.now();

    const createArg = vi.mocked(repo.create).mock.calls[0]![0]!;
    expect(createArg.trafficLimitBytes).toBe(5n * 1_073_741_824n);
    expect(createArg.expireAt).toBeInstanceOf(Date);
    const expireMs = (createArg.expireAt as Date).getTime();
    const lower = before + 30 * 24 * 60 * 60 * 1000 - 1000;
    const upper = after  + 30 * 24 * 60 * 60 * 1000 + 1000;
    expect(expireMs).toBeGreaterThanOrEqual(lower);
    expect(expireMs).toBeLessThanOrEqual(upper);
  });
});

describe('getUserById', () => {
  it('returns a public DTO when user exists', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(makeFakeUser());
    const dto = await getUserById(FAKE_ID);
    expect(dto.id).toBe(FAKE_ID);
    expect(dto).not.toHaveProperty('hysteriaPassword');
    expect(dto).not.toHaveProperty('amneziawgPrivateKey');
  });

  it('throws UserNotFoundError when user is missing', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(null);
    await expect(getUserById(FAKE_ID)).rejects.toBeInstanceOf(UserNotFoundError);
  });
});

describe('updateUser', () => {
  it('throws UserNotFoundError when user is missing', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(null);
    await expect(updateUser(FAKE_ID, { tag: 'vip' })).rejects.toBeInstanceOf(UserNotFoundError);
    expect(repo.updateById).not.toHaveBeenCalled();
  });

  it('emits user.updated with changed field names', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(makeFakeUser());
    vi.mocked(repo.updateById).mockResolvedValue(makeFakeUser({ tag: 'vip' }));

    await updateUser(FAKE_ID, { tag: 'vip', description: 'new desc' });

    expect(eventBus.emit).toHaveBeenCalledWith('user.updated', {
      userId: FAKE_ID,
      changes: ['description', 'tag'],
    });
  });

  it('emits user.status-changed when status transitions', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(makeFakeUser({ status: 'active' }));
    vi.mocked(repo.updateById).mockResolvedValue(makeFakeUser({ status: 'disabled' }));

    await updateUser(FAKE_ID, { status: 'disabled' });

    expect(eventBus.emit).toHaveBeenCalledWith('user.status-changed', {
      userId: FAKE_ID,
      from: 'active',
      to: 'disabled',
    });
  });

  it('does not emit user.updated when nothing changed', async () => {
    vi.mocked(repo.findActiveById).mockResolvedValue(makeFakeUser());
    vi.mocked(repo.updateById).mockResolvedValue(makeFakeUser());

    await updateUser(FAKE_ID, {});

    expect(eventBus.emit).not.toHaveBeenCalledWith(
      'user.updated',
      expect.anything(),
    );
  });
});

describe('deleteUser', () => {
  it('throws UserNotFoundError when user does not exist', async () => {
    vi.mocked(repo.existsActive).mockResolvedValue(false);
    await expect(deleteUser(FAKE_ID)).rejects.toBeInstanceOf(UserNotFoundError);
    expect(repo.softDelete).not.toHaveBeenCalled();
  });

  it('soft-deletes and emits user.deleted', async () => {
    vi.mocked(repo.existsActive).mockResolvedValue(true);
    vi.mocked(repo.softDelete).mockResolvedValue(undefined);

    await deleteUser(FAKE_ID);

    expect(repo.softDelete).toHaveBeenCalledWith(FAKE_ID);
    expect(eventBus.emit).toHaveBeenCalledWith('user.deleted', { userId: FAKE_ID });
  });
});
