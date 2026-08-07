import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.NEGOTIATION_ASK_USER_ENABLED = 'true';
process.env.QUESTIONER_ENABLED = 'true';
process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = 'off';

import { afterAll, describe, expect, it as bunIt, mock } from 'bun:test';
import { randomUUID } from 'crypto';
import { and, desc, eq, sql } from 'drizzle-orm';
import { withMinimumDatabaseTestBudget } from '../src/lib/testing/database-test-budget';

const it = withMinimumDatabaseTestBudget(bunIt, 60_000);
const expiries: Array<Record<string, unknown>> = [];
const canceledExpiries: Array<{ negotiationId: string; consultationAttemptId?: string }> = [];
const claimTimerCancellations: string[] = [];
const questionerPayloads: Array<Record<string, unknown>> = [];

mock.module('../src/queues/questioner.queue', () => ({
  questionerEnqueueIfEnabled: () => async (payload: Record<string, unknown>) => {
    questionerPayloads.push(payload);
  },
}));
mock.module('../src/adapters/negotiator-memory.retrieval.adapter', () => ({
  negotiatorMemoryRetrievalAdapter: { retrieveForNegotiation: async () => [] },
}));

const { NegotiationTimeoutQueue, negotiationTimeoutQueue } = await import('../src/queues/negotiations/timeout.queue');
const { NegotiationClaimTimeoutQueue, negotiationClaimTimeoutQueue } = await import('../src/queues/negotiations/claim-timeout.queue');
const originalTimeoutMethods = {
  enqueueTimeout: negotiationTimeoutQueue.enqueueTimeout.bind(negotiationTimeoutQueue),
  enqueueAskUserExpiry: negotiationTimeoutQueue.enqueueAskUserExpiry.bind(negotiationTimeoutQueue),
  cancelAskUserExpiry: negotiationTimeoutQueue.cancelAskUserExpiry.bind(negotiationTimeoutQueue),
};
const originalClaimTimeoutMethods = {
  enqueueTimeout: negotiationClaimTimeoutQueue.enqueueTimeout.bind(negotiationClaimTimeoutQueue),
  cancelTimeout: negotiationClaimTimeoutQueue.cancelTimeout.bind(negotiationClaimTimeoutQueue),
};
negotiationTimeoutQueue.enqueueTimeout = async () => 'park';
negotiationTimeoutQueue.enqueueAskUserExpiry = async (
  negotiationId: string,
  consultationAttemptId: string,
  payload: Record<string, unknown>,
) => {
  expiries.push({ negotiationId, consultationAttemptId, ...payload });
  return `expiry-${consultationAttemptId}`;
};
negotiationTimeoutQueue.cancelAskUserExpiry = async (negotiationId: string, consultationAttemptId?: string) => {
  canceledExpiries.push({ negotiationId, consultationAttemptId });
};
negotiationClaimTimeoutQueue.enqueueTimeout = async () => 'claim';
negotiationClaimTimeoutQueue.cancelTimeout = async (negotiationId: string) => {
  claimTimerCancellations.push(negotiationId);
};

const { NegotiationPollingService } = await import('../src/services/negotiation-polling.service');
const { conversationDatabaseAdapter } = await import('../src/adapters/database.adapter');
const { questionerAdapter } = await import('../src/adapters/questioner.adapter.instance');
const { QuestionEvents } = await import('../src/events/question.event');
const { handleQuestionAnswered } = await import('../src/events/handlers/question.answer.handler');
const { resumeInflightNegotiationFactory } = await import('../src/events/handlers/question.answer.negotiation-inflight');
const { NegotiationRunExistingQueue } = await import('../src/queues/negotiations/run-existing.queue');
const { default: db } = await import('../src/lib/drizzle/drizzle');
const schema = await import('../src/schemas/database.schema');
const conversationSchema = await import('../src/schemas/conversation.schema');

type SettlementKind = 'answer' | 'dismiss' | 'expire';
type Fixture = Awaited<ReturnType<typeof seedClaimedNegotiation>>;
type AtomicMethod = 'pauseClaimedNegotiationForConsultation' | 'transitionClaimedTaskToWorking';

