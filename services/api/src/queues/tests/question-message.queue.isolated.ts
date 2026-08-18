/**
 * Question-message regeneration job (conversational-questions delivery
 * spine): parked set → one delivered message whose body is exactly
 * `serializeQuestionMessage(prose, block)`; empty parked set → no message.
 * Deps are injected, so no database, Redis, or model is touched. The
 * happy-path assertion reuses the contract's canonical fixture byte-for-byte,
 * pinning this job's delivery to the same wire format the web steps UI tests
 * against.
 */
import { describe, expect, it } from 'bun:test';

import { negotiationParkAnswerId, negotiationQuestionSettlementId, parseQuestionMessage } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts, QuestionerEnqueuePayload, RoutedAnswer } from '@indexnetwork/protocol';
import { questionBlockFixture, questionMessageFixture, questionProseFixture } from '@indexnetwork/protocol/question-block/fixture';

import { QUESTION_ANSWER_CLARIFICATION_MESSAGE, QuestionMessageQueue, enqueueQuestionAnswerReply, parkedQuestionMessageTarget, questionMessageJobId } from '../question-message.queue';
import type { QuestionAnswerJobData } from '../question-message.queue';
import type { ParkedNegotiation } from '../../adapters/parked-negotiation.reader.adapter';

const USER_ID = 'user-1';
const INTENT_ID = 'intent-1';

/** The three negotiation refs the contract fixture's block routes to. */
const [FIXTURE_PRIMARY_1, FIXTURE_ALSO_1] = [
  questionBlockFixture.questions[0].opportunityId,
  questionBlockFixture.questions[0].alsoUnblocks![0],
];
const FIXTURE_PRIMARY_2 = questionBlockFixture.questions[1].opportunityId;

function parkedNegotiation(opportunityId: string, index: number): ParkedNegotiation {
  return {
    opportunityId,
    kind: index === 2 ? 'post_stall' : 'mid_flight',
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

interface DeliveredMessage {
  sessionId: string;
  role: string;
  content: string;
}

function buildQueue(options: {
  parked: ParkedNegotiation[];
  authorResult?: { prose: string; questions: typeof questionBlockFixture.questions } | null;
  resolveResult?: { session: { id: string } } | { error: string; status: 400 | 403 | 404 | 500 };
}) {
  const delivered: DeliveredMessage[] = [];
  const calls = { author: 0, resolve: 0 };
  const queue = new QuestionMessageQueue({
    parkedSet: { readParkedNegotiations: async () => options.parked },
    clientDm: async () => [],
    getIntentText: async () => 'A signal about finding a technical co-founder',
    author: {
      author: async () => {
        calls.author += 1;
        return options.authorResult === undefined
          ? { prose: questionProseFixture, questions: questionBlockFixture.questions }
          : options.authorResult;
      },
    },
    chatSessions: {
      resolveNegotiatorIntentSession: async () => {
        calls.resolve += 1;
        return options.resolveResult ?? { session: { id: 'session-1' } };
      },
      addMessage: async (params) => {
        delivered.push(params);
        return `message-${delivered.length}`;
      },
    },
  });
  return { queue, delivered, calls };
}

describe('QuestionMessageQueue regeneration job', () => {
  it('renders a non-empty parked set into one DM message carrying a valid block', async () => {
    const parked = [
      parkedNegotiation(FIXTURE_PRIMARY_1, 0),
      parkedNegotiation(FIXTURE_ALSO_1, 1),
      parkedNegotiation(FIXTURE_PRIMARY_2, 2),
    ];
    const { queue, delivered } = buildQueue({ parked });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(1);
    expect(delivered[0].sessionId).toBe('session-1');
    expect(delivered[0].role).toBe('assistant');
    // Byte-for-byte the contract fixture: the delivery wire format and the
    // web client's parser fixture are the same artifact.
    expect(delivered[0].content).toBe(questionMessageFixture);

    const parsed = parseQuestionMessage(delivered[0].content);
    expect(parsed).not.toBeNull();
    expect(parsed!.prose).toBe(questionProseFixture);
    expect(parsed!.block).toEqual(questionBlockFixture);
  });

  it('does nothing on an empty parked set — no authoring, no session, no message', async () => {
    const { queue, delivered, calls } = buildQueue({ parked: [] });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(calls.author).toBe(0);
    expect(calls.resolve).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it('skips delivery when the author has nothing renderable', async () => {
    const { queue, delivered, calls } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      authorResult: null,
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(calls.resolve).toBe(0);
    expect(delivered).toHaveLength(0);
  });

  it('suppresses delivery permanently when the session scope is gone (404)', async () => {
    const { queue, delivered } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      resolveResult: { error: 'Intent not found', status: 404 },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(0);
  });

  it('throws on a transient session failure (500) so BullMQ retries', async () => {
    const { queue, delivered } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      resolveResult: { error: 'database unavailable', status: 500 },
    });

    await expect(
      queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID }),
    ).rejects.toThrow('database unavailable');
    expect(delivered).toHaveLength(0);
  });
});

