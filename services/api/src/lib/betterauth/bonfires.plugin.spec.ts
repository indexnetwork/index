import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { betterAuth } from 'better-auth';
import { memoryAdapter, type MemoryDB } from 'better-auth/adapters/memory';
import { exportJWK, generateKeyPair, SignJWT } from 'jose';

import { API_URL, createAuth } from './betterauth';

type Key = Awaited<ReturnType<typeof generateKeyPair>>['privateKey'];

let server: ReturnType<typeof Bun.serve>;
let issuer: string;
let signingKey: Key;
let otherKey: Key;

beforeAll(async () => {
  const pair = await generateKeyPair('ES256');
  signingKey = pair.privateKey;
  otherKey = (await generateKeyPair('ES256')).privateKey;
  const jwk = { ...(await exportJWK(pair.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  server = Bun.serve({ port: 0, fetch: () => Response.json({ keys: [jwk] }) });
  issuer = `http://localhost:${server.port}`;
});

afterAll(() => server.stop(true));

function setup() {
  process.env.BONFIRES_ISSUER = issuer;
  const db: MemoryDB = { user: [], session: [], account: [], verification: [] };
  const joined: string[] = [];
  try {
    const configured = createAuth({
      authDb: { createDrizzleAdapter: () => memoryAdapter(db) },
      getTrustedOrigins: () => ['http://localhost:3000'],
      sendMagicLinkEmail: async () => {},
      sendVerificationEmail: async () => {},
      onBonfiresSignIn: async (userId) => { joined.push(userId); },
    });
    const auth = betterAuth({ ...configured.options, secret: 'bonfires-test-secret-at-least-32-characters' });
    return { auth, db, joined };
  } finally {
    delete process.env.BONFIRES_ISSUER;
  }
}

function sign(claims: Record<string, unknown> = {}, opts: { key?: Key; iat?: number; aud?: string; iss?: string } = {}) {
  const email = (claims.email as string | undefined) ?? 'ada@example.com';
  const iat = opts.iat ?? Math.floor(Date.now() / 1000);
  return new SignJWT({ email, email_verified: true, name: 'Ada', ...claims })
    .setProtectedHeader({ alg: 'ES256', kid: 'k1' })
    .setIssuer(opts.iss ?? issuer)
    .setAudience(opts.aud ?? API_URL)
    .setSubject((claims.sub as string | undefined) ?? email)
    .setIssuedAt(iat)
    .setExpirationTime(iat + 60)
    .setJti(crypto.randomUUID())
    .sign(opts.key ?? signingKey);
}

describe('Login with Bonfires', () => {
  test('creates the account once, signs in, auto-joins, and refuses a replayed token', async () => {
    const { auth, db, joined } = setup();
    const token = await sign();

    const first = await auth.api.signInBonfires({ body: { token } });
    expect(first.created).toBe(true);
    expect(first.token).toBeTruthy();
    expect(first.user.email).toBe('ada@example.com');
    expect(db.user).toHaveLength(1);
    expect(db.account[0]).toMatchObject({ providerId: 'bonfires', accountId: 'ada@example.com' });
    expect(joined).toEqual([first.user.id]);

    await expect(auth.api.signInBonfires({ body: { token } })).rejects.toThrow('already used');

    const again = await auth.api.signInBonfires({ body: { token: await sign() } });
    expect(again.created).toBe(false);
    expect(again.user.id).toBe(first.user.id);
    expect(db.user).toHaveLength(1);
  });

  test('links to an existing Index account with the same email', async () => {
    const { auth, db } = setup();
    const now = new Date();
    db.user.push({ id: 'existing', email: 'ada@example.com', name: 'Ada L', emailVerified: true, createdAt: now, updatedAt: now });

    const res = await auth.api.signInBonfires({ body: { token: await sign({ email: 'ADA@example.com', sub: 'ada@example.com' }) } });
    expect(res.created).toBe(false);
    expect(res.user.id).toBe('existing');
    expect(db.user).toHaveLength(1);
  });

  test('accepts a token issued a few seconds ahead of our clock', async () => {
    const { auth } = setup();
    const res = await auth.api.signInBonfires({ body: { token: await sign({}, { iat: Math.floor(Date.now() / 1000) + 5 }) } });
    expect(res.created).toBe(true);
  });

  test.each([
    ['another key', () => sign({}, { key: otherKey })],
    ['another audience', () => sign({}, { aud: 'https://elsewhere.example' })],
    ['another issuer', () => sign({}, { iss: 'https://evil.example' })],
    ['an old token', () => sign({}, { iat: Math.floor(Date.now() / 1000) - 600 })],
    ['an unverified email', () => sign({ email_verified: false })],
    ['a sub that is not the email', () => sign({ sub: 'someone-else@example.com' })],
    ['an HS256 token', () =>
      new SignJWT({ email: 'ada@example.com', email_verified: true })
        .setProtectedHeader({ alg: 'HS256' })
        .setIssuer(issuer).setAudience(API_URL).setSubject('ada@example.com')
        .setIssuedAt().setExpirationTime('60s').setJti('x')
        .sign(new TextEncoder().encode('a-shared-secret-of-at-least-32-bytes!'))],
  ])('refuses %s', async (_, make) => {
    const { auth, db, joined } = setup();
    await expect(auth.api.signInBonfires({ body: { token: await make() } })).rejects.toThrow();
    expect(db.user).toHaveLength(0);
    expect(joined).toHaveLength(0);
  });
});
