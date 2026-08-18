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

import { parseQuestionMessage } from '@indexnetwork/protocol';
import type { QuestionerEnqueuePayload } from '@indexnetwork/protocol';
import { questionBlockFixture, questionMessageFixture, questionProseFixture } from '@indexnetwork/protocol/question-block/fixture';

import { QuestionMessageQueue, parkedQuestionMessageTarget, questionMessageJobId } from '../question-message.queue';
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
