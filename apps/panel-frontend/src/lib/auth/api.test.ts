import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/net/client';
import { logout } from '@/lib/auth/api';

afterEach(() => vi.restoreAllMocks());

describe('logout (A-038)', () => {
  it('POST /api/auth/logout без тела, с пределом ожидания', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: null });
    await logout();
    expect(post).toHaveBeenCalledWith('/api/auth/logout', undefined, { timeout: 3000 });
  });

  it('сбой сети и отказ сервера не бросаются: выход идёт дальше', async () => {
    vi.spyOn(api, 'post').mockRejectedValueOnce(new Error('Network Error'));
    await expect(logout()).resolves.toBeUndefined();
    vi.spyOn(api, 'post').mockRejectedValueOnce({ response: { status: 404 } });
    await expect(logout()).resolves.toBeUndefined();
  });
});
