import { describe, expect, it, vi } from 'vitest';
import { saveThen } from '@/contours/profiles/lib/saveThen';

// The two refusals seen on dev 23.09: a 400 on the engine, a 500 on any create.
const refusal = (status: number) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status } });

describe('saveThen', () => {
  it.each([400, 500])('a refused save (%i) resolves false, and nothing after it runs', async (status) => {
    const after = vi.fn();
    await expect(saveThen(() => Promise.reject(refusal(status)), after)).resolves.toBe(false);
    expect(after).not.toHaveBeenCalled();
  });

  it('a save that went through runs what follows, once', async () => {
    const after = vi.fn();
    await expect(saveThen(() => Promise.resolve(), after)).resolves.toBe(true);
    expect(after).toHaveBeenCalledTimes(1);
  });

  it('what follows is not run before the save settles', async () => {
    const order: string[] = [];
    await saveThen(
      async () => {
        await Promise.resolve();
        order.push('save');
      },
      () => order.push('after'),
    );
    expect(order).toEqual(['save', 'after']);
  });
});
