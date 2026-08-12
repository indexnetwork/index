import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const apiRoot = path.resolve(import.meta.dir, '../../../..');
const migration = readFileSync(
  path.join(apiRoot, 'drizzle/0124_add_eval_matrix_quality_attestation.sql'),
  'utf8',
).trim();

describe('quality-attestation migration compatibility', () => {
  it('is safe when the nullable column was applied under its historical migration identity', () => {
    expect(migration).toBe(
      'ALTER TABLE "eval_matrix_metadata" ADD COLUMN IF NOT EXISTS "quality_attestation" jsonb;',
    );
  });
});
