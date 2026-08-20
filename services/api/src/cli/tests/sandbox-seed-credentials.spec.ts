import { memoryAdapter } from 'better-auth/adapters/memory';
import { describe, expect, it } from 'bun:test';

import { createAuth } from '../../lib/betterauth/betterauth';
import { CREDENTIAL_PROVIDER_ID, hashCredentialPassword, verifyCredentialPassword } from '../../lib/betterauth/credential-password';
import { SANDBOX_SEED_PASSWORD } from '../sandbox-personas';

describe('sandbox seed credentials', () => {
  it('uses a password that is unmistakably test-only', () => {
    expect(SANDBOX_SEED_PASSWORD).toBe('sandbox-sandbox');
    expect(CREDENTIAL_PROVIDER_ID).toBe('credential');
  });

  it('hashes so that better-auth\'s own verifier accepts the shared password and rejects others', async () => {
    const hash = await hashCredentialPassword(SANDBOX_SEED_PASSWORD);
    expect(hash).not.toContain(SANDBOX_SEED_PASSWORD);
    expect(await verifyCredentialPassword(hash, SANDBOX_SEED_PASSWORD)).toBe(true);
    expect(await verifyCredentialPassword(hash, 'sandbox-sandbox ')).toBe(false);
    expect(await verifyCredentialPassword(hash, 'not-the-password')).toBe(false);
  });

  it('verifies through the password verifier of a real createAuth context', async () => {
    // Guards against `emailAndPassword.password` ever gaining a custom hasher
    // in betterauth.ts without this helper following it.
    const auth = createAuth({
      authDb: {
        createDrizzleAdapter: () => memoryAdapter({}),
        ensurePersonalNetwork: async () => 'unused',
        ensureNegotiatorAgent: async () => null,
      },
      getTrustedOrigins: () => [],
      sendMagicLinkEmail: async () => {},
    });
    const context = await auth.$context;
    const hash = await hashCredentialPassword(SANDBOX_SEED_PASSWORD);
    expect(await context.password.verify({ hash, password: SANDBOX_SEED_PASSWORD })).toBe(true);
    expect(await context.password.verify({ hash, password: 'wrong' })).toBe(false);
  });
});
