/**
 * The IntentAgent's judgment seam and its explicitness pins
 * (docs/plans/2026-08-21-holistic-intent-agent.md):
 *
 * - the model refers to negotiations and dossier entries strictly by number,
 *   and a number outside the lists rejects the whole round trip — fail-closed,
 *   like the answer router it replaced;
 * - no act ever fires without a triggering event: acts exist only as the
 *   return of `decide(context)`, and the executor runs only what was decided;
 * - `wait()` is a real act — ledgered, so silence is auditable;
 * - the disclosure boundary is structural: the answer executor writes the
 *   dossier entry BEFORE the spine sees the answer.
 */
import { describe, expect, it } from 'bun:test';

import { IntentAgentTurn } from '../intent-agent.turn';
import type { IntentAgentTurnContext } from '../intent-agent.context';
import { INTENT_AGENT_SILENT_TURN_REPLY, INTENT_AGENT_UNRESUMABLE_MESSAGE, executeIntentAgentActs } from '../intent-agent.host';
import type { IntentAgentHostDeps } from '../intent-agent.host';
import type { IntentAgentInboxEvent } from '../intent-agent.types';
import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';

const OPP_A = '11111111-1111-4111-8111-111111111111';
const OPP_B = '22222222-2222-4222-8222-222222222222';

function park(opportunityId: string): ParkedNegotiation {
  return { opportunityId, kind: 'mid_flight', dimension: 'Timing', transcript: [], parkedAt: new Date(1000) };
}

const NEEDS_INPUT: IntentAgentInboxEvent = {
  kind: 'negotiation_needs_input',
  userId: 'user-1',
  intentId: 'intent-1',
  opportunityId: OPP_A,
  taskId: 'task-1',
};

const USER_MESSAGE: IntentAgentInboxEvent = {
  kind: 'user_message',
  userId: 'user-1',
  intentId: 'intent-1',
  sessionId: 'session-1',
  messageId: 'reply-1',
  text: 'Q4 works.',
};

function context(overrides: Partial<IntentAgentTurnContext> = {}): IntentAgentTurnContext {
  return {
    event: NEEDS_INPUT,
    signalText: 'Find a manufacturing partner',
    parked: [park(OPP_A), park(OPP_B)],
    dossier: [
      { id: 'entry-1', text: 'Timing: Q4 works.', source: 'user_message', createdAt: new Date(2000) },
    ],
    recentDm: [],
    recentActs: [],
    ...overrides,
  };
}

/** A turn whose model round trips are scripted; counts the calls it makes. */
class ScriptedModelTurn extends IntentAgentTurn {
  calls = 0;
  constructor(private readonly outputs: unknown[]) {
    super({ model: 'test-model' });
  }
  protected override async callModel(): Promise<unknown> {
    const output = this.outputs[this.calls];
    this.calls += 1;
    if (output instanceof Error) throw output;
    return output;
  }
}

describe('IntentAgentTurn.decide', () => {
  it('maps list numbers onto ids — the model never sees or emits one', async () => {
    const turn = new ScriptedModelTurn([{
      acts: [
        { act: 'answer_negotiation', negotiation: 2, answer: 'Q4 works.' },
        { act: 'retire_dossier', entry: 1 },
        { act: 'message_user', text: 'Sent your timing back to that conversation.' },
      ],
    }]);
    const decided = await turn.decide(context());
    expect(decided).toEqual([
      { tool: 'answer_negotiation', opportunityId: OPP_B, answer: 'Q4 works.' },
      { tool: 'retire_dossier', entryId: 'entry-1' },
      { tool: 'message_user', text: 'Sent your timing back to that conversation.' },
    ]);
    expect(turn.calls).toBe(1);
  });

  it('rejects a negotiation number outside the waiting list — retry once, then throw', async () => {
    const turn = new ScriptedModelTurn([
      { acts: [{ act: 'answer_negotiation', negotiation: 3, answer: 'Yes.' }] },
      { acts: [{ act: 'answer_negotiation', negotiation: 9, answer: 'Yes.' }] },
    ]);
    await expect(turn.decide(context())).rejects.toThrow('no valid act list');
    expect(turn.calls).toBe(2);
  });

  it('rejects a dossier number outside the list and a duplicate negotiation', async () => {
    const badEntry = new ScriptedModelTurn([
      { acts: [{ act: 'retire_dossier', entry: 2 }] },
      { acts: [{ act: 'retire_dossier', entry: 2 }] },
    ]);
    await expect(badEntry.decide(context())).rejects.toThrow();

    const duplicate = new ScriptedModelTurn([
      {
        acts: [
          { act: 'answer_negotiation', negotiation: 1, answer: 'Yes.' },
          { act: 'answer_negotiation', negotiation: 1, answer: 'No.' },
        ],
      },
      { acts: [{ act: 'wait' }] },
    ]);
    // The duplicate round trip is rejected; the retry's wait is accepted.
    expect(await duplicate.decide(context())).toEqual([{ tool: 'wait' }]);
  });

  it('wait cannot coexist with doing something', async () => {
    const turn = new ScriptedModelTurn([
      { acts: [{ act: 'wait' }, { act: 'message_user', text: 'Also this.' }] },
      { acts: [{ act: 'wait', reason: 'The park resolved on its own.' }] },
    ]);
    expect(await turn.decide(context())).toEqual([{ tool: 'wait', reason: 'The park resolved on its own.' }]);
  });

  it('refuses prose that trips the identifier-leak gate', async () => {
    const turn = new ScriptedModelTurn([
      { acts: [{ act: 'message_user', text: `The opportunity_id is ${OPP_A}.` }] },
      { acts: [{ act: 'message_user', text: 'One conversation needs your timing.' }] },
    ]);
    expect(await turn.decide(context())).toEqual([
      { tool: 'message_user', text: 'One conversation needs your timing.' },
    ]);
  });

  it('a model outage propagates — the inbox retry owns recovery, never a guess', async () => {
    const turn = new ScriptedModelTurn([new Error('provider down')]);
    await expect(turn.decide(context())).rejects.toThrow('provider down');
  });
});

