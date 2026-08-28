/**
 * `createAndOpen` has two invariants a unit test cannot reach, because both
 * are about ORDER and about what does NOT happen. Pinned by reading the
 * source, the same technique `intent-scope-lock.contract.spec.ts` uses.
 *
 * The live proof that the lock actually serialises two callers is
 * `create-and-open.isolated.ts`, which races two real transactions.
 */
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../discovery-candidate.database.adapter.ts', import.meta.url), 'utf8',
);
const body = source.slice(source.indexOf('async createAndOpen('));

describe('createAndOpen lock contract', () => {
  it('takes the pair advisory lock before reading or writing', () => {
    const lock = body.indexOf('pg_advisory_xact_lock');
    const read = body.indexOf('.select(');
    const insert = body.indexOf('.insert(opportunities)');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(insert).toBeGreaterThan(lock);
    // A read BEFORE the lock is fine (it resolves the candidate); the one that
    // decides whether to insert must come after it.
    expect(read).toBeGreaterThanOrEqual(0);
    expect(body.slice(lock).indexOf('.select(')).toBeGreaterThan(0);
  });

  it('locks on the pair, not on the candidate', () => {
    expect(body).toContain('opportunity-pair:');
    expect(body).not.toContain('opportunity-candidate:');
  });

  it('never throws out of the transaction', () => {
    expect(body).toContain("status: 'failed'");
    expect(body.slice(0, body.indexOf('\n  }\n'))).not.toMatch(/\bthrow new Error\b/);
  });
});
