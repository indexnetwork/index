/**
 * Tests for ContactService — contacts backed by index_members with 'contact' permission.
 *
 * Requires DATABASE_URL and migrated schema.
 * Run: bun test src/services/tests/contact.service.spec.ts
 */
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it, beforeAll, afterAll } from 'bun:test';
import { eq, and, inArray, sql } from 'drizzle-orm';
import db from '../../lib/drizzle/drizzle';
import {
  users,
  userProfiles,
  networks,
  networkMembers,
  personalNetworks,
} from '../../schemas/database.schema';
import { ContactService } from '../contact.service';

const TEST_PREFIX = 'contact_svc_v2_' + Date.now() + '_';

// -- Test fixtures --
let ownerId: string;
let existingUserId: string;
let personalNetworkId: string;

const ownerEmail = `${TEST_PREFIX}owner@example.com`;
const existingContactEmail = `${TEST_PREFIX}existing@example.com`;
const ghostEmail1 = `${TEST_PREFIX}ghost1@example.com`;

// Track IDs for cleanup
const createdUserIds: string[] = [];

let svc: ContactService;

/**
 * Helper: create a user and personal index for testing.
 */
async function createTestUser(id: string, email: string, name: string): Promise<string> {
  await db.insert(users).values({ id, name, email });
  await db.insert(userProfiles).values({ userId: id });
  createdUserIds.push(id);

  // Create personal index
  const networkId = crypto.randomUUID();
  await db.insert(networks).values({
    id: networkId,
    title: `${name}'s Personal Index`,
    isPersonal: true,
  });
  await db.insert(personalNetworks).values({ userId: id, networkId });
  await db.insert(networkMembers).values({
    networkId,
    userId: id,
    permissions: ['owner'],
    autoAssign: false,
  });
  return networkId;
}

beforeAll(async () => {
  svc = new ContactService();

  ownerId = crypto.randomUUID();
  existingUserId = crypto.randomUUID();

  // Create owner with personal index
  personalNetworkId = await createTestUser(ownerId, ownerEmail, TEST_PREFIX + 'Owner');

  // Create an existing (non-ghost) user (no personal index needed for them)
  await db.insert(users).values({
    id: existingUserId,
    name: TEST_PREFIX + 'ExistingContact',
    email: existingContactEmail,
  });
  createdUserIds.push(existingUserId);
}, 60_000);

afterAll(async () => {
  // Clean up in dependency order
  const allUserIds = [...createdUserIds];
  if (allUserIds.length > 0) {
    await db.delete(networkMembers).where(inArray(networkMembers.userId, allUserIds));
  }
  // Remove all members from personal index before deleting it (avoids FK constraint)
  await db.delete(networkMembers).where(eq(networkMembers.networkId, personalNetworkId));
  // Clean personal_indexes for owner
  await db.delete(personalNetworks).where(eq(personalNetworks.userId, ownerId));
  await db.delete(networks).where(eq(networks.id, personalNetworkId));
  if (allUserIds.length > 0) {
    await db.delete(userProfiles).where(inArray(userProfiles.userId, allUserIds));
    await db.delete(users).where(inArray(users.id, allUserIds));
  }
  await db.delete(users).where(eq(users.id, ownerId));
}, 60_000);

