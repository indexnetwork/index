/**
 * The counterparty-binding stamp (capture time) and the resume it must survive.
 *
 * #1474 made the settle survive drift; #1475 made the claim and expiry survive
 * drift. The live re-drive STILL refused — correctly — because the park's
 * stored coordinates were wrong at the source: a premise-matched counterparty
 * actor carries BOTH keys (`premise` is its own fact, `intent` names the
 * intent it matched AGAINST — the recipient's), and the capture's intent-first
 * preference stamped every such park with the recipient's own intent. The
 * claim's counterparty-liveness check ("intent owned by the counterparty")
 * can never pass for that stamp. This spec pins the corrected stamp at its
 * source and then runs the whole chain the three lanes fixed: correct stamp →
 * drift → drift-tolerant settle → drift-tolerant claim → successor minted.
 *
 * Seeding lives in fixtures/negotiation-park.fixture.ts, shared with the
 * intent-agent loop spec that drives the same chain through the agent.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { questionerAdapter } from '../questioner.adapter.instance';
import { intents, opportunities } from '../../schemas/database.schema';
import { tasks } from '../../schemas/conversation.schema';
import { captureParkBinding, cleanupParkFixtures, newParkFixtureCleanup, parkFixtureTask, seedWorkingNegotiation } from './fixtures/negotiation-park.fixture';
import type { ParkFixture } from './fixtures/negotiation-park.fixture';

setDefaultTimeout(30_000);

const cleanup = newParkFixtureCleanup();

afterAll(() => cleanupParkFixtures(cleanup));

async function parkSettleAndClaim(fixture: ParkFixture, freeText: string) {
  // The real pause parks the task after the capture armed the timeout.
  await parkFixtureTask(fixture);
  const settled = await questionerAdapter.settleInflightNegotiationAnswerFromDm({
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    recipientUserId: fixture.recipientId,
    recipientIntentId: fixture.recipientIntentId,
    networkId: fixture.networkId,
    answer: { selectedOptions: [], freeText, answeredAt: new Date().toISOString() },
  });
  const claim = await questionerAdapter.claimNegotiationContinuationExecution({
    taskId: fixture.taskId,
    settlementId: fixture.settlementId,
    opportunityId: fixture.opportunityId,
    userId: fixture.recipientId,
    recipientIntentId: fixture.recipientIntentId,
    networkId: fixture.networkId,
  });
  return { settled, claim };
}

describe('captureNegotiationAskUserBinding counterparty stamp', () => {
  test('a premise-matched counterparty is premise-bound, even when its actor also names the matched-against intent', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'premise');
    const binding = await captureParkBinding(fixture);
    expect(binding.counterpartyUserId).toBe(fixture.counterpartyId);
    expect(binding.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
    const [task] = await db.select({ metadata: tasks.metadata }).from(tasks).where(eq(tasks.id, fixture.taskId));
    const turnContext = (task.metadata as Record<string, unknown>).turnContext as Record<string, unknown>;
    expect((turnContext.askUserBinding as Record<string, unknown>).counterpartyBinding)
      .toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
  });

  test('the incident end-to-end, inverted: correct stamp → drift → DM settle → claim mints the successor', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'premise');
    const binding = await captureParkBinding(fixture);
    expect(binding.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });

    // The 2026-08-20 incident's drift, on a correctly stamped park: signal
    // edited AND opportunity moved within the resumable set after the park.
    await db.update(intents)
      .set({ payload: 'Find a manufacturing partner for a sensor line — now EU-based, Q4 start' })
      .where(eq(intents.id, fixture.recipientIntentId));
    await db.update(opportunities)
      .set({ status: 'stalled', updatedAt: new Date(Date.now() + 1000) })
      .where(eq(opportunities.id, fixture.opportunityId));

    const { settled, claim } = await parkSettleAndClaim(fixture, 'Q4 works; EU preferred.');
    expect(settled).toBe('settled');
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.counterpartyBinding).toEqual({ kind: 'premise', id: fixture.counterpartyPremiseId! });
    expect(claim.execution.consultation).toMatchObject({
      kind: 'answer',
      recipientUserId: fixture.recipientId,
      freeText: 'Q4 works; EU preferred.',
    });
    const [successor] = await db.select().from(tasks).where(eq(tasks.id, claim.execution.successorTaskId));
    expect(successor.metadata).toMatchObject({
      resumeFromTaskId: fixture.taskId,
      continuationSettlementId: fixture.settlementId,
    });
  });

  test('an intent-only counterparty still stamps its own intent and the claim still passes', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'intent');
    const binding = await captureParkBinding(fixture);
    expect(binding.counterpartyBinding).toEqual({ kind: 'intent', id: fixture.counterpartyIntentId! });

    const { settled, claim } = await parkSettleAndClaim(fixture, 'Ready when you are.');
    expect(settled).toBe('settled');
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
    expect(claim.execution.counterpartyBinding).toEqual({ kind: 'intent', id: fixture.counterpartyIntentId! });
  });
});