describe('park-path trigger routing', () => {
  const inflightPayload: QuestionerEnqueuePayload = {
    mode: 'negotiation_inflight',
    purpose: 'inflight_consultation',
    userId: USER_ID,
    sourceType: 'opportunity',
    sourceId: FIXTURE_PRIMARY_1,
    negotiation: {
      purpose: 'inflight_consultation',
      recipientUserId: USER_ID,
      recipientIntentId: INTENT_ID,
      opportunityId: FIXTURE_PRIMARY_1,
      taskId: 'task-1',
      networkId: 'network-1',
    },
    context: {
      negotiationId: 'task-1',
      counterpartyHint: 'another member of this community',
      indexContext: 'a shared community',
      consultationPolicyReason: 'unresolved_owner_constraint',
    },
  } as QuestionerEnqueuePayload;

  it('routes mid-flight consult payloads to the parked side scope', () => {
    expect(parkedQuestionMessageTarget(inflightPayload)).toEqual({ userId: USER_ID, intentId: INTENT_ID });
  });

  it('routes post-stall follow-up payloads to the parked side scope', () => {
    const stalled = {
      ...inflightPayload,
      mode: 'negotiation',
      purpose: 'stalled_followup',
      negotiation: { ...inflightPayload.negotiation!, purpose: 'stalled_followup' },
    } as unknown as QuestionerEnqueuePayload;
    expect(parkedQuestionMessageTarget(stalled)).toEqual({ userId: USER_ID, intentId: INTENT_ID });
  });

  it('leaves every other generator payload with the questioner', () => {
    const uptake = {
      ...inflightPayload,
      mode: 'negotiation',
      purpose: 'uptake',
      negotiation: { ...inflightPayload.negotiation!, purpose: 'uptake', taskId: undefined },
    } as unknown as QuestionerEnqueuePayload;
    expect(parkedQuestionMessageTarget(uptake)).toBeNull();

    const intentMode = {
      mode: 'intent',
      userId: USER_ID,
      sourceType: 'intent',
      sourceId: INTENT_ID,
      context: { intentId: INTENT_ID, payload: 'a signal' },
    } as unknown as QuestionerEnqueuePayload;
    expect(parkedQuestionMessageTarget(intentMode)).toBeNull();
  });

  it('keys the singleton job per (user, intent) scope without colons', () => {
    expect(questionMessageJobId(USER_ID, INTENT_ID)).toBe(`question-message.${USER_ID}.${INTENT_ID}`);
    expect(questionMessageJobId(USER_ID, INTENT_ID)).not.toContain(':');
  });
});

describe('questionRegenerationPending lookup', () => {
  it('reports pending while the scope job is queued and false otherwise', async () => {
    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => [] },
    });

    expect(await queue.isRegenerationPending(USER_ID, INTENT_ID)).toBe(false);

    await queue.addRegenerateJob({ userId: USER_ID, intentId: INTENT_ID });
    expect(await queue.isRegenerationPending(USER_ID, INTENT_ID)).toBe(true);
    // Scoped to its own (user, intent): a sibling scope stays not-pending.
    expect(await queue.isRegenerationPending(USER_ID, 'other-intent')).toBe(false);
  });
});

// ─── Answer consumption (conversational-questions answer wiring) ─────────────

/**
 * Duplicated post-stall park literal (the same duplication the reader makes;
 * adapters may not import the protocol package). The classifier convergence
 * spec pins writer and readers to the same value.
 */
const PARK_REASONING = "Negotiation parked pending the client's answer.";

interface AnswerHarnessOptions {
  /** Which refs currently hold a live park, and of which flavour. */
  parks: Record<string, 'inflight' | 'post_stall'>;
  routed: { addressesQuestions: boolean; answers: RoutedAnswer[] };
}

