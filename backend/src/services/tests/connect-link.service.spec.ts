/** Config */
import { config } from 'dotenv';
config({ path: '.env.test' });

import { describe, test, expect, beforeAll, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { connectLinks, opportunities, users } from '../../schemas/database.schema';
import { mintConnectLink, resolveConnectLink, buildConnectShortUrl } from '../connect-link.service';

const USER_ID = `cl-svc-user-${Date.now()}`;
const OPP_ID = `cl-svc-opp-${Date.now()}`;

describe('connect-link service', () => {
  beforeAll(async () => {
    await db.insert(users).values({
      id: USER_ID,
      email: `${USER_ID}@test`,
      name: 'CL Test User',
    });
    await db.insert(opportunities).values({
      id: OPP_ID,
      actors: [{ userId: USER_ID, networkId: 'n/a', role: 'seeker' }],
      detection: { source: 'test', timestamp: new Date().toISOString(), createdBy: USER_ID },
      interpretation: { category: 'test', reasoning: 'test', confidence: 0.9 },
      context: { networkId: 'n/a' },
      confidence: '0.9',
      status: 'pending',
    });
  });

  afterAll(async () => {
    await db.delete(connectLinks).where(eq(connectLinks.userId, USER_ID));
    await db.delete(opportunities).where(eq(opportunities.id, OPP_ID));
    await db.delete(users).where(eq(users.id, USER_ID));
  });

  test('mint produces a 10-char base62 code and persists greeting', async () => {
    const r = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'connect',
      greeting: 'Hi there.',
    });
    expect(r.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(r.greeting).toBe('Hi there.');
  });

  test('mint is idempotent per (opp, user, kind)', async () => {
    const a = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const b = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    expect(a.code).toBe(b.code);
  });

  test('different kinds produce different codes for same recipient', async () => {
    const c1 = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const c2 = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'outreach' });
    expect(c1.code).not.toBe(c2.code);
  });

  test('resolve returns the row for a valid code', async () => {
    const r = await mintConnectLink({ userId: USER_ID, opportunityId: OPP_ID, kind: 'connect' });
    const resolved = await resolveConnectLink(r.code);
    expect(resolved?.userId).toBe(USER_ID);
    expect(resolved?.kind).toBe('connect');
  });

  test('resolve returns null for unknown code', async () => {
    expect(await resolveConnectLink('NOPE000000')).toBeNull();
  });

  test('re-mint after expiry rotates the row in place (no unique-constraint deadlock)', async () => {
    // Mint a fresh link.
    const a = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'approve_introduction',
      greeting: 'first greeting',
    });

    // Expire it directly in the DB (simulating 30-day TTL elapsed).
    const past = new Date(Date.now() - 60 * 1000);
    await db
      .update(connectLinks)
      .set({ expiresAt: past })
      .where(eq(connectLinks.code, a.code));

    // Resolver must reject the expired code.
    expect(await resolveConnectLink(a.code)).toBeNull();

    // Re-minting must succeed (rotates code + expiresAt + greeting in place)
    // — without this, the unique index on (opp,user,kind) would deadlock the
    // insert and the retry loop would throw after 3 attempts.
    const b = await mintConnectLink({
      userId: USER_ID,
      opportunityId: OPP_ID,
      kind: 'approve_introduction',
      greeting: 'second greeting',
    });

    expect(b.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(b.code).not.toBe(a.code);
    expect(b.greeting).toBe('second greeting');

    // The fresh code resolves; the rotated-out code is gone.
    const resolved = await resolveConnectLink(b.code);
    expect(resolved?.userId).toBe(USER_ID);
    expect(resolved?.greeting).toBe('second greeting');
    expect(await resolveConnectLink(a.code)).toBeNull();
  });
});

describe('buildConnectShortUrl', () => {
  test('appends ?link_preview=false to the short URL', () => {
    expect(buildConnectShortUrl('https://protocol.example.com', 'AbCd123456')).toBe(
      'https://protocol.example.com/c/AbCd123456?link_preview=false',
    );
  });

  test('does not double-encode when apiBaseUrl has no trailing slash', () => {
    // Caller already strips trailing slashes in protocol-init.ts before invoking
    // this helper; verify the helper composes cleanly with the stripped form.
    expect(buildConnectShortUrl('https://protocol.example.com', 'xyz')).toMatch(
      /^https:\/\/protocol\.example\.com\/c\/xyz\?link_preview=false$/,
    );
  });
});
