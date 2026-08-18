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

import { negotiationParkAnswerId, negotiationQuestionSettlementId, parseQuestionMessage, serializeQuestionMessage } from '@indexnetwork/protocol';
import type { NegotiationAnswerConsumptionPorts, QuestionBlockQuestion, QuestionerEnqueuePayload, RoutedAnswer } from '@indexnetwork/protocol';
import { questionBlockFixture, questionMessageFixture, questionProseFixture } from '@indexnetwork/protocol/question-block/fixture';

import { QUESTION_ANSWER_CLARIFICATION_MESSAGE, QUESTION_MESSAGE_CLOSED_BODY, QUEUE_NAME, QuestionMessageQueue, enqueueQuestionAnswerReply, parkedQuestionMessageTarget, questionMessageJobId } from '../question-message.queue';
import type { QuestionAnswerJobData } from '../question-message.queue';
import type { QuestionMessageNotificationJobData } from '../notification.queue';
import { QueueFactory } from '../../lib/bullmq/bullmq';
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

interface UpdatedMessage {
  userId: string;
  intentId: string;
  messageId: string;
  content: string;
}

interface PublishedPendingFlip {
  userId: string;
  intentId: string;
  pending: boolean;
}

function buildQueue(options: {
  parked: ParkedNegotiation[];
  authorResult?: { prose: string; questions: QuestionBlockQuestion[] } | null;
  resolveResult?: { session: { id: string } } | { error: string; status: 400 | 403 | 404 | 500 };
  /** Newest message in the conversation at regeneration time (default: empty conversation). */
  newestMessage?: { id: string; role: 'user' | 'assistant' | 'system'; content: string } | null;
  /** What the update seam reports; false simulates the in-statement newest check failing. */
  updateResult?: boolean;
  /** The signal's DM as the read-only close-out lookup finds it (default: it exists). */
  existingSession?: { id: string } | null;
}) {
  const delivered: DeliveredMessage[] = [];
  const updated: UpdatedMessage[] = [];
  const published: PublishedPendingFlip[] = [];
  const notified: QuestionMessageNotificationJobData[] = [];
  const calls = { author: 0, resolve: 0, findSession: 0 };
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
      findNegotiatorIntentSession: async () => {
        calls.findSession += 1;
        return options.existingSession === undefined ? { id: 'session-1' } : options.existingSession;
      },
      addMessage: async (params) => {
        delivered.push(params);
        return `message-${delivered.length}`;
      },
      getNewestMessage: async () => options.newestMessage ?? null,
      updateQuestionMessageInPlace: async (params) => {
        updated.push(params);
        return options.updateResult ?? true;
      },
    },
    publishRegenerationEvent: async (userId, event) => {
      published.push({ userId, ...event });
    },
    notify: async (data) => {
      notified.push(data);
    },
  });
  return { queue, delivered, updated, published, notified, calls };
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

  it('does nothing on an empty parked set with nothing open — no authoring, no session create, no message', async () => {
    const { queue, delivered, updated, calls } = buildQueue({ parked: [] });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(calls.author).toBe(0);
    // The close-out looks, but only through the read-only lookup: an empty
    // parked set must never conjure a DM for a signal that has none.
    expect(calls.resolve).toBe(0);
    expect(delivered).toHaveLength(0);
    expect(updated).toHaveLength(0);
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

// ─── The edit rule (regenerate in place vs fresh message) ─────────────────────

/** A previously delivered question-message over the same block refs. */
const OPEN_MESSAGE_BODY = serializeQuestionMessage(
  'An earlier rendering of these questions.',
  questionBlockFixture,
);

describe('QuestionMessageQueue edit rule', () => {
  it('regenerates the open question-message in place — same id, fresh valid block, no new message', async () => {
    const { queue, delivered, updated } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'open-1', role: 'assistant', content: OPEN_MESSAGE_BODY },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(0);
    expect(updated).toHaveLength(1);
    expect(updated[0]).toEqual({
      userId: USER_ID,
      intentId: INTENT_ID,
      messageId: 'open-1',
      content: questionMessageFixture,
    });
    // The rewritten body is a valid question-message in its own right.
    const parsed = parseQuestionMessage(updated[0].content);
    expect(parsed).not.toBeNull();
    expect(parsed!.block).toEqual(questionBlockFixture);
  });

  it('creates a fresh message when the user replied since — the old message is untouched', async () => {
    const { queue, delivered, updated } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'reply-1', role: 'user', content: 'March at the earliest.' },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(0);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].content).toBe(questionMessageFixture);
  });

  it('creates a fresh message when the newest agent message carries no parseable block', async () => {
    const { queue, delivered, updated } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'prose-1', role: 'assistant', content: 'Got it — I will keep you posted.' },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(0);
    expect(delivered).toHaveLength(1);
  });

  it('creates a fresh message when the newest block references no still-parked negotiation', async () => {
    // The old message's refs all resolved; the new park is a different
    // negotiation. The old message is closed, so it is preserved as history.
    const { queue, delivered, updated } = buildQueue({
      parked: [parkedNegotiation('opportunity-parked-elsewhere', 0)],
      newestMessage: { id: 'closed-1', role: 'assistant', content: OPEN_MESSAGE_BODY },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(0);
    expect(delivered).toHaveLength(1);
  });

  it('falls back to create when the data layer rejects the update (reply raced the newest check)', async () => {
    const { queue, delivered, updated } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'open-1', role: 'assistant', content: OPEN_MESSAGE_BODY },
      updateResult: false,
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0].content).toBe(questionMessageFixture);
  });
});

