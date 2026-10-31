import { afterEach, describe, expect, it, vi } from 'vitest';
import { api } from '@/lib/net/client';
import { getUser, reissueUserCredentials } from '@/lib/domain/users';

afterEach(() => vi.restoreAllMocks());

describe('перевыпуск ключей юзера (A-053)', () => {
  it('POST /api/users/:id/reissue-credentials без тела, ответ не читается', async () => {
    const post = vi.spyOn(api, 'post').mockResolvedValue({ data: { anything: true } });
    await expect(reissueUserCredentials('u1')).resolves.toBeUndefined();
    expect(post).toHaveBeenCalledWith('/api/users/u1/reissue-credentials');
  });

  it('отказ сервера бросается дальше, к строке под кнопкой', async () => {
    vi.spyOn(api, 'post').mockRejectedValue({ response: { status: 409, data: { error: 'X' } } });
    await expect(reissueUserCredentials('u1')).rejects.toBeTruthy();
  });
});

describe('getUser: перечитывание после перевыпуска', () => {
  it('этот юзер берётся, чужой или кривой ответ это null', async () => {
    const get = vi.spyOn(api, 'get');
    get.mockResolvedValueOnce({ data: { id: 'u1', username: 'a' } });
    expect(await getUser('u1')).toEqual({ id: 'u1', username: 'a' });
    for (const data of [{ id: 'u2' }, null, 'x', { user: { id: 'u1' } }]) {
      get.mockResolvedValueOnce({ data });
      expect(await getUser('u1')).toBeNull();
    }
  });
});
