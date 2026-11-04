import { describe, expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';

import { createAuth } from './betterauth';

async function setup() {
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const mail: { email: string; url: string }[] = [];
  const configured = createAuth({
    authDb: { createDrizzleAdapter: () => memoryAdapter(db) },
    getTrustedOrigins: () => ['http://localhost:3000'],
    sendMagicLinkEmail: async () => {},
    sendVerificationEmail: async (email, url) => { mail.push({ email, url }); },
  });
  const auth = betterAuth({ ...configured.options, secret: 'email-change-test-secret-at-least-32-characters', emailAndPassword: { enabled: true } });
  const signed = await auth.api.signUpEmail({ body: { email: 'old@example.com', name: 'Test', password: 'test-password-12345' } });
  const headers = new Headers({ Authorization: `Bearer ${signed.token}` });
  return { auth, db, mail, headers, id: signed.user.id };
}

describe('account email change', () => {
  test.each([true, false])('requires verification and preserves identity (previously verified: %s)', async (verified) => {
    const { auth, db, mail, headers, id } = await setup();
    db.user[0].emailVerified = verified;
    await auth.api.changeEmail({ headers, body: { newEmail: 'new@example.com', callbackURL: 'http://localhost:3000/settings?tab=access&emailChange=1' } });
    expect(db.user[0].email).toBe('old@example.com');
    expect(mail).toHaveLength(1);
    expect(mail[0].email).toBe('new@example.com');
    const token = new URL(mail[0].url).searchParams.get('token')!;
    await auth.api.verifyEmail({ headers, query: { token } });
    expect(db.user[0].email).toBe('new@example.com');
    expect(db.user[0].id).toBe(id);
    expect(db.user[0].emailVerified).toBe(true);
    await expect(auth.api.verifyEmail({ headers, query: { token } })).rejects.toThrow();
  });

  test('rejects unauthenticated changes and invalid tokens', async () => {
    const { auth, db } = await setup();
    await expect(auth.api.changeEmail({ body: { newEmail: 'new@example.com' } })).rejects.toThrow();
    await expect(auth.api.verifyEmail({ query: { token: 'invalid' } })).rejects.toThrow();
    expect(db.user[0].email).toBe('old@example.com');
  });

  test('does not change to an address already in use or disclose it', async () => {
    const { auth, db, headers, mail } = await setup();
    await auth.api.signUpEmail({ body: { email: 'taken@example.com', name: 'Other', password: 'test-password-12345' } });
    await auth.api.changeEmail({ headers, body: { newEmail: 'taken@example.com' } });
    expect(mail).toHaveLength(0);
    expect(db.user[0].email).toBe('old@example.com');
  });
});
