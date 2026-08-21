/**
 * Exhaustion evaluator — since the intent-agent collapse
 * (docs/plans/2026-08-21-holistic-intent-agent.md), the transition trigger
 * for the LEGACY close-out only: authoring is retired, so a committed
 * opportunity status transition enqueues the singleton close-out job for
 * each side whose DM still shows a question-message. Deps are injected — no
 * database, Redis, or model is touched. The composition test drives the REAL
 * QuestionMessageQueue job off the evaluator's enqueue.
 */
import { describe, expect, it } from 'bun:test';

import { parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { OpportunityStatus, QuestionBlockQuestion } from '@indexnetwork/protocol';

import { QUESTION_TRANSITION_STATUSES, evaluateOpportunityTransition, resolveOpportunitySides } from '../question-exhaustion.evaluator';
import type { OpportunitySide, QuestionExhaustionEvaluatorDeps } from '../question-exhaustion.evaluator';
import { QUESTION_MESSAGE_CLOSED_BODY, QuestionMessageQueue } from '../../../queues/question-message.queue';
import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';

const USER_ID = 'user-a';
const INTENT_ID = 'intent-a';
const COUNTERPARTY_USER_ID = 'user-b';
const COUNTERPARTY_INTENT_ID = 'intent-b';

const OPP_A = '11111111-1111-4111-8111-111111111111';
const OPP_B = '22222222-2222-4222-8222-222222222222';

const BOTH_SIDES_ACTORS = [
  { userId: USER_ID, intent: INTENT_ID, role: 'peer' },
  { userId: COUNTERPARTY_USER_ID, intent: COUNTERPARTY_INTENT_ID, role: 'peer' },
];

function parkedNegotiation(opportunityId: string, index: number): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'post_stall',
    reason: 'unresolved_owner_constraint',
    transcript: [
      { action: 'propose', reasoning: 'Opening terms.' },
      { action: 'ask_user', reasoning: 'Paused for the client.' },
    ],
    parkedAt: new Date(1000 + index),
  };
}

function questionFor(opportunityId: string, prompt: string): QuestionBlockQuestion {
  return { prompt, opportunityId };
}

interface EvaluatorHarness {
  deps: QuestionExhaustionEvaluatorDeps;
  enqueued: OpportunitySide[];
  parkedReads: OpportunitySide[];
  newestReads: OpportunitySide[];
  statusReads: OpportunitySide[];
}

function buildEvaluatorDeps(options: {
  actors?: ReadonlyArray<{ userId?: unknown; intent?: unknown; role?: unknown }> | null;
  /** Parked set per `${userId}:${intentId}`; absent key → empty. */
  parkedBySide?: Record<string, ParkedNegotiation[]>;
  /** Newest DM message per `${userId}:${intentId}`; absent key → empty DM. */
  newestBySide?: Record<string, { role: string; content: string } | null>;
  statuses?: OpportunityStatus[];
  enqueue?: (data: OpportunitySide) => Promise<unknown>;
}): EvaluatorHarness {
  const enqueued: OpportunitySide[] = [];
  const parkedReads: OpportunitySide[] = [];
  const newestReads: OpportunitySide[] = [];
  const statusReads: OpportunitySide[] = [];
  const deps: QuestionExhaustionEvaluatorDeps = {
    getOpportunityActors: async () => options.actors ?? BOTH_SIDES_ACTORS,
    readParkedNegotiations: async (userId, intentId) => {
      parkedReads.push({ userId, intentId });
      return options.parkedBySide?.[`${userId}:${intentId}`] ?? [];
    },
    getNewestNegotiatorIntentMessage: async (userId, intentId) => {
      newestReads.push({ userId, intentId });
      return options.newestBySide?.[`${userId}:${intentId}`] ?? null;
    },
    enqueueCloseOut: options.enqueue ?? (async (data) => { enqueued.push(data); }),
    getIntentOpportunityStatuses: async (userId, intentId) => {
      statusReads.push({ userId, intentId });
      return options.statuses ?? [];
    },
  };
  return { deps, enqueued, parkedReads, newestReads, statusReads };
}

const OPEN_BODY = serializeQuestionMessage('One question.', {
  version: 1,
  questions: [questionFor(OPP_A, 'Still relevant?')],
});

