/**
 * The IntentAgent loop against the REAL effects substrate
 * (docs/plans/2026-08-21-holistic-intent-agent.md): the end-to-end that took
 * four PRs to make honest — park → capture → settle → claim → successor —
 * now passes through the agent in one spec. The model is the only thing
 * mocked (`deps.turn` decides deterministically); the parked-negotiation
 * reader, the chat session service, the dossier, the ledger, and the
 * settle/claim adapters are all production code over the test database.
 */
import { afterAll, describe, expect, setDefaultTimeout, test } from 'bun:test';
import { eq } from 'drizzle-orm';

import db from '../../../lib/drizzle/drizzle';
import { questionerAdapter } from '../../../adapters/questioner.adapter.instance';
import { intentDossierAdapter } from '../../../adapters/intent-dossier.adapter';
import { intentAgentLedgerAdapter } from '../../../adapters/intent-agent-ledger.adapter';
import { chatSessionService } from '../../../services/chat.service';
import { tasks } from '../../../schemas/conversation.schema';
import { captureParkBinding, cleanupParkFixtures, newParkFixtureCleanup, parkFixtureTask, seedWorkingNegotiation } from '../../../adapters/tests/fixtures/negotiation-park.fixture';
import { runIntentAgentTurn } from '../intent-agent.host';
import type { IntentAgentDecidedAct } from '../intent-agent.types';
import type { IntentAgentTurnContext } from '../intent-agent.context';

setDefaultTimeout(60_000);

const cleanup = newParkFixtureCleanup();

afterAll(() => cleanupParkFixtures(cleanup));

/** A deterministic judgment seam: the loop runs everything else for real. */
function scriptedTurn(
  script: (context: IntentAgentTurnContext) => IntentAgentDecidedAct[],
  reply?: string,
) {
  return {
    decide: async (context: IntentAgentTurnContext) => script(context),
    // Phase 2: a client-message turn ends with the streaming reply stage.
    ...(reply !== undefined ? { reply: async () => ({ text: reply }) } : {}),
  };
}