// ─── Notification policy (create/new questions notify, everything else silent) ─

/** A block over an explicit subset of the fixture's questions. */
function openMessageOver(questions: QuestionBlockQuestion[], prose = 'An earlier rendering of these questions.'): string {
  return serializeQuestionMessage(prose, { version: 1, questions });
}

const [FIXTURE_QUESTION_1, FIXTURE_QUESTION_2] = questionBlockFixture.questions;

describe('QuestionMessageQueue notification policy', () => {
  it('notifies once when the question-message is created — one notification per message, never per question', async () => {
    const { queue, delivered, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(1);
    // Two questions over three negotiation refs; exactly one notification,
    // naming the delivered message and the signal whose DM carries it.
    expect(notified).toEqual([{
      userId: USER_ID,
      intentId: INTENT_ID,
      messageId: 'message-1',
      questionCount: 2,
    }]);
  });

  it('notifies on a regeneration that adds a negotiation the open message did not ask about', async () => {
    const { queue, updated, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0), parkedNegotiation(FIXTURE_PRIMARY_2, 2)],
      // The open message asked about the equity gap only; the Berlin lab
      // parked since and joins the regenerated block.
      newestMessage: { id: 'open-1', role: 'assistant', content: openMessageOver([FIXTURE_QUESTION_1]) },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(1);
    expect(notified).toEqual([{
      userId: USER_ID,
      intentId: INTENT_ID,
      messageId: 'open-1',
      questionCount: 2,
    }]);
  });

  it('stays silent when a regeneration only drops refs — pruning is not a new ask', async () => {
    const { queue, updated, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'open-1', role: 'assistant', content: openMessageOver(questionBlockFixture.questions) },
      authorResult: { prose: 'The Berlin lab withdrew; one thing left.', questions: [FIXTURE_QUESTION_1] },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(1);
    expect(notified).toHaveLength(0);
  });

  it('stays silent when a regeneration only regroups the same refs and rewrites the prose', async () => {
    const { queue, updated, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0), parkedNegotiation(FIXTURE_PRIMARY_2, 2)],
      newestMessage: { id: 'open-1', role: 'assistant', content: openMessageOver(questionBlockFixture.questions) },
      // Same three negotiations, merged into one question under new prose.
      authorResult: {
        prose: 'Both of these come down to the same thing.',
        questions: [{
          prompt: 'What equity range and on-site cadence can you commit to?',
          opportunityId: FIXTURE_PRIMARY_1,
          alsoUnblocks: [FIXTURE_ALSO_1, FIXTURE_PRIMARY_2],
        }],
      },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(1);
    expect(notified).toHaveLength(0);
  });

  it('stays silent when an answer-driven resume leaves a fresh message that re-states known questions', async () => {
    // The client replied, so the update loses the newest check and the
    // remaining question goes into a fresh message below the answer. It is a
    // new message, but it asks nothing the client has not already seen.
    const { queue, delivered, updated, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      newestMessage: { id: 'open-1', role: 'assistant', content: openMessageOver(questionBlockFixture.questions) },
      updateResult: false,
      authorResult: { prose: 'Thanks — one thing still open.', questions: [FIXTURE_QUESTION_1] },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(notified).toHaveLength(0);
  });

  it('notifies for a fresh message that asks about a negotiation the old message never named', async () => {
    // The old message's refs all resolved (it is closed), and the new park is
    // a different negotiation: a created message asking something new.
    const { queue, delivered, notified } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_2, 2)],
      newestMessage: { id: 'closed-1', role: 'assistant', content: openMessageOver([FIXTURE_QUESTION_1]) },
      authorResult: { prose: 'One new thing.', questions: [FIXTURE_QUESTION_2] },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(1);
    expect(notified).toEqual([{
      userId: USER_ID,
      intentId: INTENT_ID,
      messageId: 'message-1',
      questionCount: 1,
    }]);
  });

  it('delivers even when the notification enqueue fails — the message is not retried for it', async () => {
    const delivered: DeliveredMessage[] = [];
    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => [parkedNegotiation(FIXTURE_PRIMARY_1, 0)] },
      clientDm: async () => [],
      getIntentText: async () => null,
      author: { author: async () => ({ prose: questionProseFixture, questions: questionBlockFixture.questions }) },
      chatSessions: {
        resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-1' } }),
        findNegotiatorIntentSession: async () => ({ id: 'session-1' }),
        addMessage: async (params) => {
          delivered.push(params);
          return 'message-1';
        },
        getNewestMessage: async () => null,
        updateQuestionMessageInPlace: async () => true,
      },
      publishRegenerationEvent: async () => {},
      notify: async () => {
        throw new Error('redis unavailable');
      },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(delivered).toHaveLength(1);
  });
});

