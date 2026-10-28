import { afterEach, expect, it, vi } from 'vitest';

vi.mock('./transport.helper', () => ({ executeSendEmail: vi.fn() }));
vi.mock('../log', () => ({ log: { lib: { from: () => ({ info: vi.fn() }) } } }));
import { executeSendEmail } from './transport.helper';
import { sendMagicLinkEmail } from './magic-link.handler';

afterEach(() => { vi.resetAllMocks(); vi.unstubAllEnvs(); });

it('emails a confirmation page with the token in the fragment, not a redeemable endpoint', async () => {
  vi.stubEnv('WEB_APP_URL', 'https://index.network');
  vi.mocked(executeSendEmail).mockResolvedValue({ data: { id: 'mail' }, error: null });
  await sendMagicLinkEmail('person@example.com', 'https://protocol.index.network/api/auth/magic-link/verify?token=secret&callbackURL=https%3A%2F%2Findex.network%2Fseref');
  const email = vi.mocked(executeSendEmail).mock.calls[0][0];
  const link = new URL(email.text.split('\n\n')[1]);
  expect(link.origin + link.pathname).toBe('https://index.network/login/verify');
  expect(link.search).toBe('');
  const params = new URLSearchParams(link.hash.slice(1));
  expect(params.get('token')).toBe('secret');
  expect(params.get('callbackURL')).toBe('https://index.network/seref');
  expect(email.html).not.toContain('/api/auth/magic-link/verify');
});

it('does not report success when sending was skipped', async () => {
  vi.mocked(executeSendEmail).mockResolvedValue({ data: null, skipped: true, reason: 'resend_not_configured' });
  await expect(sendMagicLinkEmail('person@example.com', 'https://protocol.index.network/api/auth/magic-link/verify?token=secret')).rejects.toThrow('could not be sent');
});
