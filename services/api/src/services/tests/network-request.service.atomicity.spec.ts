import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

// Concurrent network-request transitions (two staff reviews, or a requester
// update/dismiss racing a review) must not interleave into contradictory state.
// A true race needs a live database; this contract test pins the source-level
// guarantees that make the race safe, so a future refactor can't silently drop
// the row lock, move the membership write out of the transaction, or send email
// before the change commits.
const source = readFileSync(new URL('../network-request.service.ts', import.meta.url), 'utf8');

function methodSlice(name: string): string {
  const start = source.indexOf(`async ${name}(`);
  expect(start).toBeGreaterThanOrEqual(0);
  // Slice to the next top-level method (2-space indented `async`/`private`) or EOF.
  const rest = source.slice(start + name.length);
  const nextIdx = rest.search(/\n {2}(?:async |private )/);
  return nextIdx >= 0 ? rest.slice(0, nextIdx) : rest;
}

describe('network-request.service transition atomicity', () => {
  it('serializes each mutating transition in a db.transaction', () => {
    for (const method of ['updateRequest', 'dismissRequest', 'reviewRequest']) {
      expect(methodSlice(method)).toContain('db.transaction');
    }
  });

  it('locks the request row with FOR UPDATE before mutating it', () => {
    // reviewRequest locks inline; update/dismiss lock through lockOwnedRequest.
    expect(methodSlice('reviewRequest')).toContain(".for('update')");
    expect(methodSlice('lockOwnedRequest')).toContain(".for('update')");
    for (const method of ['updateRequest', 'dismissRequest']) {
      expect(methodSlice(method)).toContain('lockOwnedRequest');
    }
  });

  it('writes owner membership inside the review transaction (not a separate op)', () => {
    const review = methodSlice('reviewRequest');
    const txnStart = review.indexOf('db.transaction');
    const txnEnd = review.indexOf('const outcome = await db.transaction') >= 0
      ? review.indexOf('});', txnStart)
      : review.length;
    const txnBody = review.slice(txnStart, txnEnd);
    expect(txnBody).toContain('.insert(schema.networkMembers)');
    // The membership write must not also live outside the transaction.
    expect(review.slice(txnEnd)).not.toContain('.insert(schema.networkMembers)');
  });

  it('fires the membership event and email only after the transaction commits', () => {
    const review = methodSlice('reviewRequest');
    const commitBoundary = review.indexOf('const outcome = await db.transaction');
    const afterCommit = review.indexOf('outcome.membershipCreated');
    expect(commitBoundary).toBeGreaterThanOrEqual(0);
    // Side effects reference `outcome`, which only exists once the transaction resolved.
    expect(afterCommit).toBeGreaterThan(commitBoundary);
    expect(review.indexOf('NetworkMembershipEvents.onMemberAdded')).toBeGreaterThan(afterCommit);
    expect(review.indexOf('this.emailRequester(outcome.decision')).toBeGreaterThan(afterCommit);
  });
});
