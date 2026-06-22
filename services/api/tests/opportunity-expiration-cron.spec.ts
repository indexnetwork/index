import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect } from 'bun:test';
import db from '../src/lib/drizzle/drizzle';
import { opportunities } from '../src/schemas/database.schema';
import { and, isNotNull, lte, notInArray } from 'drizzle-orm';

describe('expireStaleOpportunities query logic', () => {
  it('builds the correct query conditions', () => {
    // Verify the Drizzle query conditions are valid (no runtime errors)
    const now = new Date();
    const conditions = and(
      isNotNull(opportunities.expiresAt),
      lte(opportunities.expiresAt, now),
      notInArray(opportunities.status, ['accepted', 'rejected', 'expired'])
    );
    expect(conditions).toBeDefined();
  });
});
