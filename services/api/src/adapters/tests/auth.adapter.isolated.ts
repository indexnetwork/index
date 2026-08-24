/**
 * Integration tests for the AuthDatabaseAdapter user-create upsert.
 * Requires DATABASE_URL and migrated schema.
 * Run: bun test src/adapters/tests/auth.adapter.spec.ts
 */
import { afterAll as bunAfterAll, describe, expect, it as bunIt } from 'bun:test';
import { eq } from 'drizzle-orm/sql';

import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { AuthDatabaseAdapter } from '../auth.adapter';
import { withMinimumDatabaseHookBudget, withMinimumDatabaseTestBudget } from '../../lib/testing/database-test-budget';

const afterAll = withMinimumDatabaseHookBudget(bunAfterAll, 90_000);
const it = withMinimumDatabaseTestBudget(bunIt, 30_000);

describe('AuthDatabaseAdapter', () => {
  const adapter = new AuthDatabaseAdapter();
  const testIds: string[] = [];
  const cleanupIndexIds: string[] = [];

  afterAll(async () => {
    // Clean up network members and indexes first (FK constraints)
    for (const networkId of cleanupIndexIds) {
      await db.delete(schema.networkMembers).where(eq(schema.networkMembers.networkId, networkId)).catch(() => {});
      await db.delete(schema.networks).where(eq(schema.networks.id, networkId)).catch(() => {});
    }
    for (const id of testIds) {
      await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => {});
    }
  });

  describe('user create via adapter upsert', () => {
    it('should create a normal user', async () => {
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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(result.id).toBe(userId);
      expect(result.email).toBe(email);
    });

    it('should throw on email conflict with an existing user', async () => {
      const realId = crypto.randomUUID();
      testIds.push(realId);
      const email = `real-${realId}@test.com`;

      await db.insert(schema.users).values({
        id: realId,
        name: 'Real Existing',
        email,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const adapterFactory = adapter.createDrizzleAdapter();
      const adapterInstance = (adapterFactory as Function)({});

      const newId = crypto.randomUUID();

      // Should throw — a conflict with an existing user is an explicit error
      await expect(
        adapterInstance.create({
          model: 'user',
          data: {
            id: newId,
            name: 'Duplicate',
            email,
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
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      expect(result.id).toBe(userId);
      // Email should be stored lowercase
      expect(result.email).toBe(mixedCaseEmail.toLowerCase());
    });

  });
});
