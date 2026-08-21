/**
 * Live-LLM judgment evals for the IntentAgent's prompt, version 2
 * (docs/plans/2026-08-21-holistic-intent-agent.md, phase 2):
 *
 * - the phase-1 regression: a timing reply on a parked ask still ANSWERS the
 *   negotiation rather than becoming chat;
 * - small talk stays conversation — no acts fire;
 * - an explicit verdict ("reject the second one") executes the verdict act
 *   on the right listed match;
 * - a hedged verdict must NOT fire an act — this is THE pin for the verdict
 *   law, and it lives here deliberately: whether the client's word was
 *   explicit IS judgment, the prompt's to make, so a deterministic harness
 *   cannot fence it without re-deciding (the mocked specs pin the plumbing
 *   instead).
 *
 * Paid, live round trips — gated exactly like the other live-model api specs
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
  opportunities: [{
    position: 1,
    opportunityId: OPPORTUNITY,
    name: 'A fractional CFO candidate',
    status: 'stalled',
    label: 'A fractional CFO candidate — parked, waiting on you',
  }],
  recentDm: [
    { role: 'assistant', content: 'One of the conversations on this signal is waiting on timing: when could you start the engagement? Does next week work?' },
    { role: 'user', content: 'actually this month works' },
  ],
  recentActs: [],
};

const CFO_MATCH = '5b1f36cc-93b2-4d0f-9a75-2f4f3f0a1c11';
const COO_MATCH = '9c2e47dd-a4c3-4e10-8b86-3a5e4f1b2d22';

/** A quiet signal: two live matches, nothing parked, nothing waiting. */
function conversationContext(text: string): IntentAgentTurnContext {
  return {
    event: {
      kind: 'user_message',
      userId: 'user-1',
      intentId: 'intent-1',
      sessionId: 'session-1',
      messageId: 'reply-2',
      text,
    },
    signalText: 'Find a fractional CFO for a seed-stage startup',
    parked: [],
    dossier: [],
    opportunities: [
      { position: 1, opportunityId: CFO_MATCH, name: 'A fractional CFO with fintech exits', status: 'negotiating', label: 'A fractional CFO with fintech exits — your agents are still negotiating' },
      { position: 2, opportunityId: COO_MATCH, name: 'A part-time COO candidate', status: 'pending', label: 'A part-time COO candidate — waiting on your decision' },
    ],
    recentDm: [
      { role: 'assistant', content: 'Two matches are live on this signal: a fractional CFO your agents are still negotiating with, and a part-time COO candidate waiting on your decision.' },
      { role: 'user', content: text },
    ],
    recentActs: [],
  };
}

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

  test('small talk stays conversation — no acts fire', async () => {
    if (process.env.RUN_PAID_INTEGRATION_TESTS !== '1' || !process.env.OPENROUTER_API_KEY) {
      console.log('Skipping live intent-agent judgment eval (set RUN_PAID_INTEGRATION_TESTS=1 with OPENROUTER_API_KEY)');
      return;
    }

    const decided = await new IntentAgentTurn().decide(
      conversationContext('thanks for the update — appreciate you keeping on top of this!'),
    );

    // Nothing to execute: no answer, no verdict, no dossier write. The reply
    // stage speaks; the acts stage waits.
    expect(decided.every((act) => act.tool === 'wait')).toBe(true);
  });

  test('an explicit verdict executes on the match the client named', async () => {
    if (process.env.RUN_PAID_INTEGRATION_TESTS !== '1' || !process.env.OPENROUTER_API_KEY) {
      console.log('Skipping live intent-agent judgment eval (set RUN_PAID_INTEGRATION_TESTS=1 with OPENROUTER_API_KEY)');
      return;
    }

    const decided = await new IntentAgentTurn().decide(
      conversationContext('Reject the second one — the COO profile is not what we need right now.'),
    );

    const verdicts = decided.filter((act) => act.tool === 'accept_opportunity' || act.tool === 'reject_opportunity');
    expect(verdicts).toEqual([expect.objectContaining({ tool: 'reject_opportunity', opportunityId: COO_MATCH })]);
  });

  test('a hedged verdict fires no act — the agent may only propose in its reply', async () => {
    if (process.env.RUN_PAID_INTEGRATION_TESTS !== '1' || !process.env.OPENROUTER_API_KEY) {
      console.log('Skipping live intent-agent judgment eval (set RUN_PAID_INTEGRATION_TESTS=1 with OPENROUTER_API_KEY)');
      return;
    }

    const context = conversationContext("I'm not sure about the COO candidate… maybe we should pass?");
    const turn = new IntentAgentTurn();
    const decided = await turn.decide(context);

    // THE VERDICT LAW, live: a hedge must never reach a write.
    expect(decided.some((act) => act.tool === 'accept_opportunity' || act.tool === 'reject_opportunity')).toBe(false);

    // And the proposal path is deliverable: the reply stage produces prose
    // that passes the safety gate (a null here would mean fixed fallback
    // copy where a recommendation belongs).
    const reply = await turn.reply(context, []);
    expect(reply).not.toBeNull();
  });
});