function buildAnswerHarness(options: AnswerHarnessOptions) {
  const calls = {
    routerInputs: [] as Array<{ replyText: string }>,
    settled: [] as Array<{ opportunityId: string; freeText?: string; answeredAt: string }>,
    inflightResumes: [] as Array<{ opportunityId: string; settlementId: string }>,
    recorded: [] as Array<{ opportunityId: string; questionId: string; freeText?: string }>,
    stalledRetries: [] as Array<{ opportunityId: string; parkTaskId: string }>,
    delivered: [] as DeliveredMessage[],
  };
  const taskIdFor = (opportunityId: string) => `task-${opportunityId}`;
  const ports: NegotiationAnswerConsumptionPorts = {
    database: {
      getNegotiationTaskForOpportunity: async (opportunityId: string) => {
        const park = options.parks[opportunityId];
        if (!park) return null;
        if (park === 'inflight') {
          return {
            id: taskIdFor(opportunityId),
            conversationId: 'conv-1',
            state: 'input_required',
            metadata: {
              turnContext: {
                askUserBinding: {
                  settlementId: negotiationQuestionSettlementId(taskIdFor(opportunityId)),
                  recipientUserId: USER_ID,
                  recipientIntentId: INTENT_ID,
                  networkId: 'network-1',
                  opportunityId,
                },
              },
            },
            createdAt: new Date(),
            updatedAt: new Date(),
          };
        }
        return {
          id: taskIdFor(opportunityId),
          conversationId: 'conv-1',
          state: 'completed',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        };
      },
      getNegotiationMessages: async (opportunityId: string) =>
        options.parks[opportunityId] === 'post_stall'
          ? [{
              id: 'message-1',
              senderId: `agent:${USER_ID}`,
              role: 'agent' as const,
              parts: [{ kind: 'data', data: {
                action: 'ask_user',
                message: null,
                assessment: { reasoning: PARK_REASONING, suggestedRoles: { ownUser: 'peer', otherUser: 'peer' } },
                askUser: { reason: 'unresolved_owner_constraint' },
              } }],
              createdAt: new Date(),
              taskId: taskIdFor(opportunityId),
            }]
          : [],
    },
    settleInflightAnswer: async (input) => {
      calls.settled.push({
        opportunityId: input.opportunityId,
        ...(input.answer.freeText !== undefined ? { freeText: input.answer.freeText } : {}),
        answeredAt: input.answer.answeredAt,
      });
      return 'settled';
    },
    enqueueInflightResume: async (input) => {
      calls.inflightResumes.push({ opportunityId: input.opportunityId, settlementId: input.settlementId });
    },
    recordOpportunityAnswer: async ({ opportunityId, answer }) => {
      calls.recorded.push({
        opportunityId,
        questionId: answer.questionId,
        ...(answer.freeText !== undefined ? { freeText: answer.freeText } : {}),
      });
    },
    enqueueStalledRetry: async (input) => {
      calls.stalledRetries.push({ opportunityId: input.opportunityId, parkTaskId: input.parkTaskId });
    },
  };
  const queue = new QuestionMessageQueue({
    answerPorts: ports,
    answerRouter: {
      route: async (input) => {
        calls.routerInputs.push({ replyText: input.replyText });
        return options.routed;
      },
    },
    chatSessions: {
      resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-1' } }),
      addMessage: async (params) => {
        calls.delivered.push(params);
        return `message-${calls.delivered.length}`;
      },
    },
  });
  return { queue, calls };
}

function answerJob(replyText: string): QuestionAnswerJobData {
  return {
    userId: USER_ID,
    intentId: INTENT_ID,
    sessionId: 'session-1',
    replyText,
    replyMessageId: 'reply-1',
    questionMessageId: 'question-message-1',
    questionMessageBody: questionMessageFixture,
    repliedAt: '2026-08-18T12:00:00.000Z',
  };
}

