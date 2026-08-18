/**
 * Exhaustion evaluator (conversational questions): committed opportunity
 * status transitions re-check both sides' question-messages against the
 * parked set and enqueue the singleton regeneration job where needed. Deps
 * are injected — no database, Redis, or model is touched. The composition
 * tests drive the REAL QuestionMessageQueue job off the evaluator's enqueue
 * to prove the two plan moments fall out with no special-case code:
 * unpark-prune (a withdrawn counterparty's question drops from the message)
 * and the own-intent exhaustion regroup (the last transition re-authors the
 * whole parked set into one grouped message, in place).
 */
import { describe, expect, it } from 'bun:test';

import { parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { OpportunityStatus, QuestionBlockQuestion } from '@indexnetwork/protocol';

import { QUESTION_TRANSITION_STATUSES, evaluateOpportunityTransition, resolveOpportunitySides } from '../question-exhaustion.evaluator';
import type { OpportunitySide, QuestionExhaustionEvaluatorDeps } from '../question-exhaustion.evaluator';
import { QuestionMessageQueue } from '../../../queues/question-message.queue';
import type { ParkedNegotiation } from '../../../adapters/parked-negotiation.reader.adapter';

const USER_ID = 'user-a';
const INTENT_ID = 'intent-a';
const COUNTERPARTY_USER_ID = 'user-b';
const COUNTERPARTY_INTENT_ID = 'intent-b';

const OPP_A = '11111111-1111-4111-8111-111111111111';
const OPP_B = '22222222-2222-4222-8222-222222222222';
const OPP_C = '33333333-3333-4333-8333-333333333333';

const BOTH_SIDES_ACTORS = [
  { userId: USER_ID, intent: INTENT_ID, role: 'peer' },
  { userId: COUNTERPARTY_USER_ID, intent: COUNTERPARTY_INTENT_ID, role: 'peer' },
];

function parkedNegotiation(opportunityId: string, index: number): ParkedNegotiation {
  return {
    opportunityId,
    kind: 'post_stall',
    reason: 'unresolved_owner_constraint',
    question: {
      title: 'Timing',
      prompt: `Park-time question ${index}?`,
      options: [
        { label: 'Yes', description: 'The negotiation resumes with a yes.' },
        { label: 'No', description: 'The negotiation resumes with a no.' },
      ],
    },
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
    enqueueRegeneration: options.enqueue ?? (async (data) => { enqueued.push(data); }),
    getIntentOpportunityStatuses: async (userId, intentId) => {
      statusReads.push({ userId, intentId });
      return options.statuses ?? [];
    },
  };
  return { deps, enqueued, parkedReads, newestReads, statusReads };
}

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
      const harness = buildEvaluatorDeps({ parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_A, 1)] } });
      await evaluateOpportunityTransition({ opportunityId: OPP_A, status }, harness.deps);
      expect(harness.parkedReads).toHaveLength(0);
      expect(harness.enqueued).toHaveLength(0);
    }
    expect([...QUESTION_TRANSITION_STATUSES].sort()).toEqual(['accepted', 'expired', 'pending', 'rejected', 'stalled']);
  });

  it('no-op guard: a transition on sides with no open message and no parks enqueues nothing', async () => {
    const harness = buildEvaluatorDeps({});
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    // Both sides were checked (parked set, then the DM), and neither enqueued.
    expect(harness.parkedReads).toHaveLength(2);
    expect(harness.newestReads).toHaveLength(2);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('enqueues for each side independently, keyed by that side own parked set', async () => {
    const harness = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_B, 1)] },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'accepted' }, harness.deps);
    expect(harness.enqueued).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });

  it('an open question-message alone (empty parked set) still triggers the regeneration', async () => {
    const body = serializeQuestionMessage('One question.', {
      version: 1,
      questions: [questionFor(OPP_A, 'Still relevant?')],
    });
    const harness = buildEvaluatorDeps({
      newestBySide: { [`${USER_ID}:${INTENT_ID}`]: { role: 'assistant', content: body } },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'expired' }, harness.deps);
    expect(harness.enqueued).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });

  it('a newest message that is user-authored or plain prose is not an open question-message', async () => {
    const harness = buildEvaluatorDeps({
      newestBySide: {
        [`${USER_ID}:${INTENT_ID}`]: { role: 'user', content: 'thanks!' },
        [`${COUNTERPARTY_USER_ID}:${COUNTERPARTY_INTENT_ID}`]: { role: 'assistant', content: 'Plain prose, no block.' },
      },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('reads the exhaustion predicate input only after an enqueue', async () => {
    const withPark = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_B, 1)] },
      statuses: ['stalled', 'accepted'],
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'accepted' }, withPark.deps);
    expect(withPark.statusReads).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);

    const noop = buildEvaluatorDeps({});
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'accepted' }, noop.deps);
    expect(noop.statusReads).toHaveLength(0);
  });

  it('a missing opportunity resolves without enqueuing', async () => {
    const harness = buildEvaluatorDeps({ actors: null });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'rejected' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });

  it('an enqueue failure never throws out of the evaluator', async () => {
    const harness = buildEvaluatorDeps({
      parkedBySide: {
        [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_A, 1)],
        [`${COUNTERPARTY_USER_ID}:${COUNTERPARTY_INTENT_ID}`]: [parkedNegotiation(OPP_A, 2)],
      },
      enqueue: async () => { throw new Error('redis unavailable'); },
    });
    await expect(
      evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'stalled' }, harness.deps),
    ).resolves.toBeUndefined();
  });

  // Ported from the run-existing continuation re-park stopgap this evaluator
  // subsumes: a continuation that resumed from a client's answer and re-parked
  // post-stall finalizes with status 'stalled'; the transition must enqueue
  // the regeneration for the re-parked side's scope.
  it('continuation re-park: a stalled transition with a post-stall park enqueues for the parked side', async () => {
    const harness = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_A, 1)] },
    });
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'stalled' }, harness.deps);
    expect(harness.enqueued).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });

  it('continuation terminal re-stall: no gap authored, no open message, nothing enqueued', async () => {
    const harness = buildEvaluatorDeps({});
    await evaluateOpportunityTransition({ opportunityId: OPP_A, status: 'stalled' }, harness.deps);
    expect(harness.enqueued).toHaveLength(0);
  });
});

