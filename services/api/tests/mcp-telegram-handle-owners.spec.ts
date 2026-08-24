/**
 * Integration coverage for ProfileDatabaseAdapter.findTelegramHandleOwners
 * (via the ChatDatabaseAdapter facade). This exercises the real SQL
 * normalization that the pure-unit mcp-surface tests cannot reach: a stored
 * telegram value in any of its representations (`@h`, `https://t.me/h`,
 * trailing slash, `?start=` query params) must resolve to the bare handle so
 * cross-user handle ownership is detected. Requires a live DATABASE_URL.
 */
import '../src/startup.env';

import { afterAll, describe, expect, it } from 'bun:test';
import { randomUUID } from 'node:crypto';
import { inArray } from 'drizzle-orm';

import db from '../src/lib/drizzle/drizzle';
import { users, userSocials } from '../src/schemas/database.schema';
import { chatDatabaseAdapter } from '../src/adapters/database.adapter';

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdUserIds.length === 0) return;
  await db.delete(userSocials).where(inArray(userSocials.userId, createdUserIds));
  await db.delete(users).where(inArray(users.id, createdUserIds));
});

async function createUserWithTelegram(value: string): Promise<string> {
  const email = `tg-owner-${randomUUID().slice(0, 8)}@test.invalid`;
  const [u] = await db
    .insert(users)
    .values({ email, name: 'TG Owner Test', emailVerified: true })
    .returning({ id: users.id });
  createdUserIds.push(u.id);
  await db.insert(userSocials).values({ userId: u.id, label: 'telegram', value });
  return u.id;
}

function uniqueHandle(): string {
  return `tgtest_${randomUUID().replace(/-/g, '').slice(0, 10)}`;
}

describe('findTelegramHandleOwners (integration)', () => {
  it('resolves every stored telegram representation to the bare handle', async () => {
    const handle = uniqueHandle();
    const [bare, at, url, slash, query, telegramMe, upper] = await Promise.all([
      createUserWithTelegram(handle),
      createUserWithTelegram(`@${handle}`),
      createUserWithTelegram(`https://t.me/${handle}`),
      createUserWithTelegram(`https://t.me/${handle}/`),
      createUserWithTelegram(`https://t.me/${handle}?start=abc`),
      createUserWithTelegram(`http://telegram.me/${handle}`),
      createUserWithTelegram(`HTTPS://T.ME/${handle}`),
    ]);
    const ids = { bare, at, url, slash, query, telegramMe, upper };

    const owners = await chatDatabaseAdapter.findTelegramHandleOwners(handle);
    const ownerIds = new Set(owners.map((o) => o.userId));

    for (const [variant, id] of Object.entries(ids)) {
      expect(`${variant}:${ownerIds.has(id)}`).toBe(`${variant}:true`);
    }
  }, 30000);

  it('does not match a different handle that merely shares a prefix', async () => {
    const handle = uniqueHandle();
    const otherId = await createUserWithTelegram(`https://t.me/${handle}_other?start=x`);

    const owners = await chatDatabaseAdapter.findTelegramHandleOwners(handle);

    expect(owners.some((o) => o.userId === otherId)).toBe(false);
  }, 30000);
});
