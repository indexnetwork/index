/**
 * Live-LLM judgment eval for the IntentAgent's prompt
 * (docs/plans/2026-08-21-holistic-intent-agent.md): given a parked ask about
 * timing and a client reply "actually this month works", the agent must
 * ANSWER the negotiation — not merely chat back. This is the behavioral leg
 * of the collapse: the judgment the answer-precedence gate + router pipeline
 * used to make in stages is now one prompt's call, and this pins that the
 * prompt makes it.
 *
 * Paid, live round trip — gated exactly like the other live-model api specs
 * (embedder.adapter.spec.ts): RUN_PAID_INTEGRATION_TESTS=1 plus a real
 * OPENROUTER_API_KEY, skipped with a log otherwise. The protocol live-LLM
 * flake policy applies: re-run in isolation before blaming a diff.
 */
import { describe, expect, setDefaultTimeout, test } from 'bun:test';

import { IntentAgentTurn } from '../intent-agent.turn';
import type { IntentAgentTurnContext } from '../intent-agent.context';

setDefaultTimeout(120_000);

const OPPORTUNITY = '6d8b07ef-7fa8-4968-80d9-6af0ce364d27';

const CONTEXT: IntentAgentTurnContext = {
  event: {
    kind: 'user_message',
    userId: 'user-1',
    intentId: 'intent-1',
    sessionId: 'session-1',
    messageId: 'reply-1',
    text: 'actually this month works',
  },
  signalText: 'Find a fractional CFO for a seed-stage startup',
  parked: [{
    opportunityId: OPPORTUNITY,
    kind: 'mid_flight',
    reason: 'unresolved_owner_constraint',
    dimension: 'Timing: This week',
    dimensionKind: 'hard_constraint',
    question: {
      title: 'Timing',
      prompt: 'When could you start the engagement?',
      options: [
        { label: 'This week', description: 'Start immediately.' },
        { label: 'Later', description: 'Start at a later date.' },
      ],
    },
    transcript: [
      { action: 'propose', reasoning: 'Strong fit on finance experience.', message: 'Would you be open to a fractional CFO engagement?' },
      { action: 'ask_user', reasoning: 'Timing is unresolved and only the client can settle it.' },
    ],
    parkedAt: new Date('2026-08-20T20:20:00Z'),
  }],
  dossier: [],
  recentDm: [
    { role: 'assistant', content: 'One of the conversations on this signal is waiting on timing: when could you start the engagement? Does next week work?' },
    { role: 'user', content: 'actually this month works' },
  ],
  recentActs: [],
};

describe('IntentAgent judgment (live model)', () => {
  test('a timing reply answers the parked negotiation instead of becoming chat', async () => {
    if (process.env.RUN_PAID_INTEGRATION_TESTS !== '1' || !process.env.OPENROUTER_API_KEY) {
      console.log('Skipping live intent-agent judgment eval (set RUN_PAID_INTEGRATION_TESTS=1 with OPENROUTER_API_KEY)');
      return;
    }

    const decided = await new IntentAgentTurn().decide(CONTEXT);

    const answer = decided.find((act) => act.tool === 'answer_negotiation');
    expect(answer).toBeDefined();
    // The index → id mapping is the validator's, so a defined answer act is
    // already bound to the ONE parked negotiation.
    expect(answer).toMatchObject({ opportunityId: OPPORTUNITY });
    expect((answer as { answer: string }).answer.toLowerCase()).toContain('month');
    // And no act may ask the client for what they just said.
    for (const act of decided) {
      if (act.tool === 'message_user') {
        expect(act.text.toLowerCase()).not.toContain('when could you start');
      }
    }
  });
});