/**
 * Composition: the evaluator's enqueue drives the real regeneration job
 * (deps-injected, serialized path), proving the plan's two moments need no
 * bespoke code beyond the trigger.
 */
describe('evaluator → regeneration job composition', () => {
  function buildJob(options: {
    parked: ParkedNegotiation[];
    authoredQuestions: QuestionBlockQuestion[];
    newestMessage: { id: string; role: 'user' | 'assistant' | 'system'; content: string } | null;
  }) {
    const delivered: Array<{ sessionId: string; role: string; content: string }> = [];
    const updated: Array<{ messageId: string; content: string }> = [];
    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => options.parked },
      clientDm: async () => [],
      getIntentText: async () => 'A signal about finding a technical co-founder',
      author: {
        author: async () => ({
          prose: 'Where things stand, and what I need from you.',
          questions: options.authoredQuestions,
        }),
      },
      chatSessions: {
        resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-1' } }),
        findNegotiatorIntentSession: async () => ({ id: 'session-1' }),
        addMessage: async (params) => {
          delivered.push(params);
          return `message-${delivered.length}`;
        },
        getNewestMessage: async () => options.newestMessage,
        updateQuestionMessageInPlace: async (params) => {
          updated.push({ messageId: params.messageId, content: params.content });
          return true;
        },
      },
      publishRegenerationEvent: async () => {},
      notify: async () => {},
    });
    return { queue, delivered, updated };
  }

  it('unpark-prune: a withdrawn counterparty question drops from the open message in place', async () => {
    // Open message asks about A and B; B's counterparty withdraws (finalize
    // wrote 'rejected'), so B is no longer parked. The evaluator fires off the
    // transition and the regeneration re-renders the message from the parked
    // set — A survives, B is gone.
    const openBody = serializeQuestionMessage('Two things block your matches.', {
      version: 1,
      questions: [questionFor(OPP_A, 'Question about A?'), questionFor(OPP_B, 'Question about B?')],
    });
    const job = buildJob({
      parked: [parkedNegotiation(OPP_A, 1)],
      authoredQuestions: [questionFor(OPP_A, 'Question about A?')],
      newestMessage: { id: 'message-open', role: 'assistant', content: openBody },
    });
    const harness = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: [parkedNegotiation(OPP_A, 1)] },
      enqueue: (data) => job.queue.processJob('regenerate_question_message', data),
    });

    await evaluateOpportunityTransition({ opportunityId: OPP_B, status: 'rejected' }, harness.deps);

    expect(job.delivered).toHaveLength(0);
    expect(job.updated).toHaveLength(1);
    const block = parseQuestionMessage(job.updated[0].content);
    expect(block?.block.questions.map((question) => question.opportunityId)).toEqual([OPP_A]);
  });

  it('exhaustion regroup: the last concluding negotiation re-authors the whole parked set into one grouped message', async () => {
    // Two parks were messaged individually (a user reply between them split
    // the thread, so the open message carries only B). The last ongoing
    // negotiation C concludes with accept → 'pending'; the evaluator fires and
    // the regeneration regroups A and B into the one open message, in place.
    const openBody = serializeQuestionMessage('One more question.', {
      version: 1,
      questions: [questionFor(OPP_B, 'Question about B?')],
    });
    const parked = [parkedNegotiation(OPP_A, 1), parkedNegotiation(OPP_B, 2)];
    const job = buildJob({
      parked,
      authoredQuestions: [questionFor(OPP_A, 'Question about A?'), questionFor(OPP_B, 'Question about B?')],
      newestMessage: { id: 'message-open', role: 'assistant', content: openBody },
    });
    const harness = buildEvaluatorDeps({
      parkedBySide: { [`${USER_ID}:${INTENT_ID}`]: parked },
      statuses: ['pending', 'stalled', 'stalled'],
      enqueue: (data) => job.queue.processJob('regenerate_question_message', data),
    });

    await evaluateOpportunityTransition({ opportunityId: OPP_C, status: 'pending' }, harness.deps);

    // One grouped message, updated in place — nothing appended.
    expect(job.delivered).toHaveLength(0);
    expect(job.updated).toHaveLength(1);
    const block = parseQuestionMessage(job.updated[0].content);
    expect(block?.block.questions.map((question) => question.opportunityId)).toEqual([OPP_A, OPP_B]);
    // And the side's statuses satisfy the named exhaustion predicate.
    expect(harness.statusReads).toEqual([{ userId: USER_ID, intentId: INTENT_ID }]);
  });
});