describe('QuestionMessageQueue answer-consumption job', () => {
  it('routes a reply onto an inflight park and resumes the primary and every alsoUnblocks ref', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: { [FIXTURE_PRIMARY_1]: 'inflight', [FIXTURE_ALSO_1]: 'inflight' },
      routed: {
        addressesQuestions: true,
        answers: [{ ref: FIXTURE_PRIMARY_1, answerText: 'Yes — share the budget range.' }],
      },
    });

    await queue.processJob('consume_question_answers', answerJob('Yes, share the budget range.'));

    expect(calls.settled.map((settle) => settle.opportunityId)).toEqual([FIXTURE_PRIMARY_1, FIXTURE_ALSO_1]);
    // The answered timestamp is the reply's, fixed at enqueue.
    expect(calls.settled.every((settle) => settle.answeredAt === '2026-08-18T12:00:00.000Z')).toBe(true);
    expect(calls.settled.every((settle) => settle.freeText === 'Yes — share the budget range.')).toBe(true);
    expect(calls.inflightResumes).toHaveLength(2);
    expect(calls.delivered).toHaveLength(0);
  });

  it('routes a reply onto a post-stall park: records the answer, enqueues the retry', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: { [FIXTURE_PRIMARY_2]: 'post_stall' },
      routed: {
        addressesQuestions: true,
        answers: [{ ref: FIXTURE_PRIMARY_2, answerText: 'March at the earliest.' }],
      },
    });

    await queue.processJob('consume_question_answers', answerJob('March at the earliest.'));

    expect(calls.recorded).toEqual([{
      opportunityId: FIXTURE_PRIMARY_2,
      questionId: negotiationParkAnswerId(`task-${FIXTURE_PRIMARY_2}`),
      freeText: 'March at the earliest.',
    }]);
    expect(calls.stalledRetries).toEqual([{
      opportunityId: FIXTURE_PRIMARY_2,
      parkTaskId: `task-${FIXTURE_PRIMARY_2}`,
    }]);
    expect(calls.settled).toHaveLength(0);
    expect(calls.delivered).toHaveLength(0);
  });

  it('sends the clarifying follow-up when the reply tried to answer but nothing routed', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: { [FIXTURE_PRIMARY_1]: 'inflight' },
      routed: { addressesQuestions: true, answers: [] },
    });

    await queue.processJob('consume_question_answers', answerJob('It depends on the thing I mentioned?'));

    expect(calls.settled).toHaveLength(0);
    expect(calls.stalledRetries).toHaveLength(0);
    expect(calls.delivered).toEqual([{
      sessionId: 'session-1',
      role: 'assistant',
      content: QUESTION_ANSWER_CLARIFICATION_MESSAGE,
    }]);
  });

  it('stays silent for a reply that does not attempt to answer — never a speculative resume', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: { [FIXTURE_PRIMARY_1]: 'inflight' },
      routed: { addressesQuestions: false, answers: [] },
    });

    await queue.processJob('consume_question_answers', answerJob('Thanks! What have you been up to?'));

    expect(calls.routerInputs).toHaveLength(1);
    expect(calls.settled).toHaveLength(0);
    expect(calls.recorded).toHaveLength(0);
    expect(calls.delivered).toHaveLength(0);
  });

  it('treats a block with no still-parked ref as closed — no routing, no clarification', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: {},
      routed: { addressesQuestions: true, answers: [{ ref: FIXTURE_PRIMARY_1, answerText: 'Late answer.' }] },
    });

    await queue.processJob('consume_question_answers', answerJob('Late answer.'));

    expect(calls.routerInputs).toHaveLength(0);
    expect(calls.settled).toHaveLength(0);
    expect(calls.delivered).toHaveLength(0);
  });
});

describe('enqueueQuestionAnswerReply detection', () => {
  const reply = {
    userId: USER_ID,
    intentId: INTENT_ID,
    sessionId: 'session-1',
    replyText: 'March works.',
    replyMessageId: 'reply-1',
  };

  it('enqueues consumption when the newest agent message carries a question block', async () => {
    const enqueued: QuestionAnswerJobData[] = [];
    const result = await enqueueQuestionAnswerReply(reply, {
      getSessionMessages: async () => [
        { id: 'm1', role: 'user', content: 'hello' },
        { id: 'm2', role: 'assistant', content: questionMessageFixture },
      ],
      addConsumeAnswerJob: async (data) => { enqueued.push(data); },
    });

    expect(result).toBe(true);
    expect(enqueued).toHaveLength(1);
    expect(enqueued[0]).toMatchObject({
      userId: USER_ID,
      intentId: INTENT_ID,
      sessionId: 'session-1',
      replyText: 'March works.',
      replyMessageId: 'reply-1',
      questionMessageId: 'm2',
      questionMessageBody: questionMessageFixture,
    });
  });

  it('does nothing when the newest agent message is plain conversation', async () => {
    const enqueued: QuestionAnswerJobData[] = [];
    const result = await enqueueQuestionAnswerReply(reply, {
      // The question-message exists but the negotiator has spoken since: the
      // newest agent message is the open-message anchor, and it has moved on.
      getSessionMessages: async () => [
        { id: 'm1', role: 'assistant', content: questionMessageFixture },
        { id: 'm2', role: 'user', content: 'earlier reply' },
        { id: 'm3', role: 'assistant', content: 'Got it — I will keep you posted.' },
      ],
      addConsumeAnswerJob: async (data) => { enqueued.push(data); },
    });

    expect(result).toBe(false);
    expect(enqueued).toHaveLength(0);
  });

  it('does nothing when the conversation has no agent message at all', async () => {
    const result = await enqueueQuestionAnswerReply(reply, {
      getSessionMessages: async () => [{ id: 'm1', role: 'user', content: 'hello?' }],
      addConsumeAnswerJob: async () => { throw new Error('must not enqueue'); },
    });
    expect(result).toBe(false);
  });

  it('never throws — a detection failure logs and leaves the chat turn intact', async () => {
    const result = await enqueueQuestionAnswerReply(reply, {
      getSessionMessages: async () => { throw new Error('database unavailable'); },
      addConsumeAnswerJob: async () => { throw new Error('must not enqueue'); },
    });
    expect(result).toBe(false);
  });
});
