import { describe, it, expect, vi, beforeEach } from 'vitest';
import * as adminService from '../admin/admin.service.js';
import { login, InvalidCredentialsError } from './auth.service.js';

vi.mock('../admin/admin.service.js');
// Slice S7 — login now touches Redis for username-lockout. Stub the
// underlying client so unit tests don't need a live Redis. ioredis API
// surface we hit: get / incr / expire / del / ttl.
vi.mock('../../lib/redis.js', () => ({
  redis: {
    get: vi.fn().mockResolvedValue(null),
    incr: vi.fn().mockResolvedValue(1),
    expire: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
    ttl: vi.fn().mockResolvedValue(-1),
  },
}));

const fakeAdmin = {
  id: '11111111-1111-1111-1111-111111111111',
  username: 'admin',
  passwordHash: '$2b$12$fakeHash',
  role: 'admin',
  createdAt: new Date(),
  updatedAt: new Date(),
  deletedAt: null,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('login', () => {
  it('returns the admin record on valid credentials', async () => {
    vi.mocked(adminService.findAdminByUsername).mockResolvedValue(fakeAdmin);
    vi.mocked(adminService.verifyPassword).mockResolvedValue(true);

    const result = await login({ username: 'admin', password: 'correct' }, '1.2.3.4');
    expect(result).toBe(fakeAdmin);
    expect(adminService.findAdminByUsername).toHaveBeenCalledWith('admin');
    expect(adminService.verifyPassword).toHaveBeenCalledWith('correct', fakeAdmin.passwordHash);
  });

  it('throws InvalidCredentialsError when admin does not exist', async () => {
    vi.mocked(adminService.findAdminByUsername).mockResolvedValue(null);

    await expect(login({ username: 'ghost', password: 'whatever' }, '1.2.3.4')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
    expect(adminService.verifyPassword).not.toHaveBeenCalled();
  });

  it('throws InvalidCredentialsError when password is wrong', async () => {
    vi.mocked(adminService.findAdminByUsername).mockResolvedValue(fakeAdmin);
    vi.mocked(adminService.verifyPassword).mockResolvedValue(false);

    await expect(login({ username: 'admin', password: 'wrong' }, '1.2.3.4')).rejects.toBeInstanceOf(
      InvalidCredentialsError,
    );
  });
});