describe('IntentAgent loop over the real settle/claim substrate', () => {
  test('ask → answer → settle → claim → successor, through the agent', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'premise');
    await captureParkBinding(fixture);
    await parkFixtureTask(fixture);

    // ── Turn 1: the park wakes the agent; the dossier is empty, so it asks. ──
    const askText = 'One of the conversations on this signal needs your timing — does this quarter work for a start?';
    const turn1 = await runIntentAgentTurn(
      { kind: 'negotiation_needs_input', userId: fixture.recipientId, intentId: fixture.recipientIntentId, opportunityId: fixture.opportunityId, taskId: fixture.taskId },
      {
        turn: scriptedTurn((context) => {
          // The context's waiting list is the REAL parked set: the production
          // reader resolved the park the capture just armed.
          expect(context.parked.map((parked) => parked.opportunityId)).toContain(fixture.opportunityId);
          expect(context.dossier).toHaveLength(0);
          return [{ tool: 'message_user', text: askText }];
        }),
      },
    );

    expect(turn1.messages).toEqual([askText]);
    // The ask is an ordinary chat message in the signal's negotiator DM.
    const session = await chatSessionService.findNegotiatorIntentSession(fixture.recipientId, fixture.recipientIntentId);
    expect(session).not.toBeNull();
    cleanup.conversations.push(session!.id);
    const dmAfterAsk = await chatSessionService.getSessionMessages(session!.id);
    expect(dmAfterAsk.map((message) => [message.role, message.content])).toEqual([['assistant', askText]]);
    // The waiting is recorded: the ledger holds the act, the park stays the
    // durable record.
    const ledgerAfterAsk = await intentAgentLedgerAdapter.readRecent(fixture.recipientId, fixture.recipientIntentId);
    expect(ledgerAfterAsk[0]!.act).toMatchObject({ tool: 'message_user', text: askText });
    expect(ledgerAfterAsk[0]!.event).toMatchObject({ kind: 'negotiation_needs_input', opportunityId: fixture.opportunityId });

    // ── Turn 2: the client replies; the agent answers the negotiation. ──
    const replyId = await chatSessionService.addMessage({ sessionId: session!.id, role: 'user', content: 'Q4 works; EU preferred.' });
    const ackText = 'Thanks — I have taken Q4 with an EU preference back to that conversation.';
    // Phase 2: the acknowledgment is the reply STAGE's, not an acts-stage
    // message_user — the acts decide effects, the reply speaks.
    const turn2 = await runIntentAgentTurn(
      { kind: 'user_message', userId: fixture.recipientId, intentId: fixture.recipientIntentId, sessionId: session!.id, messageId: replyId, text: 'Q4 works; EU preferred.' },
      {
        turn: scriptedTurn((context) => {
          const waiting = context.parked.find((parked) => parked.opportunityId === fixture.opportunityId);
          expect(waiting).toBeDefined();
          return [
            { tool: 'answer_negotiation', opportunityId: waiting!.opportunityId, answer: 'Q4 works; EU preferred.' },
          ];
        }, ackText),
      },
    );

    // The REAL settle ran: the answer act reports the inflight resume.
    const answerAct = turn2.acts.find((act) => act.tool === 'answer_negotiation');
    expect(answerAct).toMatchObject({ outcome: 'resumed_inflight', opportunityId: fixture.opportunityId });

    // The disclosure boundary: the answer became a dossier entry before it
    // fed the table.
    const dossier = await intentDossierAdapter.readActiveEntries(fixture.recipientId, fixture.recipientIntentId);
    expect(dossier.map((entry) => [entry.source, entry.text])).toEqual([['answer', 'Q4 works; EU preferred.']]);
    expect(answerAct).toMatchObject({ dossierEntryId: dossier[0]!.id });

    // The claim — the same call the run-existing worker makes — mints the
    // successor from the settled consultation.
    const claim = await questionerAdapter.claimNegotiationContinuationExecution({
      taskId: fixture.taskId,
      settlementId: fixture.settlementId,
      opportunityId: fixture.opportunityId,
      userId: fixture.recipientId,
      recipientIntentId: fixture.recipientIntentId,
      networkId: fixture.networkId,
    });
    expect(claim.status).toBe('claimed');
    if (claim.status !== 'claimed') return;
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

    // The client heard back — the reply-stage delivery — and both acts are
    // on the ledger, the reply marked with its stage.
    expect(turn2.messages).toEqual([ackText]);
    const ledgerAfterAnswer = await intentAgentLedgerAdapter.readRecent(fixture.recipientId, fixture.recipientIntentId);
    expect(ledgerAfterAnswer.map((row) => row.act.tool)).toEqual(['message_user', 'answer_negotiation', 'message_user']);
    expect(ledgerAfterAnswer[0]!.act).toMatchObject({ stage: 'reply', text: ackText });
  });

  test('answer-from-knowledge: a dossier fact answers the park without asking — the duplicate-question kill', async () => {
    const fixture = await seedWorkingNegotiation(cleanup, 'intent');
    await captureParkBinding(fixture);
    await parkFixtureTask(fixture);

    // The client already said it, in an earlier conversation on this signal.
    await intentDossierAdapter.addEntry({
      userId: fixture.recipientId,
      intentId: fixture.recipientIntentId,
      text: 'Timing: Q4 works, EU preferred.',
      source: 'user_message',
    });

    const turn = await runIntentAgentTurn(
      { kind: 'negotiation_needs_input', userId: fixture.recipientId, intentId: fixture.recipientIntentId, opportunityId: fixture.opportunityId, taskId: fixture.taskId },
      {
        turn: scriptedTurn((context) => {
          expect(context.dossier.map((entry) => entry.text)).toContain('Timing: Q4 works, EU preferred.');
          const waiting = context.parked.find((parked) => parked.opportunityId === fixture.opportunityId);
          return [{ tool: 'answer_negotiation', opportunityId: waiting!.opportunityId, answer: 'Q4 works, EU preferred.' }];
        }),
      },
    );

    // The negotiation resumed from knowledge; the client was never asked —
    // no message left the turn, and no DM was ever conjured for this signal.
    const answerAct = turn.acts.find((act) => act.tool === 'answer_negotiation');
    expect(answerAct).toMatchObject({ outcome: 'resumed_inflight' });
    expect(turn.messages).toEqual([]);
    expect(await chatSessionService.findNegotiatorIntentSession(fixture.recipientId, fixture.recipientIntentId)).toBeNull();

    const [task] = await db.select({ state: tasks.state }).from(tasks).where(eq(tasks.id, fixture.taskId));
    expect(task.state).not.toBe('input_required');
  });
});