interface HostHarness {
  deps: IntentAgentHostDeps;
  ledgered: Array<Record<string, unknown>>;
  delivered: string[];
  order: string[];
}

function hostDeps(overrides: Partial<IntentAgentHostDeps> = {}): HostHarness {
  const ledgered: Array<Record<string, unknown>> = [];
  const delivered: string[] = [];
  const order: string[] = [];
  const deps: IntentAgentHostDeps = {
    chatSessions: {
      resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-1' } }),
      addMessage: async ({ content }) => {
        delivered.push(content);
        order.push('message');
        return `message-${delivered.length}`;
      },
    },
    dossier: {
      addEntry: async () => {
        order.push('dossier');
        return 'entry-new';
      },
      retireEntry: async () => true,
    },
    ledger: {
      append: async ({ act }) => {
        ledgered.push(act);
        order.push('ledger');
        return `ledger-${ledgered.length}`;
      },
    },
    answerPorts: {
      database: {
        getNegotiationTaskForOpportunity: async () => {
          order.push('spine');
          return null; // classifies as no_negotiation — the spine's own honesty
        },
        getNegotiationMessages: async () => [],
      },
      settleInflightAnswer: async () => 'settled',
      enqueueInflightResume: async () => {},
      recordOpportunityAnswer: async () => {},
      enqueueStalledRetry: async () => {},
    },
    ...overrides,
  };
  return { deps, ledgered, delivered, order };
}

describe('executeIntentAgentActs', () => {
  it('executes exactly what was decided — nothing fires without an act, and every act is ledgered', async () => {
    const harness = hostDeps();
    const result = await executeIntentAgentActs(NEEDS_INPUT, [
      { tool: 'note_dossier', text: 'Prefers EU manufacturing.' },
      { tool: 'message_user', text: 'Noted your preference.' },
    ], harness.deps);
    expect(result.acts.map((act) => act.tool)).toEqual(['note_dossier', 'message_user']);
    expect(harness.ledgered.map((act) => act.tool)).toEqual(['note_dossier', 'message_user']);
    expect(harness.delivered).toEqual(['Noted your preference.']);
  });

  it('wait is ledgered — silence is auditable', async () => {
    const harness = hostDeps();
    const result = await executeIntentAgentActs(NEEDS_INPUT, [
      { tool: 'wait', reason: 'The dossier already covers it and nothing is unanswered.' },
    ], harness.deps);
    expect(result.acts).toEqual([{ tool: 'wait', reason: 'The dossier already covers it and nothing is unanswered.' }]);
    expect(harness.ledgered).toEqual([{ tool: 'wait', reason: 'The dossier already covers it and nothing is unanswered.' }]);
    expect(harness.delivered).toEqual([]);
  });

  it('the boundary is structural: the dossier entry is written before the spine hears the answer', async () => {
    const harness = hostDeps();
    await executeIntentAgentActs(USER_MESSAGE, [
      { tool: 'answer_negotiation', opportunityId: OPP_A, answer: 'Q4 works.' },
    ], harness.deps);
    expect(harness.order.indexOf('dossier')).toBeLessThan(harness.order.indexOf('spine'));
  });

  it('an unresumable answer appends the fixed honest copy — proposal offered, never performed', async () => {
    const harness = hostDeps();
    harness.deps.answerPorts = {
      ...harness.deps.answerPorts!,
      database: {
        getNegotiationTaskForOpportunity: async () => ({ id: 'task-1', state: 'input_required', metadata: {
          turnContext: { askUserBinding: {
            settlementId: 'negotiation-question-settlement-v1-task-1',
            recipientUserId: 'user-1',
            recipientIntentId: 'intent-1',
            networkId: 'network-1',
            opportunityId: OPP_A,
          } },
        } }),
        getNegotiationMessages: async () => [],
      },
      settleInflightAnswer: async () => 'recorded_unresumable',
    };
    const result = await executeIntentAgentActs(USER_MESSAGE, [
      { tool: 'answer_negotiation', opportunityId: OPP_A, answer: 'Q4 works.' },
    ], harness.deps);
    expect(result.acts[0]).toMatchObject({ tool: 'answer_negotiation', outcome: 'recorded_unresumable' });
    expect(result.messages).toEqual([INTENT_AGENT_UNRESUMABLE_MESSAGE]);
    expect(harness.delivered).toEqual([INTENT_AGENT_UNRESUMABLE_MESSAGE]);
  });

  it('rule 8 backstop: a client message that produced no reply gets the fixed copy, unledgered', async () => {
    const harness = hostDeps();
    const result = await executeIntentAgentActs(USER_MESSAGE, [
      { tool: 'note_dossier', text: 'Prefers EU manufacturing.' },
    ], harness.deps);
    expect(result.messages).toEqual([INTENT_AGENT_SILENT_TURN_REPLY]);
    // The backstop is the executor's copy, not an agent act — only the
    // decided act is on the ledger.
    expect(harness.ledgered.map((act) => act.tool)).toEqual(['note_dossier']);
  });

  it('a needs_input turn with no message stays silent — the backstop is for a client who spoke', async () => {
    const harness = hostDeps();
    const result = await executeIntentAgentActs(NEEDS_INPUT, [
      { tool: 'answer_negotiation', opportunityId: OPP_A, answer: 'Q4 works.' },
    ], harness.deps);
    expect(result.messages).toEqual([]);
    expect(harness.delivered).toEqual([]);
  });
});