// ─── Close-out: the parked set emptied under an open question-message ─────────

describe('QuestionMessageQueue close-out', () => {
  it('rewrites the open message to a closed state — prose, no block, no notification', async () => {
    const { queue, delivered, updated, notified } = buildQueue({
      parked: [],
      newestMessage: { id: 'open-1', role: 'assistant', content: questionMessageFixture },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toEqual([{
      userId: USER_ID,
      intentId: INTENT_ID,
      messageId: 'open-1',
      content: QUESTION_MESSAGE_CLOSED_BODY,
    }]);
    // The rewritten body carries no block, so the message stops being open
    // and the steps UI renders it as plain prose.
    expect(parseQuestionMessage(updated[0].content)).toBeNull();
    expect(delivered).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });

  it('leaves the message untouched when the client replied since — the reply owns the thread', async () => {
    const { queue, delivered, updated, notified } = buildQueue({
      parked: [],
      newestMessage: { id: 'reply-1', role: 'user', content: 'March at the earliest.' },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(0);
    expect(delivered).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });

  it('leaves an already-closed message alone', async () => {
    const { queue, updated } = buildQueue({
      parked: [],
      newestMessage: { id: 'closed-1', role: 'assistant', content: QUESTION_MESSAGE_CLOSED_BODY },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(updated).toHaveLength(0);
  });

  it('does not touch the DM when the signal has none', async () => {
    const { queue, updated, calls } = buildQueue({
      parked: [],
      existingSession: null,
      newestMessage: { id: 'open-1', role: 'assistant', content: questionMessageFixture },
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    expect(calls.findSession).toBe(1);
    expect(calls.resolve).toBe(0);
    expect(updated).toHaveLength(0);
  });

  it('swallows a close-out that loses the newest-message race inside the update', async () => {
    const { queue, delivered, notified } = buildQueue({
      parked: [],
      newestMessage: { id: 'open-1', role: 'assistant', content: questionMessageFixture },
      updateResult: false,
    });

    await queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID });

    // The reply that raced it wins; nothing else is written to the DM.
    expect(delivered).toHaveLength(0);
    expect(notified).toHaveLength(0);
  });
});

// ─── Live pending flips on the conversation SSE channel ──────────────────────

describe('questionRegenerationPending live flips', () => {
  it('publishes pending: true at enqueue and pending: false when the job finishes', async () => {
    const { queue, published } = buildQueue({ parked: [] });

    await queue.addRegenerateJob({ userId: 'flip-user', intentId: 'flip-intent' });
    expect(published).toEqual([{ userId: 'flip-user', intentId: 'flip-intent', pending: true }]);

    await queue.processJob('regenerate_question_message', { userId: 'flip-user', intentId: 'flip-intent' });
    expect(published).toEqual([
      { userId: 'flip-user', intentId: 'flip-intent', pending: true },
      { userId: 'flip-user', intentId: 'flip-intent', pending: false },
    ]);
  });

  it('does not flip pending off when the job throws — the retry still owns the scope', async () => {
    const { queue, published } = buildQueue({
      parked: [parkedNegotiation(FIXTURE_PRIMARY_1, 0)],
      resolveResult: { error: 'database unavailable', status: 500 },
    });

    await expect(
      queue.processJob('regenerate_question_message', { userId: USER_ID, intentId: INTENT_ID }),
    ).rejects.toThrow('database unavailable');
    expect(published).toHaveLength(0);
  });

  it('never breaks the enqueue path on a publish failure', async () => {
    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => [] },
      publishRegenerationEvent: async () => {
        throw new Error('redis unavailable');
      },
    });

    const job = await queue.addRegenerateJob({ userId: 'flip-user-2', intentId: 'flip-intent-2' });
    expect(job).toBeTruthy();
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
    notified: [] as QuestionMessageNotificationJobData[],
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
      findNegotiatorIntentSession: async () => ({ id: 'session-1' }),
      addMessage: async (params) => {
        calls.delivered.push(params);
        return `message-${calls.delivered.length}`;
      },
      getNewestMessage: async () => null,
      updateQuestionMessageInPlace: async () => {
        throw new Error('answer consumption must never rewrite the question-message');
      },
    },
    notify: async (data) => {
      calls.notified.push(data);
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

  it('never notifies for an answer-driven resume — the client is already in the conversation', async () => {
    const { queue, calls } = buildAnswerHarness({
      parks: { [FIXTURE_PRIMARY_1]: 'inflight', [FIXTURE_ALSO_1]: 'inflight' },
      routed: {
        addressesQuestions: true,
        answers: [{ ref: FIXTURE_PRIMARY_1, answerText: 'Up to two percent.' }],
      },
    });

    await queue.processJob('consume_question_answers', answerJob('Up to two percent.'));

    expect(calls.inflightResumes).toHaveLength(2);
    expect(calls.notified).toHaveLength(0);
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

// ─── Regeneration ↔ answer serialization through the shared queue ────────────

describe('regeneration ↔ answer serialization', () => {
  it('an answer arriving mid-regeneration waits for the regeneration to finish — no interleave', async () => {
    const RACE_USER = 'race-user';
    const RACE_INTENT = 'race-intent';
    const events: string[] = [];
    let releaseAuthor!: () => void;
    const authorGate = new Promise<void>((resolve) => {
      releaseAuthor = resolve;
    });

    const queue = new QuestionMessageQueue({
      parkedSet: { readParkedNegotiations: async () => [parkedNegotiation(FIXTURE_PRIMARY_1, 0)] },
      clientDm: async () => [],
      getIntentText: async () => 'A signal about finding a technical co-founder',
      author: {
        author: async () => {
          events.push('regenerate:author_start');
          await authorGate;
          return { prose: questionProseFixture, questions: questionBlockFixture.questions };
        },
      },
      chatSessions: {
        resolveNegotiatorIntentSession: async () => ({ session: { id: 'session-race' } }),
        findNegotiatorIntentSession: async () => ({ id: 'session-race' }),
        addMessage: async () => {
          events.push('regenerate:delivered');
          return 'message-race-1';
        },
        getNewestMessage: async () => null,
        updateQuestionMessageInPlace: async () => {
          throw new Error('no open message in this scenario');
        },
      },
      notify: async () => {
        events.push('regenerate:notified');
      },
      answerPorts: {
        database: {
          getNegotiationTaskForOpportunity: async (opportunityId: string) => {
            events.push('consume:classify');
            if (opportunityId !== FIXTURE_PRIMARY_1) return null;
            return {
              id: `task-${opportunityId}`,
              conversationId: 'conv-race',
              state: 'input_required',
              metadata: {
                turnContext: {
                  askUserBinding: {
                    settlementId: negotiationQuestionSettlementId(`task-${opportunityId}`),
                    recipientUserId: RACE_USER,
                    recipientIntentId: RACE_INTENT,
                    networkId: 'network-1',
                    opportunityId,
                  },
                },
              },
              createdAt: new Date(),
              updatedAt: new Date(),
            };
          },
          getNegotiationMessages: async () => [],
        },
        settleInflightAnswer: async () => {
          events.push('consume:settled');
          return 'settled';
        },
        enqueueInflightResume: async () => {
          events.push('consume:resumed');
        },
        recordOpportunityAnswer: async () => {
          events.push('consume:recorded');
        },
        enqueueStalledRetry: async () => {
          events.push('consume:retried');
        },
      },
      answerRouter: {
        route: async () => {
          events.push('consume:routed');
          return { addressesQuestions: true, answers: [{ ref: FIXTURE_PRIMARY_1, answerText: 'Yes.' }] };
        },
      },
      publishRegenerationEvent: async (_userId, event) => {
        events.push(`pending:${event.pending}`);
      },
    });

    // The hermetic broker is shared per queue name: drain jobs left waiting by
    // earlier tests so the worker only sees this scenario's two jobs.
    for (const staleJob of await queue.queue.getJobs(['waiting', 'delayed'])) {
      await staleJob.remove();
    }

    queue.startWorker();
    const queueEvents = QueueFactory.createQueueEvents(QUEUE_NAME);
    try {
      const regenerateJob = await queue.addRegenerateJob({ userId: RACE_USER, intentId: RACE_INTENT });
      const consumeJob = await queue.addConsumeAnswerJob({
        ...answerJob('Yes.'),
        userId: RACE_USER,
        intentId: RACE_INTENT,
      });
      events.push('enqueue:consume');
      releaseAuthor();

      await regenerateJob.waitUntilFinished(queueEvents, 5_000);
      await consumeJob.waitUntilFinished(queueEvents, 5_000);
    } finally {
      await queueEvents.close();
      await queue.close();
    }

    // The answer really did arrive while the regeneration was in flight…
    const deliveredAt = events.indexOf('regenerate:delivered');
    expect(events.indexOf('enqueue:consume')).toBeGreaterThanOrEqual(0);
    expect(events.indexOf('enqueue:consume')).toBeLessThan(deliveredAt);
    // …and every consumption step ran only after the regeneration's write.
    const firstConsume = events.findIndex((event) => event.startsWith('consume:'));
    expect(firstConsume).toBeGreaterThan(deliveredAt);
    expect(events).toContain('consume:settled');
    expect(events).toContain('consume:resumed');
    // The pending flip bracketed the regeneration, not the answer.
    expect(events.indexOf('pending:true')).toBeLessThan(deliveredAt);
    expect(events.indexOf('pending:false')).toBeGreaterThan(deliveredAt);
    expect(events.indexOf('pending:false')).toBeLessThan(firstConsume);
  });
});