// ═══════════════════════════════════════════════════════════════════════════════
// 1. addContact — adds existing real user
// ═══════════════════════════════════════════════════════════════════════════════
describe('addContact', () => {
  it('adds an existing real user as a contact', async () => {
    const result = await svc.addContact(ownerId, existingContactEmail);

    expect(result.userId).toBe(existingUserId);
    expect(result.isNew).toBe(false);
    expect(result.isGhost).toBe(false);

    // Verify membership row exists
    const [membership] = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, existingUserId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(membership).toBeDefined();
    expect(membership.deletedAt).toBeNull();
  }, 60_000);

  it('creates a ghost for an unknown email', async () => {
    const result = await svc.addContact(ownerId, ghostEmail1, { name: 'Ghost One' });

    expect(result.isNew).toBe(true);
    expect(result.isGhost).toBe(true);
    createdUserIds.push(result.userId);

    // Verify ghost row in DB
    const [ghostRow] = await db
      .select({ isGhost: users.isGhost, name: users.name })
      .from(users)
      .where(eq(users.id, result.userId));
    expect(ghostRow.isGhost).toBe(true);
    expect(ghostRow.name).toBe('Ghost One');

    // Verify membership
    const [membership] = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, result.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(membership).toBeDefined();
  }, 60_000);

  it('skips soft-deleted contact when restore=false', async () => {
    const softEmail = `${TEST_PREFIX}softdel@example.com`;
    // First add the contact
    const first = await svc.addContact(ownerId, softEmail, { name: 'Soft Del' });
    createdUserIds.push(first.userId);

    // Soft-delete the membership
    await db
      .update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, first.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );

    // Try adding again with restore=false (default)
    const second = await svc.addContact(ownerId, softEmail, { restore: false });

    // Should return the same user but membership stays soft-deleted
    expect(second.userId).toBe(first.userId);

    const [membership] = await db
      .select({ deletedAt: networkMembers.deletedAt })
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, first.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(membership.deletedAt).not.toBeNull();
  }, 60_000);

  it('restores soft-deleted contact when restore=true', async () => {
    const restoreEmail = `${TEST_PREFIX}restore@example.com`;
    // First add the contact
    const first = await svc.addContact(ownerId, restoreEmail, { name: 'Restore Me' });
    createdUserIds.push(first.userId);

    // Soft-delete the membership
    await db
      .update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, first.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );

    // Restore
    const second = await svc.addContact(ownerId, restoreEmail, { restore: true });
    expect(second.userId).toBe(first.userId);

    // Membership should be active again
    const [membership] = await db
      .select({ deletedAt: networkMembers.deletedAt })
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, first.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(membership.deletedAt).toBeNull();
  }, 60_000);

  it('clears reverse opt-out when adding contact', async () => {
    const otherEmail = `${TEST_PREFIX}other@example.com`;
    const otherId = crypto.randomUUID();

    // Create "other" user with personal index
    const otherIndexId = await createTestUser(otherId, otherEmail, TEST_PREFIX + 'Other');

    // Simulate: other user has owner as a soft-deleted contact in their personal index
    await db.insert(networkMembers).values({
      networkId: otherIndexId,
      userId: ownerId,
      permissions: ['contact'],
      autoAssign: false,
      deletedAt: new Date(),
    }).onConflictDoNothing();

    // Owner adds other as contact — should clear reverse opt-out
    await svc.addContact(ownerId, otherEmail);

    // The soft-deleted row in other's personal index for owner should be gone
    const rows = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, otherIndexId),
          eq(networkMembers.userId, ownerId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(rows.length).toBe(0);

    // Cleanup: remove the other personal index
    await db.delete(networkMembers).where(eq(networkMembers.networkId, otherIndexId));
    await db.delete(personalNetworks).where(eq(personalNetworks.userId, otherId));
    await db.delete(networks).where(eq(networks.id, otherIndexId));
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. removeContact — hard deletes
// ═══════════════════════════════════════════════════════════════════════════════
describe('removeContact', () => {
  it('hard-deletes the contact membership', async () => {
    const removeEmail = `${TEST_PREFIX}removeme@example.com`;
    const addResult = await svc.addContact(ownerId, removeEmail, { name: 'Remove Me' });
    createdUserIds.push(addResult.userId);

    // Verify exists
    const beforeRows = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, addResult.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(beforeRows.length).toBe(1);

    // Remove
    await svc.removeContact(ownerId, addResult.userId);

    // Verify gone (hard delete, not soft delete)
    const afterRows = await db
      .select()
      .from(networkMembers)
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, addResult.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );
    expect(afterRows.length).toBe(0);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. listContacts — returns contacts, excludes soft-deleted
// ═══════════════════════════════════════════════════════════════════════════════
describe('listContacts', () => {
  it('returns active contacts with user details', async () => {
    const contacts = await svc.listContacts(ownerId);

    // existingUserId and ghostEmail1 should be present (added in addContact tests)
    const existing = contacts.find(c => c.userId === existingUserId);
    expect(existing).toBeDefined();
    expect(existing!.user.isGhost).toBe(false);
    expect(existing!.user.email).toBe(existingContactEmail);
  }, 60_000);

  it('excludes soft-deleted contacts', async () => {
    const sdEmail = `${TEST_PREFIX}sd_list@example.com`;
    const added = await svc.addContact(ownerId, sdEmail, { name: 'SD List' });
    createdUserIds.push(added.userId);

    // Soft-delete
    await db
      .update(networkMembers)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(networkMembers.networkId, personalNetworkId),
          eq(networkMembers.userId, added.userId),
          sql`'contact' = ANY(${networkMembers.permissions})`,
        )
      );

    const contacts = await svc.listContacts(ownerId);
    const found = contacts.find(c => c.userId === added.userId);
    expect(found).toBeUndefined();
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. importContacts — bulk with filtering
// ═══════════════════════════════════════════════════════════════════════════════
describe('importContacts', () => {
  it('imports valid contacts, skips invalid/non-human/duplicates', async () => {
    const bulkEmail1 = `${TEST_PREFIX}bulk1@example.com`;
    const bulkEmail2 = `${TEST_PREFIX}bulk2@example.com`;

    const result = await svc.importContacts(ownerId, [
      { name: 'Alice Chen', email: bulkEmail1 },
      { name: 'Robert Kumar', email: bulkEmail2 },
      { name: 'Alice Chen', email: bulkEmail1 }, // duplicate
      { name: 'Self', email: ownerEmail },        // self
      { name: 'Invalid', email: 'notanemail' },   // invalid
      { name: '', email: 'noreply@company.com' }, // non-human
    ]);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(4); // dup + self + invalid + non-human
    expect(result.newContacts).toBe(2); // both are new ghosts

    // Track for cleanup
    for (const d of result.details) {
      createdUserIds.push(d.userId);
    }

    // Verify both appear in list
    const contacts = await svc.listContacts(ownerId);
    const bulk1 = contacts.find(c => c.user.email === bulkEmail1);
    const bulk2 = contacts.find(c => c.user.email === bulkEmail2);
    expect(bulk1).toBeDefined();
    expect(bulk2).toBeDefined();
  }, 60_000);

  it('is idempotent — re-importing same contacts does not create duplicates', async () => {
    const result = await svc.importContacts(ownerId, [
      { name: 'Existing Person', email: existingContactEmail },
    ]);

    expect(result.imported).toBe(1);
    expect(result.newContacts).toBe(0);
    expect(result.existingContacts).toBe(1);
  }, 60_000);
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. importContacts — name-based dedup
// ═══════════════════════════════════════════════════════════════════════════════
describe('importContacts — name dedup', () => {
  it('deduplicates same-name contacts with different emails', async () => {
    const email1 = `${TEST_PREFIX}john_personal@gmail.com`;
    const email2 = `${TEST_PREFIX}john_work@company.com`;

    const result = await svc.importContacts(ownerId, [
      { name: 'John Smith', email: email1 },
      { name: 'John Smith', email: email2 },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    // Track for cleanup
    for (const d of result.details) {
      createdUserIds.push(d.userId);
    }

    // Only one contact membership should exist
    const contacts = await svc.listContacts(ownerId);
    const johns = contacts.filter(c =>
      c.user.email === email1 || c.user.email === email2
    );
    expect(johns.length).toBe(1);

    // But both ghost user rows should exist in the users table
    const [ghost1] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email1));
    const [ghost2] = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email2));
    expect(ghost1).toBeDefined();
    expect(ghost2).toBeDefined();
    createdUserIds.push(ghost2.id);
  }, 60_000);

  it('deduplicates names case-insensitively', async () => {
    const email1 = `${TEST_PREFIX}jane_a@example.com`;
    const email2 = `${TEST_PREFIX}jane_b@example.com`;

    const result = await svc.importContacts(ownerId, [
      { name: 'Jane Doe', email: email1 },
      { name: 'jane doe', email: email2 },
    ]);

    expect(result.imported).toBe(1);
    expect(result.skipped).toBe(1);

    for (const d of result.details) createdUserIds.push(d.userId);

    // Clean up orphan ghost
    const [orphan] = await db.select({ id: users.id }).from(users).where(eq(users.email, email2.toLowerCase()));
    if (orphan) createdUserIds.push(orphan.id);
  }, 60_000);

  it('does not merge contacts with different names', async () => {
    const email1 = `${TEST_PREFIX}alice_dedup@example.com`;
    const email2 = `${TEST_PREFIX}bob_dedup@example.com`;

    const result = await svc.importContacts(ownerId, [
      { name: 'Alice', email: email1 },
      { name: 'Bob', email: email2 },
    ]);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    for (const d of result.details) createdUserIds.push(d.userId);
  }, 60_000);

  it('does not merge nameless contacts with very different emails', async () => {
    // Use short, clearly distinct local-parts so the name-fallback (local-part)
    // scores low in Jaro-Winkler. Uniqueness provided by UUIDs, not a shared prefix.
    const uid1 = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const uid2 = crypto.randomUUID().replace(/-/g, '').slice(0, 8);
    const email1 = `xyz_${uid1}@gmail.com`;
    const email2 = `abc_${uid2}@company.com`;

    const result = await svc.importContacts(ownerId, [
      { name: '', email: email1 },
      { name: '', email: email2 },
    ]);

    expect(result.imported).toBe(2);
    expect(result.skipped).toBe(0);

    for (const d of result.details) createdUserIds.push(d.userId);
  }, 60_000);
});
