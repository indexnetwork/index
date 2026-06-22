import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, expect, it } from 'bun:test';
import { searchUser } from './parallel';

const HAS_API_KEY = !!process.env.PARALLELS_API_KEY;

describe('Parallel API', () => {
  it.skipIf(!HAS_API_KEY)('searchUser returns results for a known query', async () => {
    const result = await searchUser({ objective: 'Casey Harper, "test-6285@example.com"' });
    expect(result).toBeDefined();
    expect(Array.isArray(result.results)).toBe(true);
  }, 30_000);
});
