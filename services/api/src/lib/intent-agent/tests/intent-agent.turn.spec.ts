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
import { INTENT_AGENT_REPLY_FALLBACK, INTENT_AGENT_UNRESUMABLE_MESSAGE, executeIntentAgentActs, runIntentAgentTurn } from '../intent-agent.host';
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
    opportunities: [
      { position: 1, opportunityId: OPP_A, name: 'Camille Dubois', status: 'stalled', label: 'Camille Dubois — parked, waiting on you' },
      { position: 2, opportunityId: OPP_B, name: 'Ilya Roth', status: 'pending', label: 'Ilya Roth — waiting on your decision' },
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

/** A turn whose reply-stage round trips are scripted. */
class ScriptedReplyTurn extends IntentAgentTurn {
  replyCalls = 0;
  constructor(private readonly replies: Array<string | { reply: string; options?: unknown }>) {
    super({ model: 'test-model' });
  }
  protected override async callReplyModel(): Promise<unknown> {
    const output = this.replies[this.replyCalls];
    this.replyCalls += 1;
    return typeof output === 'string' ? { reply: output } : output ?? { reply: '' };
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

  it('an acts-stage message_user is refused for a client-message turn — the reply stage speaks there', async () => {
    // Phase 2 (full chat ownership): the client's reply is the streaming
    // reply stage's; an acts-stage message would double-speak.
    const turn = new ScriptedModelTurn([
      { acts: [{ act: 'message_user', text: 'Right away.' }] },
      { acts: [{ act: 'wait', reason: 'Nothing to execute; the reply handles it.' }] },
    ]);
    expect(await turn.decide(context({ event: USER_MESSAGE }))).toEqual([
      { tool: 'wait', reason: 'Nothing to execute; the reply handles it.' },
    ]);
  });

  it('maps a verdict number onto the matches list — and refuses one outside it or doubled', async () => {
    const turn = new ScriptedModelTurn([{
      acts: [{ act: 'reject_opportunity', opportunity: 2, reason: 'Client said reject the second one.' }],
    }]);
    expect(await turn.decide(context({ event: USER_MESSAGE }))).toEqual([
      { tool: 'reject_opportunity', opportunityId: OPP_B, reason: 'Client said reject the second one.' },
    ]);

    const outside = new ScriptedModelTurn([
      { acts: [{ act: 'accept_opportunity', opportunity: 3 }] },
      { acts: [{ act: 'accept_opportunity', opportunity: 9 }] },
    ]);
    await expect(outside.decide(context({ event: USER_MESSAGE }))).rejects.toThrow('no valid act list');

    const doubled = new ScriptedModelTurn([
      { acts: [{ act: 'accept_opportunity', opportunity: 1 }, { act: 'reject_opportunity', opportunity: 1 }] },
      { acts: [{ act: 'wait' }] },
    ]);
    expect(await doubled.decide(context({ event: USER_MESSAGE }))).toEqual([{ tool: 'wait' }]);
  });

  it('a verdict act without a client message behind it is structurally impossible', async () => {
    // A background event carries no client word, so no verdict can exist —
    // the explicitness of the word itself is the prompt's law, pinned in the
    // live eval (there is no code fence for judgment).
    const turn = new ScriptedModelTurn([
      { acts: [{ act: 'reject_opportunity', opportunity: 1 }] },
      { acts: [{ act: 'reject_opportunity', opportunity: 2 }] },
    ]);
    await expect(turn.decide(context())).rejects.toThrow('no valid act list');
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

  // The rule-8 silent-turn backstop left with phase 2: a client message is
  // always followed by the reply stage (see the runIntentAgentTurn suite
  // below), which owns the never-silent guarantee now.
  it('a verdict act executes through the injected #1471 lane and ledgers the outcome verbatim', async () => {
    const harness = hostDeps();
    const passed: Array<{ input: Record<string, unknown>; target: string }> = [];
    harness.deps.verdict = async (_userId, input, target) => {
      passed.push({ input, target });
      return { status: 'executed', counterparty: 'Ilya Roth' };
    };
    const result = await executeIntentAgentActs(USER_MESSAGE, [
      { tool: 'reject_opportunity', opportunityId: OPP_B, reason: 'reject the second one' },
    ], harness.deps);
    expect(passed).toEqual([{
      input: { intentId: 'intent-1', opportunityId: OPP_B, reason: 'reject the second one' },
      target: 'rejected',
    }]);
    expect(result.acts).toEqual([{
      tool: 'reject_opportunity',
      opportunityId: OPP_B,
      outcome: 'executed',
      counterparty: 'Ilya Roth',
      reason: 'reject the second one',
    }]);
    expect(harness.ledgered.map((act) => act.tool)).toEqual(['reject_opportunity']);
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

describe('IntentAgentTurn.reply', () => {
  it('returns checked prose — an identifier leak is retried once, then refused', async () => {
    const leaky = new ScriptedReplyTurn([
      `Your opportunity_id is ${OPP_A}.`,
      'Sent your timing along; one match is waiting on your decision.',
    ]);
    expect(await leaky.reply(context({ event: USER_MESSAGE }), [])).toEqual({
      text: 'Sent your timing along; one match is waiting on your decision.',
    });
    expect(leaky.replyCalls).toBe(2);

    const hopeless = new ScriptedReplyTurn([
      `The opportunity_id is ${OPP_A}.`,
      `Still the opportunity_id: ${OPP_B}.`,
    ]);
    expect(await hopeless.reply(context({ event: USER_MESSAGE }), [])).toBeNull();
    expect(hopeless.replyCalls).toBe(2);
  });

  it('an empty reply counts as refused prose, not a message', async () => {
    const empty = new ScriptedReplyTurn(['', '   ']);
    expect(await empty.reply(context({ event: USER_MESSAGE }), [])).toBeNull();
  });

  it('carries the reply\'s canned replies through, normalized', async () => {
    const asking = new ScriptedReplyTurn([{
      reply: 'Which of these should I push hardest on?',
      options: ['  Hiring speed  ', 'hiring speed', 'Comp banding', '', 'Team shape', 'A fourth one too', 'Cut me'],
    }]);
    expect(await asking.reply(context({ event: USER_MESSAGE }), [])).toEqual({
      text: 'Which of these should I push hardest on?',
      options: ['Hiring speed', 'Comp banding', 'Team shape', 'A fourth one too'],
    });
  });

  it('drops a chip set too thin to be a choice — the prose still stands', async () => {
    const thin = new ScriptedReplyTurn([{ reply: 'How soon do you want to start?', options: ['Q4'] }]);
    expect(await thin.reply(context({ event: USER_MESSAGE }), [])).toEqual({
      text: 'How soon do you want to start?',
    });
  });

  /** Captures the exact prompt handed to the reply model, instead of scripting its output. */
  class CapturingReplyTurn extends IntentAgentTurn {
    lastUserMessage = '';
    constructor(private readonly replyText: string) {
      super({ model: 'test-model' });
    }
    protected override async callReplyModel(messages: Array<{ role: string; content: string }>): Promise<unknown> {
      this.lastUserMessage = messages[1]!.content;
      return { reply: this.replyText };
    }
  }

  it('tells the reply stage the truth when the only act this turn was waiting on a client message', async () => {
    // Seen in dev: a client's message that read as an answer, judged `wait`
    // because it did not resolve any waiting negotiation, was then narrated
    // by the reply stage as "I've reached out to get more specific details" —
    // nothing was sent. The prompt must say so in plain words.
    const turn = new CapturingReplyTurn('Noted — nothing to report yet.');
    await turn.reply(context({ event: USER_MESSAGE }), [{ tool: 'wait', reason: 'does not resolve a waiting negotiation' }]);
    expect(turn.lastUserMessage).toContain('You sent NOTHING, contacted NO ONE, and moved NO negotiation forward');
  });

  it('does not add the wait notice for a background event or when other acts executed', async () => {
    const onBackground = new CapturingReplyTurn('ok');
    await onBackground.reply(context({ event: NEEDS_INPUT }), [{ tool: 'wait' }]);
    expect(onBackground.lastUserMessage).not.toContain('You sent NOTHING');

    const withOtherAct = new CapturingReplyTurn('ok');
    await withOtherAct.reply(context({ event: USER_MESSAGE }), [
      { tool: 'wait' },
      { tool: 'note_dossier', text: 'noted', entryId: 'entry-2' },
    ]);
    expect(withOtherAct.lastUserMessage).not.toContain('You sent NOTHING');
  });
});

/**
 * The reply stage in the loop: a client-message turn always ends with a
 * delivered reply — checked model prose when possible, the fixed fallback
 * copy (failure ledgered) when not — and its chunks are published only after
 * delivery (check-then-stream). Background events skip the stage entirely.
 */
describe('runIntentAgentTurn reply stage', () => {
  function loopDeps(overrides: {
    reply?: (context: IntentAgentTurnContext) => Promise<string | null>;
    withReplySeam?: boolean;
  } = {}) {
    const harness = hostDeps();
    const published: Array<{ messageId: string; seq: number; content: string }> = [];
    let replyCalls = 0;
    harness.deps.context = {
      readParkedNegotiations: async () => [],
      readDossier: async () => [],
      readOpportunities: async () => [],
      readLedger: async () => [],
      findSession: async () => ({ id: 'session-1' }),
      getSessionMessages: async () => [],
      getIntentText: async () => 'Find a manufacturing partner',
    };
    harness.deps.turn = {
      decide: async () => [{ tool: 'wait' as const, reason: 'Nothing to execute.' }],
      ...(overrides.withReplySeam === false ? {} : {
        reply: async (turnContext: IntentAgentTurnContext) => {
          replyCalls += 1;
          const composed = overrides.reply ? await overrides.reply(turnContext) : 'All quiet on this signal.';
          return typeof composed === 'string' ? { text: composed } : composed;
        },
      }),
    } as never;
    harness.deps.publishReplyChunk = async (messageId, chunk) => {
      published.push({ messageId, ...chunk });
    };
    return { harness, published, replyCalls: () => replyCalls };
  }

  it('delivers the checked reply, ledgers it with its stage, and publishes chunks whose join is the delivered text', async () => {
    const { harness, published } = loopDeps({
      reply: async () => 'I sent your timing along. One match is still waiting on your decision — want my read?',
    });
    const result = await runIntentAgentTurn(USER_MESSAGE, harness.deps);

    const replyText = 'I sent your timing along. One match is still waiting on your decision — want my read?';
    expect(result.messages).toEqual([replyText]);
    expect(harness.delivered).toEqual([replyText]);
    const replyAct = harness.ledgered.find((act) => act.stage === 'reply');
    expect(replyAct).toMatchObject({ tool: 'message_user', text: replyText });
    expect(replyAct!.fallback).toBeUndefined();

    // Check-then-stream: publication happens after delivery, in order, and
    // reassembles exactly.
    expect(published.length).toBeGreaterThan(1);
    expect(published.map((chunk) => chunk.seq)).toEqual(published.map((_, index) => index + 1));
    expect(published.every((chunk) => chunk.messageId === USER_MESSAGE.messageId)).toBe(true);
    expect(published.map((chunk) => chunk.content).join('')).toBe(replyText);
  });

  it('a reply refused by the safety gate twice delivers the fixed copy and ledgers the failure', async () => {
    const { harness, published } = loopDeps({ reply: async () => null });
    const result = await runIntentAgentTurn(USER_MESSAGE, harness.deps);

    expect(result.messages).toEqual([INTENT_AGENT_REPLY_FALLBACK]);
    const replyAct = harness.ledgered.find((act) => act.stage === 'reply');
    expect(replyAct).toMatchObject({ fallback: 'safety_check_failed', text: INTENT_AGENT_REPLY_FALLBACK });
    expect(published.map((chunk) => chunk.content).join('')).toBe(INTENT_AGENT_REPLY_FALLBACK);
  });

  it('a reply-stage model failure falls back instead of retrying the whole turn — the acts already executed', async () => {
    const { harness } = loopDeps({
      reply: async () => {
        throw new Error('provider down');
      },
    });
    const result = await runIntentAgentTurn(USER_MESSAGE, harness.deps);

    expect(result.messages).toEqual([INTENT_AGENT_REPLY_FALLBACK]);
    expect(harness.ledgered.find((act) => act.stage === 'reply')).toMatchObject({ fallback: 'model_error' });
  });

  it('background events skip the reply stage — no client is waiting', async () => {
    const { harness, published, replyCalls } = loopDeps();
    const result = await runIntentAgentTurn(NEEDS_INPUT, harness.deps);

    expect(replyCalls()).toBe(0);
    expect(result.messages).toEqual([]);
    expect(published).toEqual([]);
    expect(harness.ledgered.map((act) => act.tool)).toEqual(['wait']);
  });
});
