import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

import { intentScopeAdvisoryLockKey } from '../intent-scope.atomic';

const opportunitySource = readFileSync(
  new URL('../opportunity.database.adapter.ts', import.meta.url),
  'utf8',
);
const negotiationAttemptSource = readFileSync(
  new URL('../negotiation-attempt.atomic.ts', import.meta.url),
  'utf8',
);
const negotiationReactivationSource = readFileSync(
  new URL('../negotiation-reactivation.atomic.ts', import.meta.url),
  'utf8',
);
const chatDatabaseSource = readFileSync(
  new URL('../chat.database.adapter.ts', import.meta.url),
  'utf8',
);
const intentDatabaseSource = readFileSync(
  new URL('../intent.database.adapter.ts', import.meta.url),
  'utf8',
);
// The executor node is where the graph issues the locked intent write, so that
// is the file the CAS contract below is asserted against.
const protocolIntentGraphSource = readFileSync(
  new URL('../../../../../packages/protocol/src/intents/graph/intent.graph.execute.ts', import.meta.url),
  'utf8',
);

function methodSlice(source: string, start: string, end: string): string {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  expect(startIndex).toBeGreaterThanOrEqual(0);
  expect(endIndex).toBeGreaterThan(startIndex);
  return source.slice(startIndex, endIndex);
}

describe('intent-scope advisory lock contract', () => {
  it('keeps the established recipient+intent key without a second namespace', () => {
    expect(intentScopeAdvisoryLockKey('recipient-1', 'intent-1')).toBe('recipient-1:intent-1');
  });

  it('serializes exact-trigger opportunity persistence with the shared advisory helper', () => {
    const opportunity = methodSlice(
      opportunitySource,
      'async persistIntentScopedOpportunityIfNetworkEligible(',
      'async updateOpportunityStatusIfNetworkEligible(',
    );

    expect(opportunity).toContain('acquireIntentScopeAdvisoryLock(');
    expect(opportunity).toContain('eligibility.ownerUserId');
    expect(opportunity).toContain('eligibility.triggerIntentId');
    expect(opportunity.indexOf('acquireIntentScopeAdvisoryLock('))
      .toBeLessThan(opportunity.indexOf('acquireIntentScopedPairLocks('));
    expect(opportunity.indexOf('acquireIntentScopeAdvisoryLock('))
      .toBeLessThan(opportunity.indexOf(".from(schema.intents)"));
  });

  it('serializes exact-trigger opportunity reactivation before every conflicting row lock', () => {
    const reactivation = methodSlice(
      opportunitySource,
      'async updateOpportunityStatusIfNetworkEligible(',
      'async compensateTasklessNegotiatingOpportunity(',
    );
    const advisory = reactivation.indexOf('acquireIntentScopeAdvisoryLock(');
    const intentRow = reactivation.indexOf('.from(schema.intents)', advisory);
    const opportunityMutation = reactivation.indexOf('.update(opportunities)', advisory);
    expect(advisory).toBeGreaterThanOrEqual(0);
    expect(reactivation).toContain('eligibility.ownerUserId');
    expect(reactivation).toContain('eligibility.triggerIntentId');
    expect(intentRow).toBeGreaterThan(advisory);
    expect(opportunityMutation).toBeGreaterThan(advisory);

    const tasklessGuard = reactivation.indexOf("if (expectedStatus === 'negotiating')");
    const attemptLock = reactivation.indexOf('acquireNegotiationAttemptLock(tx, id)', tasklessGuard);
    const opportunityRow = reactivation.indexOf(".for('update')", attemptLock);
    const freshTask = reactivation.indexOf('qualifyingActiveNegotiationTaskWhere(id)', opportunityRow);
    expect(tasklessGuard).toBeGreaterThan(advisory);
    expect(attemptLock).toBeGreaterThan(tasklessGuard);
    expect(opportunityRow).toBeGreaterThan(attemptLock);
    expect(freshTask).toBeGreaterThan(opportunityRow);
  });

  it('reuses the canonical fresh-task SQL immediately before reactivation', () => {
    const activeTask = methodSlice(
      negotiationAttemptSource,
      'export function qualifyingActiveNegotiationTaskWhere(',
      '/** Pair-global tasks fresh enough',
    );
    const pairTask = methodSlice(
      negotiationAttemptSource,
      'export function qualifyingPairNegotiationTaskWhere(',
      '/**\n * Qualifying tasks that prove an attempt',
    );
    expect(activeTask).toContain("metadata}->>'type' = 'negotiation'");
    expect(activeTask).toContain("metadata}->>'opportunityId' = ${opportunityId}");
    expect(activeTask).toContain('qualifyingFreshNegotiationTaskStateWhere()');
    expect(pairTask).toContain('qualifyingFreshNegotiationTaskStateWhere()');
    expect(negotiationAttemptSource).toContain(
      "IN ('submitted', 'working', 'waiting_for_agent', 'claimed')",
    );
    expect(negotiationAttemptSource).toContain("state} = 'input_required'");

    const acquire = negotiationReactivationSource.indexOf('boundary.acquireAttemptLock()');
    const eligibility = negotiationReactivationSource.indexOf('boundary.validateEligibility()', acquire);
    const row = negotiationReactivationSource.indexOf('boundary.lockOpportunity()', eligibility);
    const task = negotiationReactivationSource.indexOf('boundary.hasFreshNegotiationTask()', row);
    const mutation = negotiationReactivationSource.indexOf('boundary.reactivate()', task);
    expect(acquire).toBeGreaterThanOrEqual(0);
    expect(eligibility).toBeGreaterThan(acquire);
    expect(row).toBeGreaterThan(eligibility);
    expect(task).toBeGreaterThan(row);
    expect(mutation).toBeGreaterThan(task);
  });

  it('threads lifecycle-aware CAS data to both final locked intent writers', () => {
    expect(protocolIntentGraphSource).toContain(
      'expectedIntentFingerprint: state.expectedIntentFingerprint',
    );
    expect(protocolIntentGraphSource).toContain('expectedIntentUserId: state.userId');

    for (const source of [chatDatabaseSource, intentDatabaseSource]) {
      const update = methodSlice(
        source,
        'async updateIntent(intentId:',
        'async archiveIntent(intentId:',
      );
      const rowLock = update.indexOf(".for('update')");
      const lifecycleGuard = update.indexOf('canApplyExpectedIntentUpdate(');
      const mutation = update.indexOf('tx.update(schema.intents)');
      expect(rowLock).toBeGreaterThanOrEqual(0);
      expect(lifecycleGuard).toBeGreaterThan(rowLock);
      expect(mutation).toBeGreaterThan(lifecycleGuard);
      expect(update).toContain('status: schema.intents.status');
      expect(update).toContain('archivedAt: schema.intents.archivedAt');
      expect(update).toContain('data.expectedIntentUserId');
    }
  });

});