describe('resolveOpportunitySides', () => {
  it('returns both non-introducer sides and excludes the introducer', () => {
    const sides = resolveOpportunitySides([
      ...BOTH_SIDES_ACTORS,
      { userId: 'user-i', role: 'introducer' },
    ]);
    expect(sides).toEqual([
      { userId: USER_ID, intentId: INTENT_ID },
      { userId: COUNTERPARTY_USER_ID, intentId: COUNTERPARTY_INTENT_ID },
    ]);
  });

  it('skips actors with junk or missing intents and deduplicates repeated pairs', () => {
    const sides = resolveOpportunitySides([
      { userId: USER_ID, intent: INTENT_ID, role: 'peer' },
      { userId: USER_ID, intent: INTENT_ID, role: 'peer' },
      { userId: COUNTERPARTY_USER_ID, intent: '  ', role: 'peer' },
      { userId: COUNTERPARTY_USER_ID, intent: 'null', role: 'peer' },
      { userId: COUNTERPARTY_USER_ID, role: 'peer' },
      { intent: INTENT_ID, role: 'peer' },
    ]);
    expect(sides).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });
});

describe('evaluateOpportunityTransition', () => {
  it('ignores start and rollback statuses without reading anything', async () => {
    for (const status of ['latent', 'draft', 'negotiating']) {
      const harness = buildEvaluatorDeps({ newestBySide: { [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY } } });
      await evaluateOpportunityTransition({ opportunityId: OPP_A, status }, harness.deps);
      expect(harness.newestReads).toHaveLength(0);
      expect(harness.enqueued).toHaveLength(0);
    }
    expect([...QUESTION_TRANSITION_STATUSES].sort()).toEqual(['accepted', 'expired', 'pending', 'rejected', 'stalled']);
  });

  it('no-op guard: sides with no question-message in the DM enqueue nothing', async () => {
    const harness = buildEvaluatorDeps({});
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    expect(harness.newestReads).toHaveLength(2);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('a parked set alone no longer triggers anything — authoring is retired; the park went to the agent', async () => {
    const harness = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_B, 1)] },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'accepted' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('a legacy open question-message triggers the close-out check for its side', async () => {
    const harness = buildEvaluatorDeps({
      newestBySide: { [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY } },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'expired' }, harness.deps);
    expect(harness.enqueued).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });

  it('a newest message that is user-authored or plain prose is not a question-message', async () => {
    const harness = buildEvaluatorDeps({
      newestBySide: {
        [`${USER_ID}:${INTENT_ID}`]: { role: 'user', content: 'thanks!' },
        [`${COUNTERPARTY_USER_ID}:${COUNTERPARTY_INTENT_ID}`]: { role: 'assistant', content: 'Plain prose, no block.' },
      },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('a missing opportunity resolves without enqueuing', async () => {
    const harness = buildEvaluatorDeps({ actors: null });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('an enqueue failure never throws out of the evaluator', async () => {
    const harness = buildEvaluatorDeps({
      newestBySide: {
        [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY },
        [`${COUNTERPARTY_USER_ID}:${COUNTERPARTY_INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY },
      },
      enqueue: async () => { throw new Error('redis unavailable'); },
    });
    await expect(
      evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'stalled' }, harness.deps),
    ).resolves.toBeUndefined();
  });
});

/**
 * Composition: the evaluator's enqueue drives the real close-out job
 * (deps-injected, serialized path).
 */
describe('evaluator → close-out job composition', () => {
  function buildJob(options: {
    parked: ParkedNegotiation[];
    newestMessage: { id: string; role: 'user' | 'assistant' | 'system'; content: string } | null;
  }) {
    const updated: Array<{ messageId: string; content: string }> = [];
    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => options.parked },
      chatSessions: {
        findNegotiatorIntentSession: async () => ({ id: 'session-1' }),
        getNewestMessage: async () => options.newestMessage,
        updateQuestionMessageInPlace: async (params) => {
          updated.push({ messageId: params.messageId, content: params.content });
          return true;
        },
      },
    });
    return { queue, updated };
  }

  it('an emptied parked set closes out the legacy open message in place', async () => {
    const job = buildJob({
      parked: [],
      newestMessage: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
    });
    const harness = buildEvaluatorDeps({
      newestBySide: { [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY } },
      enqueue: (data) => job.queue.processJob('close_out_question_message', data),
    });

    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);

    expect(job.updated).toHaveLength(1);
    expect(job.updated[0].content).toBe(QUESTION_MESSAGE_CLOSED_BODY);
    expect(parseQuestionMessage(job.updated[0].content)).toBeNull();
  });

  it('a still-parked side leaves the legacy message alone', async () => {
    const job = buildJob({
      parked: [parkedNegotiation(OPP_B, 1)],
      newestMessage: { id: 'message-open', role: 'assistant', content: OPEN_BODY },
    });
    const harness = buildEvaluatorDeps({
      newestBySide: { [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: OPEN_BODY } },
      enqueue: (data) => job.queue.processJob('close_out_question_message', data),
    });

    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'stalled' }, harness.deps);

    expect(job.updated).toHaveLength(0);
  });
});
