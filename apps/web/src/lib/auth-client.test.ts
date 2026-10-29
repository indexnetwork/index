import { beforeEach, expect, it, vi } from 'vitest';
const { tokenRequest } = vi.hoisted(() => ({ tokenRequest: vi.fn() }));
vi.mock('better-auth/react', () => ({ createAuthClient: () => ({ token: tokenRequest }) }));
vi.mock('./protocol-origin', () => ({ protocolOrigin: () => '' }));
import { AuthSessionError, clearJwtToken, getJwtToken } from './auth-client';
const token = (name: string) => `${name}.${btoa(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600 }))}.signature`;
beforeEach(() => { clearJwtToken(); tokenRequest.mockReset(); });
it('shares and caches one refresh across eight concurrent calls', async () => {
  const jwt = token('current');
  tokenRequest.mockResolvedValue({ data: { token: jwt } });
  expect(await Promise.all(Array.from({ length: 8 }, () => getJwtToken()))).toEqual(Array(8).fill(jwt));
  expect(await getJwtToken()).toBe(jwt);
  expect(tokenRequest).toHaveBeenCalledTimes(1);
});
it('allows retry after a failed refresh', async () => {
  tokenRequest.mockResolvedValueOnce({ error: new Error('offline') });
  await expect(getJwtToken()).rejects.toBeInstanceOf(AuthSessionError);
  const jwt = token('retry');
  tokenRequest.mockResolvedValueOnce({ data: { token: jwt } });
  expect(await getJwtToken()).toBe(jwt);
});
it('rejects an old session response without clearing the new token', async () => {
  let resolve!: (value: { data: { token: string } }) => void;
  tokenRequest.mockReturnValueOnce(new Promise((r) => { resolve = r; }));
  const rejected = expect(getJwtToken()).rejects.toBeInstanceOf(AuthSessionError);
  clearJwtToken();
  const current = token('new');
  tokenRequest.mockResolvedValueOnce({ data: { token: current } });
  expect(await getJwtToken()).toBe(current);
  resolve({ data: { token: token('old') } });
  await rejected;
  expect(await getJwtToken()).toBe(current);
  expect(tokenRequest).toHaveBeenCalledTimes(2);
});
