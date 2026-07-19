import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { searchUser } from './parallel';

const RUN_PAID_INTEGRATION = process.env.RUN_PAID_INTEGRATION_TESTS === '1'
  && !!process.env.PARALLELS_API_KEY;

describe('Parallel API', () => {
  it.skipIf(!RUN_PAID_INTEGRATION)('searchUser returns results for a known query', async () => {
    const result = await searchUser({ objective: 'Casey Harper, "test-6285@example.com"' });
    expect(result).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  }, 30_000);
});
