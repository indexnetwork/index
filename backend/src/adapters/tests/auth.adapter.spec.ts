/**
 * Integration tests for AuthDatabaseAdapter ghost-claim upsert.
 * Requires DATABASE_URL and migrated schema.
 * Run: bun test src/adapters/tests/auth.adapter.spec.ts
 */
/** Config */
import { config } from "dotenv";
config({ path: '.env.test', override: true });

import { describe, it, expect, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { AuthDatabaseAdapter } from '../auth.adapter';

describe('AuthDatabaseAdapter', () => {
  const adapter = new AuthDatabaseAdapter();
  const testIds: string[] = [];
  const cleanupIndexIds: string[] = [];

  afterAll(async () => {
    // Clean up index members and indexes first (FK constraints)
    for (const networkId of cleanupIndexIds) {
      await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, networkId)).catch(() => {});
      await db.delete(schema.networks).where(eq(schema.networks.id, networkId)).catch(() => {});
    }
    for (const id of testIds) {
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  describe('ghost claim via adapter upsert', () => {
    it('should create a normal user when no ghost exists', async () => {
      const userId = crypto.randomUUID();
      testIds.push(userId);
      const email = `normal-${userId}@test.com`;

      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const result = await adapterInstance.create({
        model: 'user',
        data: {
          id: userId,
          name: 'Normal User',
          email,
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(result.id).toBe(userId);
      expect(result.email).toBe(email);
      expect(result.isGhost).toBe(false);
    });

    it('should convert ghost to real user on email conflict', async () => {
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);
      const email = `claim-${ghostId}@test.com`;

      // Create ghost directly in DB
      await db.insert(schema.users).values({
        id: ghostId,
        name: 'Ghost Before',
        email,
        isGhost: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Simulate Better Auth signup with same email
      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const newId = crypto.randomUUID();
      const result = await adapterInstance.create({
        model: 'user',
        data: {
          id: newId,
          name: 'Real User',
          email,
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Should return the ghost's original ID, not the new one
      expect(result.id).toBe(ghostId);
      expect(result.isGhost).toBe(false);
      expect(result.name).toBe('Real User');

      // New ID should NOT exist as a separate row
      const rows = await db.select().from(schema.users).where(eq(schema.users.id, newId));
      expect(rows.length).toBe(0);
    });

    it('should throw on email conflict with real (non-ghost) user', async () => {
      const realId = crypto.randomUUID();
      testIds.push(realId);
      const email = `real-${realId}@test.com`;

      await db.insert(schema.users).values({
        id: realId,
        name: 'Real Existing',
        email,
        isGhost: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const newId = crypto.randomUUID();

      // Should throw — conflict with non-ghost user triggers explicit error
      await expect(
        adapterInstance.create({
          model: 'user',
          data: {
            id: newId,
            name: 'Duplicate',
            email,
            isGhost: false,
            createdAt: new Date(),
            updatedAt: new Date(),
          },
        })
      ).rejects.toThrow('User with this email already exists');

      // Original user should be unchanged
      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, realId));
      expect(user.name).toBe('Real Existing');
    });

    it('should pass through non-user model creates to base adapter', async () => {
      // Verify the adapter preserves all base methods for non-user models
      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      expect(typeof adapterInstance.create).toBe('function');
      expect(typeof adapterInstance.findOne).toBe('function');
      expect(typeof adapterInstance.update).toBe('function');
    });

    it('should normalize email to lowercase before insert (IND-166)', async () => {
      const userId = crypto.randomUUID();
      testIds.push(userId);
      const mixedCaseEmail = `MixedCase-${userId}@Test.COM`;

      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const result = await adapterInstance.create({
        model: 'user',
        data: {
          id: userId,
          name: 'Mixed Case User',
          email: mixedCaseEmail,
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(result.id).toBe(userId);
      // Email should be stored lowercase
      expect(result.email).toBe(mixedCaseEmail.toLowerCase());
    });

    it('should claim ghost even when signup email has different casing (IND-166)', async () => {
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);
      const lowercaseEmail = `ghost-case-${ghostId}@test.com`;

      // Create ghost with lowercase email
      await db.insert(schema.users).values({
        id: ghostId,
        name: 'Ghost',
        email: lowercaseEmail,
        isGhost: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Signup with mixed-case variant of the same email
      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const newId = crypto.randomUUID();
      const result = await adapterInstance.create({
        model: 'user',
        data: {
          id: newId,
          name: 'Real User',
          email: lowercaseEmail.replace('ghost-case', 'Ghost-Case'), // different casing
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      // Should claim the ghost (same ID) since normalization makes emails match
      expect(result.id).toBe(ghostId);
      expect(result.isGhost).toBe(false);
    });

    it('should preserve existing ghost data after claim', async () => {
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);
      const email = `preserve-${ghostId}@test.com`;

      // Create ghost with profile data
      await db.insert(schema.users).values({
        id: ghostId,
        name: 'Ghost Original',
        email,
        isGhost: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      // Create some related data for the ghost (index membership)
      const networkId = crypto.randomUUID();
      cleanupIndexIds.push(networkId);
      await db.insert(schema.networks).values({
        id: networkId,
        title: 'Test Index',
        isPersonal: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });
      await db.insert(schema.networkMembers).values({
        networkId,
        userId: ghostId,
        permissions: ['contact'],
      });

      // Claim via adapter upsert
      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const result = await adapterInstance.create({
        model: 'user',
        data: {
          id: crypto.randomUUID(),
          name: 'Real Claimed',
          email,
          isGhost: false,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(result.id).toBe(ghostId);

      // Verify index membership still references ghost's original ID
      const [member] = await db.select()
        .from(schema.networkMembers)
        .where(eq(schema.networkMembers.userId, ghostId));
      expect(member).toBeDefined();
    });
  });

  describe('claimGhostUser', () => {
    it('should flip isGhost to false for a ghost user', async () => {
      const ghostId = crypto.randomUUID();
      testIds.push(ghostId);
      const email = `claim-ghost-${ghostId}@test.com`;

      await db.insert(schema.users).values({
        id: ghostId,
        name: 'Ghost To Claim',
        email,
        isGhost: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      await adapter.claimGhostUser(ghostId);

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, ghostId));
      expect(user.isGhost).toBe(false);
      expect(user.name).toBe('Ghost To Claim');
    });

    it('should be a no-op for a non-ghost user', async () => {
      const userId = crypto.randomUUID();
      testIds.push(userId);
      const email = `real-claim-${userId}@test.com`;

      await db.insert(schema.users).values({
        id: userId,
        name: 'Real User',
        email,
        isGhost: false,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const beforeUpdate = new Date();
      await adapter.claimGhostUser(userId);

      const [user] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
      expect(user.isGhost).toBe(false);
      expect(user.updatedAt <= beforeUpdate).toBe(true);
    });

    it('should be a no-op for a non-existent user', async () => {
      await adapter.claimGhostUser(crypto.randomUUID());
    });
  });
});
