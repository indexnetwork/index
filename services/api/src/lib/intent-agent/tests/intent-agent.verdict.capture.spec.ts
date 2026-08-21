/**
 * Verdict acts over the REAL #1471 lane (phase 2 of
 * docs/plans/2026-08-21-holistic-intent-agent.md): the model is the only
 * thing mocked — context assembly reads the production actionable list, the
 * act executes through `passVerdictOnOpportunity` → the SAME
 * `opportunityService.updateOpportunityStatus` the Radar card calls, the DB
 * status transitions, and the ledger records the outcome.
 *
 * What is deliberately NOT pinned here: that a hedged message produces no
 * verdict act. Whether the client's word was explicit IS judgment — the
 * prompt's law — and a deterministic harness cannot fence it without
 * re-deciding; the live eval (intent-agent.judgment.llm.spec.ts) pins it.
 * This spec pins the plumbing: what the agent decides is what the lane
 * executes, and nothing fires that was not decided.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../../lib/drizzle/drizzle';
import { opportunities } from '../../../schemas/database.schema';
import { intentAgentLedgerAdapter } from '../../../adapters/intent-agent-ledger.adapter';
import { chatSessionService } from '../../../services/chat.service';
import { cleanupParkFixtures, newParkFixtureCleanup, seedWorkingNegotiation } from '../../../adapters/tests/fixtures/negotiation-park.fixture';
import { runIntentAgentTurn } from '../intent-agent.host';
import type { IntentAgentDecidedAct } from '../intent-agent.types';
import type { IntentAgentTurnContext } from '../intent-agent.context';

setDefaultTimeout(60_000);

const cleanup = newParkFixtureCleanup();

afterAll(() => cleanupParkFixtures(cleanup));

describe('IntentAgent verdict acts over the real #1471 lane', () => {
  test('an explicit reject decided by the agent transitions the opportunity and ledgers the outcome', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'intent');

    // The client's DM and their message — the turn's event.
    const resolved = await chatSessionService.resolveNegotiatorIntentSession(fixture.recipientId, fixture.recipientIntentId);
    if ('error' in resolved) throw new Error(resolved.error);
    cleanup.conversations.push(resolved.session.id);
    const messageId = await chatSessionService.addMessage({
      sessionId: resolved.session.id,
      role: 'user',
      content: 'Reject the manufacturing match — we are going another way.',
    });

    const replyText = 'Done — I declined that match on your word. Nothing else on this signal needs you right now.';
    const turn = await runIntentAgentTurn(
      {
        kind: 'user_message',
        userId: fixture.recipientId,
        intentId: fixture.recipientIntentId,
        sessionId: resolved.session.id,
        messageId,
        text: 'Reject the manufacturing match — we are going another way.',
      },
      {
        turn: {
          decide: async (context: IntentAgentTurnContext): Promise<IntentAgentDecidedAct[]> => {
            // Context assembly served the PRODUCTION actionable list: the
            // fixture's negotiating pairing is numbered and id-mapped.
            const listed = context.opportunities.find((o) => o.opportunityId === fixture.opportunityId);
            expect(listed).toBeDefined();
            expect(listed!.status).toBe('negotiating');
            return [{
              tool: 'reject_opportunity',
              opportunityId: listed!.opportunityId,
              reason: 'Client: reject the manufacturing match.',
            }];
          },
          reply: async () => replyText,
        },
      },
    );

    // The REAL write ran: the same transition the Radar's Skip performs.
    const [row] = await db.select({ status: opportunities.status })
      .from(opportunities).where(eq(opportunities.id, fixture.opportunityId));
    expect(row!.status).toBe('rejected');

    // The act reports the executed outcome, naming who the write landed on.
    const verdictAct = turn.acts.find((act) => act.tool === 'reject_opportunity');
    expect(verdictAct).toMatchObject({
      opportunityId: fixture.opportunityId,
      outcome: 'executed',
    });

    // The client heard the reply-stage acknowledgment, and both the verdict
    // and the reply are on the ledger.
    expect(turn.messages).toEqual([replyText]);
    const ledger = await intentAgentLedgerAdapter.readRecent(fixture.recipientId, fixture.recipientIntentId);
    expect(ledger.map((rowLedger) => rowLedger.act.tool)).toEqual(['message_user', 'reject_opportunity']);
    expect(ledger[1]!.act).toMatchObject({ tool: 'reject_opportunity', outcome: 'executed' });
    expect(ledger[1]!.event).toMatchObject({ kind: 'user_message', intentId: fixture.recipientIntentId });
  });

  test('a verdict on an opportunity that left the actionable set executes nothing and reports honestly', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'intent');
    // Concluded before the agent's act lands: the actionable set moved on.
    await db.update(opportunities).set({ status: 'expired' }).where(eq(opportunities.id, fixture.opportunityId));

    const resolved = await chatSessionService.resolveNegotiatorIntentSession(fixture.recipientId, fixture.recipientIntentId);
    if ('error' in resolved) throw new Error(resolved.error);
    cleanup.conversations.push(resolved.session.id);
    const messageId = await chatSessionService.addMessage({
      sessionId: resolved.session.id, role: 'user', content: 'Accept them.',
    });

    const turn = await runIntentAgentTurn(
      {
        kind: 'user_message',
        userId: fixture.recipientId,
        intentId: fixture.recipientIntentId,
        sessionId: resolved.session.id,
        messageId,
        text: 'Accept them.',
      },
      {
        turn: {
          // The agent decided from stale knowledge (an id no longer listed);
          // the lane refuses the write and the act records why.
          decide: async () => [{ tool: 'accept_opportunity' as const, opportunityId: fixture.opportunityId }],
          reply: async () => 'That match had already closed before your word reached it — nothing was decided.',
        },
      },
    );

    const [row] = await db.select({ status: opportunities.status })
      .from(opportunities).where(eq(opportunities.id, fixture.opportunityId));
    expect(row!.status).toBe('expired');
    const verdictAct = turn.acts.find((act) => act.tool === 'accept_opportunity');
    expect(verdictAct).toMatchObject({ outcome: 'none_actionable' });
  });
});