const cleanupConversations: string[] = [];
const cleanupUsers: string[] = [];
const cleanupNetworks: string[] = [];
const cleanupOpportunities: string[] = [];

function turn(action: 'accept' | 'counter' = 'accept') {
  return {
    action,
    message: null,
    assessment: { reasoning: `${action} fixture`, suggestedRoles: { ownUser: 'patient', otherUser: 'agent' } },
  };
}

async function seedClaimedNegotiation(label: string) {
  const [owner, counterparty] = await Promise.all([label, `${label}-counterparty`].map(async (name) => {
    const [row] = await db.insert(schema.users).values({
      email: `consult-${name}-${randomUUID()}@test.local`,
      name,
    }).returning({ id: schema.users.id });
    cleanupUsers.push(row.id);
    return row.id;
  }));
  const [network] = await db.insert(schema.networks).values({
    name: `Consult ${label} ${randomUUID()}`,
    description: 'isolated consultation fixture',
    isPersonal: false,
  }).returning({ id: schema.networks.id });
  cleanupNetworks.push(network.id);
  await db.insert(schema.networkMembers).values([
    { networkId: network.id, userId: owner, permissions: ['member'] },
    { networkId: network.id, userId: counterparty, permissions: ['member'] },
  ]);
  const [ownerIntent, counterpartyIntent] = await Promise.all([
    db.insert(schema.intents).values({ userId: owner, payload: 'Find a collaborator', status: 'ACTIVE' }).returning({ id: schema.intents.id }),
    db.insert(schema.intents).values({ userId: counterparty, payload: 'Offer collaboration', status: 'ACTIVE' }).returning({ id: schema.intents.id }),
  ]).then((rows) => [rows[0][0], rows[1][0]]);
  await db.insert(schema.intentNetworks).values([
    { intentId: ownerIntent.id, networkId: network.id },
    { intentId: counterpartyIntent.id, networkId: network.id },
  ]);
  const [opportunity] = await db.insert(schema.opportunities).values({
    detection: { kind: 'test', summary: 'consultation e2e' } as never,
    actors: [
      { userId: counterparty, intent: counterpartyIntent.id, networkId: network.id, role: 'peer' },
      { userId: owner, intent: ownerIntent.id, networkId: network.id, role: 'peer' },
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: { networkId: network.id } as never,
    confidence: '0.9',
    status: 'negotiating',
  }).returning({ id: schema.opportunities.id });
  cleanupOpportunities.push(opportunity.id);
  const [agent] = await db.insert(schema.agents).values({
    ownerId: owner,
    name: `External ${label}`,
    type: 'external',
  }).returning({ id: schema.agents.id });
  const conversation = await conversationDatabaseAdapter.createConversation([
    { participantId: `agent:${owner}`, participantType: 'agent' },
    { participantId: `agent:${counterparty}`, participantType: 'agent' },
  ]);
  cleanupConversations.push(conversation.id);
  const task = await conversationDatabaseAdapter.createTask(conversation.id, {
    type: 'negotiation',
    protocolVersion: 'v2',
    sourceUserId: counterparty,
    candidateUserId: owner,
    initiatorUserId: counterparty,
    sourceIntentId: counterpartyIntent.id,
    candidateIntentId: ownerIntent.id,
    opportunityId: opportunity.id,
    networkId: network.id,
    maxTurns: 6,
    participantBindings: [
      { userId: counterparty, intentId: counterpartyIntent.id, networkId: network.id },
      { userId: owner, intentId: ownerIntent.id, networkId: network.id },
    ],
    turnContext: {
      sourceUser: { id: counterparty, profile: { name: 'Counterparty' }, intents: [] },
      candidateUser: { id: owner, profile: { name: 'Owner' }, intents: [] },
      indexContext: { networkId: network.id },
      seedAssessment: { reasoning: 'fixture' },
    },
  });
  await conversationDatabaseAdapter.createMessage({
    conversationId: conversation.id,
    taskId: task.id,
    senderId: `agent:${counterparty}`,
    role: 'agent',
    parts: [{ kind: 'data', data: {
      action: 'counter',
      message: null,
      assessment: { reasoning: 'counter', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
    } }],
  });
  await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');
  const service = new NegotiationPollingService({
    authorizePickup: async () => true,
    authorizeRespond: async () => true,
  } as never);
  expect(await service.pickup(agent.id, owner)).toMatchObject({ taskId: task.id, canConsultOwner: true });
  return { owner, counterparty, network, ownerIntent, counterpartyIntent, opportunity, agent, conversation, task, service };
}

/**
 * Hold all named contenders until they have both reached the production atomic
 * adapter method, then release them together. The wrapper delegates to the real
 * PostgreSQL transaction/CAS and is restored before assertions.
 */
function gateAtomicBoundary(methods: AtomicMethod[]): () => void {
  const adapter = conversationDatabaseAdapter as unknown as Record<AtomicMethod, (...args: never[]) => Promise<unknown>>;
  const originals = new Map<AtomicMethod, (...args: never[]) => Promise<unknown>>();
  let entered = 0;
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  for (const method of new Set(methods)) {
    const original = adapter[method].bind(conversationDatabaseAdapter);
    originals.set(method, original);
    adapter[method] = (async (...args: never[]) => {
      entered += 1;
      if (entered === methods.length) release();
      await released;
      return original(...args);
    }) as typeof adapter[typeof method];
  }
  return () => {
    for (const [method, original] of originals) adapter[method] = original;
  };
}

async function addForeignNetworkActor(fixture: Fixture) {
  const [foreignUser] = await db.insert(schema.users).values({
    email: `consult-foreign-${randomUUID()}@test.local`,
    name: 'Foreign actor',
  }).returning({ id: schema.users.id });
  cleanupUsers.push(foreignUser.id);
  const [foreignNetwork] = await db.insert(schema.networks).values({
    name: `Foreign consultation network ${randomUUID()}`,
    description: 'foreign-network admission fixture',
    isPersonal: false,
  }).returning({ id: schema.networks.id });
  cleanupNetworks.push(foreignNetwork.id);
  await db.insert(schema.networkMembers).values({
    networkId: foreignNetwork.id,
    userId: foreignUser.id,
    permissions: ['member'],
  });
  const [foreignIntent] = await db.insert(schema.intents).values({
    userId: foreignUser.id,
    payload: 'Foreign network intent',
    status: 'ACTIVE',
  }).returning({ id: schema.intents.id });
  await db.insert(schema.intentNetworks).values({
    intentId: foreignIntent.id,
    networkId: foreignNetwork.id,
  });
  await db.update(schema.opportunities).set({
    actors: [
      { userId: fixture.counterparty, intent: fixture.counterpartyIntent.id, networkId: fixture.network.id, role: 'peer' },
      { userId: fixture.owner, intent: fixture.ownerIntent.id, networkId: fixture.network.id, role: 'peer' },
      { userId: foreignUser.id, intent: foreignIntent.id, networkId: foreignNetwork.id, role: 'peer' },
    ] as never,
  }).where(eq(schema.opportunities.id, fixture.opportunity.id));
}

async function replaceCounterpartyActors(
  fixture: Fixture,
  mode: 'stale-intent' | 'canonical-duplicate',
) {
  let counterpartyIntentId = fixture.counterpartyIntent.id;
  if (mode === 'stale-intent') {
    const [staleIntent] = await db.insert(schema.intents).values({
      userId: fixture.counterparty,
      payload: 'Stale counterparty intent',
      status: 'ACTIVE',
    }).returning({ id: schema.intents.id });
    await db.insert(schema.intentNetworks).values({
      intentId: staleIntent.id,
      networkId: fixture.network.id,
    });
    counterpartyIntentId = staleIntent.id;
  }
  const counterpartyActor = {
    userId: fixture.counterparty,
    intent: counterpartyIntentId,
    networkId: fixture.network.id,
    role: 'peer',
  };
  await db.update(schema.opportunities).set({
    actors: [
      counterpartyActor,
      ...(mode === 'canonical-duplicate' ? [counterpartyActor] : []),
      { userId: fixture.owner, intent: fixture.ownerIntent.id, networkId: fixture.network.id, role: 'peer' },
    ] as never,
  }).where(eq(schema.opportunities.id, fixture.opportunity.id));
}

async function replacePrecedingSender(fixture: Fixture, senderId: string) {
  const [preceding] = await db.select({ id: conversationSchema.messages.id })
    .from(conversationSchema.messages)
    .where(eq(conversationSchema.messages.conversationId, fixture.conversation.id))
    .orderBy(desc(conversationSchema.messages.createdAt), desc(conversationSchema.messages.id))
    .limit(1);
  await db.update(conversationSchema.messages).set({ senderId })
    .where(eq(conversationSchema.messages.id, preceding.id));
}

async function counts(fixture: Fixture) {
  const messages = await conversationDatabaseAdapter.getMessagesForConversation(fixture.conversation.id);
  const [{ artifacts }] = await db.select({ artifacts: sql<number>`count(*)::int` })
    .from(conversationSchema.artifacts)
    .where(and(
      eq(conversationSchema.artifacts.taskId, fixture.task.id),
      eq(conversationSchema.artifacts.name, 'negotiation-outcome'),
    ));
  const actions = messages.flatMap((message) => {
    const data = (message.parts as Array<{ kind?: string; data?: { action?: string } }>).find((part) => part.kind === 'data')?.data;
    return data?.action ? [data.action] : [];
  });
  return { messages: messages.length, actions, artifacts: Number(artifacts) };
}

async function assertStable(fixture: Fixture, expected: Awaited<ReturnType<typeof counts>>) {
  expect(await counts(fixture)).toEqual(expected);
  const task = await conversationDatabaseAdapter.getTask(fixture.task.id);
  expect(task?.state).toBe(expected.artifacts === 1 ? 'completed' : 'input_required');
}

async function persistInflightQuestion(fixture: Fixture) {
  const paused = await conversationDatabaseAdapter.getTask(fixture.task.id);
  const binding = (paused!.metadata!.turnContext as Record<string, unknown>).askUserBinding as Record<string, string>;
  const [question] = await db.insert(schema.questions).values({
    detection: {
      mode: 'negotiation_inflight',
      purpose: 'inflight_consultation',
      sourceType: 'opportunity',
      sourceId: fixture.opportunity.id,
      timestamp: new Date().toISOString(),
      negotiation: {
        version: 1,
        purpose: 'inflight_consultation',
        recipientUserId: fixture.owner,
        recipientIntentId: fixture.ownerIntent.id,
        opportunityId: fixture.opportunity.id,
        taskId: fixture.task.id,
        networkId: fixture.network.id,
        intentFingerprint: binding.intentFingerprint,
        opportunityStatus: binding.opportunityStatus,
        opportunityUpdatedAt: binding.opportunityUpdatedAt,
        taskState: 'input_required',
        taskUpdatedAt: paused!.updatedAt.toISOString(),
        questionOrdinal: 0,
      },
    } as never,
    actors: [{ userId: fixture.owner, networkId: fixture.network.id, role: 'subject' }] as never,
    payload: {
      title: 'Your preference',
      prompt: 'May your agent share your availability?',
      options: [
        { label: 'Yes', description: 'Allow sharing' },
        { label: 'No', description: 'Do not share' },
      ],
      multiSelect: false,
    },
    status: 'pending',
    expiresAt: new Date(Date.now() + 86_400_000),
  }).returning({ id: schema.questions.id });
  return { paused: paused!, binding, question };
}

function installContinuationExecution() {
  const executedSuccessors: string[] = [];
  const dispatched: Array<Record<string, unknown>> = [];
  const runExisting = new NegotiationRunExistingQueue({
    continuationAdapter: questionerAdapter,
    invokeOpportunityGraph: async ({ opportunityId, options }) => {
      const execution = options.negotiationContinuation as {
        taskId: string;
        settlementId: string;
        successorTaskId: string;
        fence: number;
      };
      executedSuccessors.push(execution.successorTaskId);
      await conversationDatabaseAdapter.updateTaskState(execution.successorTaskId, 'completed', undefined, execution as never);
      await conversationDatabaseAdapter.createArtifact({
        taskId: execution.successorTaskId,
        name: 'negotiation-outcome',
        parts: [{ kind: 'data', data: { hasOpportunity: false, agreedRoles: [], reasoning: 'continuation fixture', turnCount: 2 } }],
        metadata: { hasOpportunity: false, turnCount: 2, continuationOutcome: 'stalled' },
        continuationExecution: execution as never,
      });
      await conversationDatabaseAdapter.updateOpportunityStatus(opportunityId, 'stalled', undefined, execution as never);
      return { negotiationContinuationReceipt: {
        priorTaskId: execution.taskId,
        settlementId: execution.settlementId,
        successorTaskId: execution.successorTaskId,
        fence: execution.fence,
        outcome: 'stalled',
      } };
    },
  });
  const enqueueResume = async (input: Record<string, unknown>) => {
    dispatched.push(input);
    await runExisting.processJob('negotiate_existing', input as never);
  };
  const resume = resumeInflightNegotiationFactory({ enqueueResume: enqueueResume as never });
  const answerDeps = {
    createPremiseFromAnswer: async () => undefined,
    enqueueIntentRefinement: async () => ({ applied: true as const }),
    resumeInflightNegotiation: resume,
    resolveChatQuestionWait: () => undefined,
    handlePoolAnswer: async () => undefined,
  };
  QuestionEvents.onAnswered = async (payload) => {
    await handleQuestionAnswered(payload, answerDeps);
  };
  QuestionEvents.onDismissed = async (payload) => {
    if (
      payload.mode === 'negotiation_inflight'
      && payload.settlement?.authoritative
      && payload.settlement.resumeClaimed
      && payload.settlement.taskId
      && payload.settlement.settlementId
    ) {
      await resume({
        userId: payload.userId,
        opportunityId: payload.settlement.opportunityId,
        questionId: payload.questionId,
        selectedOptions: [],
        taskId: payload.settlement.taskId,
        settlementId: payload.settlement.settlementId,
        recipientIntentId: payload.settlement.recipientIntentId,
        networkId: payload.settlement.networkId,
      });
    }
  };
  return { runExisting, enqueueResume, executedSuccessors, dispatched };
}

async function settleThroughContinuation(kind: SettlementKind) {
  const fixture = await seedClaimedNegotiation(`settlement-${kind}`);
  expect((await fixture.service.consult(
    fixture.agent.id,
    fixture.owner,
    fixture.task.id,
    { disclosureSubject: 'availability' },
  )).status).toBe('input_required');
  const { binding, question } = await persistInflightQuestion(fixture);
  const continuation = installContinuationExecution();
  try {
    if (kind === 'answer') {
      const answer = { selectedOptions: ['Yes'], answeredBy: fixture.owner, answeredAt: new Date().toISOString() };
      expect(await questionerAdapter.answer(question.id, fixture.owner, answer)).toBe(true);
      expect(await questionerAdapter.answer(question.id, fixture.owner, answer)).toBe(true);
    } else if (kind === 'dismiss') {
      expect(await questionerAdapter.dismiss(question.id, fixture.owner)).toBe(true);
      expect(await questionerAdapter.dismiss(question.id, fixture.owner)).toBe(true);
    } else {
      const expiry = expiries.findLast((entry) => entry.negotiationId === fixture.task.id)!;
      const expiryQueue = new NegotiationTimeoutQueue({
        settleInflightExpiry: (input) => questionerAdapter.expireInflightQuestion(input as never),
        enqueueResume: continuation.enqueueResume as never,
      });
      await expiryQueue.processJob('ask_user_expiry', expiry as never);
      await expiryQueue.processJob('ask_user_expiry', expiry as never);
      await expiryQueue.close();
    }

    expect(continuation.dispatched).toHaveLength(2);
    expect(continuation.executedSuccessors).toHaveLength(1);
    const [successorTaskId] = continuation.executedSuccessors;
    const successors = await db.select({ id: conversationSchema.tasks.id, state: conversationSchema.tasks.state })
      .from(conversationSchema.tasks)
      .where(and(
        sql`${conversationSchema.tasks.metadata}->>'resumeFromTaskId' = ${fixture.task.id}`,
        sql`${conversationSchema.tasks.metadata}->>'continuationSettlementId' = ${binding.settlementId}`,
      ));
    expect(successors).toEqual([{ id: successorTaskId, state: 'completed' }]);
    const [{ value: completionArtifacts }] = await db.select({ value: sql<number>`count(*)::int` })
      .from(conversationSchema.artifacts)
      .where(and(
        eq(conversationSchema.artifacts.taskId, successorTaskId),
        eq(conversationSchema.artifacts.name, 'negotiation-outcome'),
      ));
    expect(Number(completionArtifacts)).toBe(1);
    const prior = await conversationDatabaseAdapter.getTask(fixture.task.id);
    expect((prior!.metadata!.questionSettlement as Record<string, unknown>).continuationStatus).toBe('completed');
  } finally {
    await continuation.runExisting.close();
  }
}

afterAll(async () => {
  QuestionEvents.onAnswered = () => undefined;
  QuestionEvents.onDismissed = () => undefined;
  negotiationTimeoutQueue.enqueueTimeout = originalTimeoutMethods.enqueueTimeout;
  negotiationTimeoutQueue.enqueueAskUserExpiry = originalTimeoutMethods.enqueueAskUserExpiry;
  negotiationTimeoutQueue.cancelAskUserExpiry = originalTimeoutMethods.cancelAskUserExpiry;
  negotiationClaimTimeoutQueue.enqueueTimeout = originalClaimTimeoutMethods.enqueueTimeout;
  negotiationClaimTimeoutQueue.cancelTimeout = originalClaimTimeoutMethods.cancelTimeout;
  for (const id of cleanupConversations) await conversationDatabaseAdapter.deleteConversation(id).catch(() => undefined);
  for (const id of cleanupOpportunities) await db.delete(schema.opportunities).where(eq(schema.opportunities.id, id)).catch(() => undefined);
  for (const id of cleanupNetworks) await db.delete(schema.networks).where(eq(schema.networks.id, id)).catch(() => undefined);
  for (const id of cleanupUsers) await db.delete(schema.users).where(eq(schema.users.id, id)).catch(() => undefined);
  mock.restore();
});

describe('external consultation atomic adapter races', () => {
  it('rejects an extra foreign-network non-introducer actor and preserves the claim', async () => {
    const fixture = await seedClaimedNegotiation('foreign-network-actor');
    await addForeignNetworkActor(fixture);
    const before = await counts(fixture);

    await expect(fixture.service.consult(
      fixture.agent.id,
      fixture.owner,
      fixture.task.id,
      { disclosureSubject: 'availability' },
    )).rejects.toThrow('consultation binding is no longer current');

    expect(await counts(fixture)).toEqual(before);
    expect(await conversationDatabaseAdapter.getTask(fixture.task.id)).toMatchObject({
      state: 'claimed',
      claimedByAgentId: fixture.agent.id,
    });
  }, 60_000);

  it('rejects a stale counterparty actor intent and preserves the exact claimed task', async () => {
    const fixture = await seedClaimedNegotiation('stale-counterparty-intent');
    await replaceCounterpartyActors(fixture, 'stale-intent');
    const before = await counts(fixture);

    await expect(fixture.service.consult(
      fixture.agent.id,
      fixture.owner,
      fixture.task.id,
      { disclosureSubject: 'availability' },
    )).rejects.toThrow('consultation binding is no longer current');

    expect(await counts(fixture)).toEqual(before);
    expect(await conversationDatabaseAdapter.getTask(fixture.task.id)).toMatchObject({
      state: 'claimed',
      claimedByAgentId: fixture.agent.id,
    });
  }, 60_000);

  it('accepts duplicate canonical counterparty actor rows exactly as Questioner does', async () => {
    const fixture = await seedClaimedNegotiation('duplicate-counterparty-actor');
    await replaceCounterpartyActors(fixture, 'canonical-duplicate');

    await expect(fixture.service.consult(
      fixture.agent.id,
      fixture.owner,
      fixture.task.id,
      { disclosureSubject: 'availability' },
    )).resolves.toMatchObject({ status: 'input_required' });

    const persisted = await conversationDatabaseAdapter.getTask(fixture.task.id);
    expect(persisted).toMatchObject({ state: 'input_required' });
    expect(((persisted!.metadata!.turnContext as Record<string, unknown>).askUserBinding as Record<string, unknown>)).toMatchObject({
      counterpartyUserId: fixture.counterparty,
      counterpartyIntentId: fixture.counterpartyIntent.id,
    });
  }, 60_000);

  it.each([
    ['wrong participant', 'agent:unrelated-user'],
    ['system', 'system:negotiation-timeout'],
  ] as const)('revalidates the exact bound counterparty against a %s sender under the task lock', async (_label, senderId) => {
    const fixture = await seedClaimedNegotiation(`locked-sender-${_label}`);
    const before = await counts(fixture);
    const adapter = conversationDatabaseAdapter as unknown as Record<AtomicMethod, (...args: never[]) => Promise<unknown>>;
    const original = adapter.pauseClaimedNegotiationForConsultation.bind(conversationDatabaseAdapter);
    adapter.pauseClaimedNegotiationForConsultation = (async (...args: never[]) => {
      await replacePrecedingSender(fixture, senderId);
      return original(...args);
    }) as typeof adapter.pauseClaimedNegotiationForConsultation;
    try {
      await expect(fixture.service.consult(
        fixture.agent.id,
        fixture.owner,
        fixture.task.id,
        { disclosureSubject: 'availability' },
      )).rejects.toThrow('no longer held by this claim');
    } finally {
      adapter.pauseClaimedNegotiationForConsultation = original;
    }

    expect(await counts(fixture)).toEqual(before);
    expect(await conversationDatabaseAdapter.getTask(fixture.task.id)).toMatchObject({
      state: 'claimed',
      claimedByAgentId: fixture.agent.id,
    });
  }, 60_000);

  it('duplicate consult commits one pause/message and the loser cannot cancel the winner expiry', async () => {
    const fixture = await seedClaimedNegotiation('duplicate-consult');
    const expiryStart = expiries.length;
    const canceledStart = canceledExpiries.length;
    const restore = gateAtomicBoundary([
      'pauseClaimedNegotiationForConsultation',
      'pauseClaimedNegotiationForConsultation',
    ]);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        fixture.service.consult(fixture.agent.id, fixture.owner, fixture.task.id, { disclosureSubject: 'availability' }),
        fixture.service.consult(fixture.agent.id, fixture.owner, fixture.task.id, { disclosureSubject: 'availability' }),
      ]);
    } finally {
      restore();
    }

    expect(results!.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results!.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const after = await counts(fixture);
    expect(after).toMatchObject({ messages: 2, artifacts: 0 });
    expect(after.actions.filter((action) => action === 'ask_user')).toHaveLength(1);
    const persisted = await conversationDatabaseAdapter.getTask(fixture.task.id);
    expect(persisted?.state).toBe('input_required');
    const winnerAttempt = ((persisted!.metadata!.turnContext as Record<string, unknown>).askUserBinding as Record<string, string>).consultationAttemptId;
    const armedAttempts = expiries.slice(expiryStart).map((entry) => entry.consultationAttemptId);
    const canceledAttempts = canceledExpiries.slice(canceledStart).map((entry) => entry.consultationAttemptId);
    expect(armedAttempts).toHaveLength(2);
    expect(armedAttempts).toContain(winnerAttempt);
    expect(canceledAttempts).toHaveLength(1);
    expect(canceledAttempts).not.toContain(winnerAttempt);
    await assertStable(fixture, after);
  }, 60_000);

  it('consult-vs-respond commits exactly one winner message and the loser cannot undo it', async () => {
    const fixture = await seedClaimedNegotiation('consult-vs-respond');
    const restore = gateAtomicBoundary([
      'pauseClaimedNegotiationForConsultation',
      'transitionClaimedTaskToWorking',
    ]);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        fixture.service.consult(fixture.agent.id, fixture.owner, fixture.task.id, { disclosureSubject: 'availability' }),
        fixture.service.respond(fixture.agent.id, fixture.owner, fixture.task.id, turn('accept')),
      ]);
    } finally {
      restore();
    }

    expect(results!.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(results!.filter((result) => result.status === 'rejected')).toHaveLength(1);
    const after = await counts(fixture);
    expect(after.messages).toBe(2);
    expect(after.actions.filter((action) => action === 'ask_user' || action === 'accept')).toHaveLength(1);
    const persisted = await conversationDatabaseAdapter.getTask(fixture.task.id);
    if (persisted?.state === 'completed') expect(after.artifacts).toBe(1);
    else {
      expect(persisted?.state).toBe('input_required');
      expect(after.artifacts).toBe(0);
    }
    await expect(fixture.service.respond(fixture.agent.id, fixture.owner, fixture.task.id, turn('accept'))).rejects.toThrow();
    await assertStable(fixture, after);
  }, 60_000);

  it('consult-vs-claim-timeout commits one pause or one fallback completion', async () => {
    const fixture = await seedClaimedNegotiation('consult-vs-claim-timeout');
    let fallbackExecutions = 0;
    const claimTimeout = new NegotiationClaimTimeoutQueue({
      database: conversationDatabaseAdapter as never,
      invokeNegotiator: async () => {
        fallbackExecutions += 1;
        return turn('accept') as never;
      },
      rearm: async () => undefined,
    });
    const restore = gateAtomicBoundary([
      'pauseClaimedNegotiationForConsultation',
      'transitionClaimedTaskToWorking',
    ]);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        fixture.service.consult(fixture.agent.id, fixture.owner, fixture.task.id, { disclosureSubject: 'availability' }),
        claimTimeout.processJob('negotiation_claim_timeout', {
          negotiationId: fixture.task.id,
          turnNumber: 1,
          agentId: fixture.agent.id,
        }),
      ]);
    } finally {
      restore();
    }

    const consultWon = results![0].status === 'fulfilled';
    expect(fallbackExecutions).toBe(consultWon ? 0 : 1);
    const after = await counts(fixture);
    expect(after.messages).toBe(2);
    expect(after.actions.filter((action) => action === 'ask_user' || action === 'accept')).toHaveLength(1);
    expect(after.artifacts).toBe(consultWon ? 0 : 1);
    await claimTimeout.processJob('negotiation_claim_timeout', {
      negotiationId: fixture.task.id,
      turnNumber: 1,
      agentId: fixture.agent.id,
    });
    expect(fallbackExecutions).toBe(consultWon ? 0 : 1);
    await assertStable(fixture, after);
    await claimTimeout.close();
  }, 60_000);

  it('respond-vs-fallback commits one message/completion and stale delivery cannot execute again', async () => {
    const fixture = await seedClaimedNegotiation('respond-vs-fallback');
    let fallbackExecutions = 0;
    const claimTimeout = new NegotiationClaimTimeoutQueue({
      database: conversationDatabaseAdapter as never,
      invokeNegotiator: async () => {
        fallbackExecutions += 1;
        return turn('accept') as never;
      },
      rearm: async () => undefined,
    });
    const restore = gateAtomicBoundary([
      'transitionClaimedTaskToWorking',
      'transitionClaimedTaskToWorking',
    ]);
    let results: PromiseSettledResult<unknown>[];
    try {
      results = await Promise.allSettled([
        fixture.service.respond(fixture.agent.id, fixture.owner, fixture.task.id, turn('accept')),
        claimTimeout.processJob('negotiation_claim_timeout', {
          negotiationId: fixture.task.id,
          turnNumber: 1,
          agentId: fixture.agent.id,
        }),
      ]);
    } finally {
      restore();
    }

    const responseWon = results![0].status === 'fulfilled';
    expect(Number(responseWon) + fallbackExecutions).toBe(1);
    const after = await counts(fixture);
    expect(after.messages).toBe(2);
    expect(after.actions.filter((action) => action === 'accept')).toHaveLength(1);
    expect(after.artifacts).toBe(1);
    expect((await conversationDatabaseAdapter.getTask(fixture.task.id))?.state).toBe('completed');
    await claimTimeout.processJob('negotiation_claim_timeout', {
      negotiationId: fixture.task.id,
      turnNumber: 1,
      agentId: fixture.agent.id,
    });
    await expect(fixture.service.respond(fixture.agent.id, fixture.owner, fixture.task.id, turn('accept'))).rejects.toThrow();
    expect(fallbackExecutions).toBe(responseWon ? 0 : 1);
    await assertStable(fixture, after);
    await claimTimeout.close();
  }, 60_000);
});

describe('external consultation exact continuation E2E', () => {
  it.each(['answer', 'dismiss', 'expire'] as const)(
    '%s dispatches through Questioner and run-existing, executes the exact successor once, and deduplicates delivery',
    async (kind) => {
      await settleThroughContinuation(kind);
    },
    60_000,
  );
});
