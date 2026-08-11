import { config } from 'dotenv';
config({ path: '.env.test', override: true });
process.env.NEGOTIATION_ASK_USER_ENABLED = 'true';
process.env.QUESTIONER_ENABLED = 'true';
process.env.NEGOTIATION_CONSULTATION_POLICY_MODE = 'on';

import { afterAll, describe, expect, it as bunIt, mock } from 'bun:test';
import { randomUUID } from 'crypto';
import { eq, inArray, sql } from 'drizzle-orm';
import { settlePromiseOutcome, withMinimumDatabaseTestBudget } from '../src/lib/testing/database-test-budget';
import { taskRowBlockerPredicate } from './support/task-row-lock-evidence';

const it = withMinimumDatabaseTestBudget(bunIt, 60_000);

mock.module('../src/queues/negotiations/timeout.queue', () => ({
  negotiationTimeoutQueue: {
    cancelTimeout: async () => undefined,
    enqueueTimeout: async (
      negotiationId: string,
      turnNumber: number,
      delayMs: number,
      parkGeneration: string,
      continuation?: unknown,
    ) => {
      rearmCalls.push({ negotiationId, turnNumber, delayMs, parkGeneration, continuation });
      if (failRearm) throw new Error('injected queue delivery failure');
      return 'park-timeout';
    },
    enqueueAskUserExpiry: async () => 'expiry',
    cancelAskUserExpiry: async () => undefined,
  },
}));
mock.module('../src/queues/negotiations/claim-timeout.queue', () => ({
  negotiationClaimTimeoutQueue: {
    cancelTimeout: async () => undefined,
    enqueueTimeout: async () => 'claim-timeout',
  },
}));
mock.module('../src/queues/questioner.queue', () => ({
  questionerEnqueueIfEnabled: () => async () => undefined,
}));
mock.module('../src/adapters/negotiator-memory.retrieval.adapter', () => ({
  negotiatorMemoryRetrievalAdapter: { retrieveForNegotiation: async () => [] },
}));

const { NegotiationPollingService, ConflictError, UnauthorizedError } = await import('../src/services/negotiation-polling.service');
const { AgentRuntimeService } = await import('../src/services/agent-runtime.service');
const { HermesAuthorizationService } = await import('../src/services/hermes-authorization.service');
const { agentDatabaseAdapter } = await import('../src/adapters/agent.database.adapter');
const { HermesAuthorizationDatabaseAdapter } = await import('../src/adapters/hermes-authorization.database.adapter');
const { conversationDatabaseAdapter } = await import('../src/adapters/database.adapter');
const { HERMES_RESPONSE_ATOMIC_STEPS } = await import('../src/adapters/conversation.database.adapter');
const { claimParkedContinuationExecutionForTimeout } = await import('../src/adapters/negotiation-continuation.atomic');
const { default: db } = await import('../src/lib/drizzle/drizzle');
const { computeIntentFingerprint } = await import('../src/lib/intent/intent.fingerprint');
const { HERMES_CANONICAL_ACTIONS } = await import('../src/lib/agent/hermes-capabilities');
const { hashHermesSecret } = await import('../src/lib/agent/hermes-authorization');
const { resolveHermesAgentCredential } = await import('../src/guards/auth.guard');
const { AMBIENT_PARK_WINDOW_MS } = await import('@indexnetwork/protocol');
const schema = await import('../src/schemas/database.schema');

const fixtureTag = randomUUID();
const cleanupUsers: string[] = [];
const cleanupAuthorizations: string[] = [];
const cleanupConversations: string[] = [];
const cleanupNetworks: string[] = [];
const cleanupIntents: string[] = [];
const cleanupOpportunities: string[] = [];
const CONTROLLED_OLD_HEARTBEAT = new Date('2020-01-02T03:04:05.000Z');
const rearmCalls: Array<{
  negotiationId: string;
  turnNumber: number;
  delayMs: number;
  parkGeneration: string;
  continuation?: unknown;
}> = [];
let failRearm = false;

type RuntimeFixture = Awaited<ReturnType<typeof fixture>>;
type RuntimeInvalidation = 'deselect' | 'disconnect' | 'rotate';
type PickupBoundary = 'empty' | 'existing' | 'new';

async function prepareDedicatedRuntime(owner: string, label: string) {
  const runtime = new AgentRuntimeService(agentDatabaseAdapter);
  const authorization = new HermesAuthorizationService(new HermesAuthorizationDatabaseAdapter());
  const installationId = randomUUID();
  const state = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const verifier = Buffer.from(crypto.getRandomValues(new Uint8Array(32))).toString('base64url');
  const redirectUri = 'http://127.0.0.1:49152/callback';
  const request = await authorization.createAuthorization({
    installationId,
    redirectUri,
    state,
    codeChallenge: await hashHermesSecret(verifier),
    actions: HERMES_CANONICAL_ACTIONS,
  });
  cleanupAuthorizations.push(request.requestId);
  const approved = await authorization.approveAuthorization(owner, request.requestId, state, redirectUri);
  const exchange = await authorization.exchangeAuthorizationCode({
    requestId: request.requestId,
    code: approved.code,
    verifier,
    redirectUri,
  });
  expect(exchange.credential.startsWith('idxh_')).toBe(true);
  const pendingPrincipal = await authorization.authenticatePendingHermesCredential(exchange.credential);
  const active = await authorization.activatePendingHermesCredential(pendingPrincipal);
  await runtime.setRuntime(owner, {
    runtime: 'hermes',
    installationId,
    executorId: active.agentId,
    setupAttemptId: active.setupAttemptId,
  });
  const rawCredential = exchange.credential;
  const resolved = await resolveHermesAgentCredential(rawCredential);
  const credentialHash = await hashHermesSecret(rawCredential);
  const dedicatedRows = await db.select({
    id: schema.hermesAgentCredentials.id,
    actions: schema.hermesAgentCredentials.actions,
    activationState: schema.hermesAgentCredentials.activationState,
    hashMatchesRaw: sql<boolean>`${schema.hermesAgentCredentials.secretHash} = ${rawCredential}`,
  }).from(schema.hermesAgentCredentials)
    .where(eq(schema.hermesAgentCredentials.secretHash, credentialHash));
  const legacyRows = await db.select({ id: schema.apikeys.id })
    .from(schema.apikeys)
    .where(eq(schema.apikeys.key, credentialHash));
  expect(dedicatedRows).toHaveLength(1);
  expect(dedicatedRows[0]?.actions).toEqual(HERMES_CANONICAL_ACTIONS);
  expect(dedicatedRows[0]?.activationState).toBe('active');
  expect(dedicatedRows[0]?.hashMatchesRaw).toBe(false);
  expect(legacyRows).toHaveLength(0);
  expect(resolved.user.id).toBe(owner);
  expect(resolved.principal.actions).toEqual(HERMES_CANONICAL_ACTIONS);

  return {
    owner,
    runtime,
    installationId,
    setupAttemptId: active.setupAttemptId,
    prepared: {
      executorId: active.agentId,
      credential: { id: active.credentialId, expiresAt: active.expiresAt.toISOString() },
    },
    principal: resolved.principal,
    clock: { now: Date.now() },
    label,
  };
}

async function fixture(label: string) {
  const [owner, counterparty] = await Promise.all([label, `${label}-counterparty`].map(async (name) => {
    const [row] = await db.insert(schema.users).values({
      email: `runtime-authority-${fixtureTag}-${name}-${randomUUID()}@test.local`,
      name,
    }).returning({ id: schema.users.id });
    cleanupUsers.push(row.id);
    return row.id;
  }));
  const preparedRuntime = await prepareDedicatedRuntime(owner, label);
  const responseFault: { afterStep?: (step: typeof HERMES_RESPONSE_ATOMIC_STEPS[number]) => void | Promise<void> } = {};
  const service = new NegotiationPollingService(
    undefined,
    conversationDatabaseAdapter,
    {
      getTask: conversationDatabaseAdapter.getTask.bind(conversationDatabaseAdapter),
      getMessagesForConversation: conversationDatabaseAdapter.getMessagesForConversation.bind(conversationDatabaseAdapter),
      getPendingHermesResponseOutboxes: conversationDatabaseAdapter.getPendingHermesResponseOutboxes.bind(conversationDatabaseAdapter),
      getHermesResponseReplay: conversationDatabaseAdapter.getHermesResponseReplay.bind(conversationDatabaseAdapter),
      markHermesResponseOutboxDelivered: conversationDatabaseAdapter.markHermesResponseOutboxDelivered.bind(conversationDatabaseAdapter),
      respondHermesNegotiationAtomically: (input) => conversationDatabaseAdapter.respondHermesNegotiationAtomically({
        ...input,
        ...(responseFault.afterStep ? { faultAfterStep: responseFault.afterStep } : {}),
      }),
    },
    () => preparedRuntime.clock.now,
  );
  return { ...preparedRuntime, counterparty, service, responseFault };
}

async function pickup(value: RuntimeFixture, runId = randomUUID()) {
  return value.service.pickup(value.prepared.executorId, value.owner, value.principal, runId);
}

async function prepareRuntimeForUser(owner: string, label: string) {
  const preparedRuntime = await prepareDedicatedRuntime(owner, label);
  const service = new NegotiationPollingService(
    undefined,
    conversationDatabaseAdapter,
    conversationDatabaseAdapter,
    () => preparedRuntime.clock.now,
  );
  return { ...preparedRuntime, service };
}

async function seedWaitingTask(owner: string, counterparty: string) {
  const conversation = await conversationDatabaseAdapter.createConversation([
    { participantId: `agent:${owner}`, participantType: 'agent' },
    { participantId: `agent:${counterparty}`, participantType: 'agent' },
  ]);
  cleanupConversations.push(conversation.id);
  const task = await conversationDatabaseAdapter.createTask(conversation.id, {
    type: 'negotiation',
    sourceUserId: owner,
    candidateUserId: counterparty,
    maxTurns: 6,
  });
  await conversationDatabaseAdapter.updateTaskState(
    task.id,
    'waiting_for_agent',
    undefined,
    undefined,
    randomUUID(),
  );
  return task;
}

async function seedConsultableClaim(label: string) {
  const value = await fixture(label);
  const [network] = await db.insert(schema.networks).values({
    title: `Runtime authority ${fixtureTag} ${label} ${randomUUID()}`,
    description: 'isolated runtime authority fixture',
    isPersonal: false,
  }).returning({ id: schema.networks.id });
  cleanupNetworks.push(network.id);
  await db.insert(schema.networkMembers).values([
    { networkId: network.id, userId: value.owner, permissions: ['member'] },
    { networkId: network.id, userId: value.counterparty, permissions: ['member'] },
  ]);
  const [ownerIntent, counterpartyIntent] = await Promise.all([
    db.insert(schema.intents).values({ userId: value.owner, payload: 'Find a collaborator', status: 'ACTIVE' }).returning({ id: schema.intents.id }),
    db.insert(schema.intents).values({ userId: value.counterparty, payload: 'Offer collaboration', status: 'ACTIVE' }).returning({ id: schema.intents.id }),
  ]).then((rows) => [rows[0][0], rows[1][0]]);
  cleanupIntents.push(ownerIntent.id, counterpartyIntent.id);
  await db.insert(schema.intentNetworks).values([
    { intentId: ownerIntent.id, networkId: network.id },
    { intentId: counterpartyIntent.id, networkId: network.id },
  ]);
  const [opportunity] = await db.insert(schema.opportunities).values({
    detection: { kind: 'test', summary: 'runtime authority consultation' } as never,
    actors: [
      { userId: value.counterparty, intent: counterpartyIntent.id, networkId: network.id, role: 'peer' },
      { userId: value.owner, intent: ownerIntent.id, networkId: network.id, role: 'peer' },
    ] as never,
    interpretation: { reasoning: 'fixture', category: 'test' } as never,
    context: { networkId: network.id } as never,
    confidence: '0.9',
    status: 'negotiating',
  }).returning({ id: schema.opportunities.id });
  cleanupOpportunities.push(opportunity.id);
  const conversation = await conversationDatabaseAdapter.createConversation([
    { participantId: `agent:${value.owner}`, participantType: 'agent' },
    { participantId: `agent:${value.counterparty}`, participantType: 'agent' },
  ]);
  cleanupConversations.push(conversation.id);
  const task = await conversationDatabaseAdapter.createTask(conversation.id, {
    type: 'negotiation',
    protocolVersion: 'v2',
    sourceUserId: value.counterparty,
    candidateUserId: value.owner,
    initiatorUserId: value.counterparty,
    sourceIntentId: counterpartyIntent.id,
    candidateIntentId: ownerIntent.id,
    opportunityId: opportunity.id,
    networkId: network.id,
    maxTurns: 6,
    participantBindings: [
      { userId: value.counterparty, intentId: counterpartyIntent.id, networkId: network.id },
      { userId: value.owner, intentId: ownerIntent.id, networkId: network.id },
    ],
    turnContext: {
      sourceUser: { id: value.counterparty, profile: { name: 'Counterparty' }, intents: [] },
      candidateUser: { id: value.owner, profile: { name: 'Owner' }, intents: [] },
      indexContext: { networkId: network.id },
      seedAssessment: { reasoning: 'fixture' },
    },
  });
  await conversationDatabaseAdapter.createMessage({
    conversationId: conversation.id,
    taskId: task.id,
    senderId: `agent:${value.counterparty}`,
    role: 'agent',
    parts: [{ kind: 'data', data: {
      action: 'counter',
      message: null,
      assessment: { reasoning: 'counter', suggestedRoles: { ownUser: 'agent', otherUser: 'patient' } },
    } }],
  });
  await conversationDatabaseAdapter.updateTaskState(task.id, 'waiting_for_agent');
  const runId = randomUUID();
  const pickedUp = await value.service.pickup(
    value.prepared.executorId,
    value.owner,
    value.principal,
    runId,
  );
  expect(pickedUp).toMatchObject({ taskId: task.id, canConsultOwner: true });
  if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing dedicated run capability');
  return {
    ...value,
    task,
    conversation,
    network,
    opportunity,
    ownerIntent,
    counterpartyIntent,
    runId,
    runCapability: pickedUp.runCapability,
  };
}

async function seedClaimedContinuation(label: string) {
  const value = await seedConsultableClaim(label);
  const [opportunity] = await db.select({
    status: schema.opportunities.status,
    updatedAt: schema.opportunities.updatedAt,
  }).from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
  const [ownerIntent] = await db.select({
    payload: schema.intents.payload,
    summary: schema.intents.summary,
  }).from(schema.intents).where(eq(schema.intents.id, value.ownerIntent.id));
  if (!opportunity || !ownerIntent) throw new Error('Missing continuation fixture material');

  const settlementId = `settlement-${randomUUID()}`;
  const prior = await conversationDatabaseAdapter.getTask(value.task.id);
  if (!prior) throw new Error('Missing continuation prior task');
  const priorMetadata = prior.metadata ?? {};
  await db.update(schema.tasks).set({
    state: 'canceled',
    metadata: {
      ...priorMetadata,
      questionSettlement: {
        version: 1,
        settlementId,
        taskId: value.task.id,
        recipientUserId: value.owner,
        recipientIntentId: value.ownerIntent.id,
        opportunityId: value.opportunity.id,
        networkId: value.network.id,
        intentFingerprint: computeIntentFingerprint(ownerIntent.payload, ownerIntent.summary),
        opportunityStatus: opportunity.status,
        opportunityUpdatedAt: opportunity.updatedAt.toISOString(),
        counterpartyUserId: value.counterparty,
        counterpartyIntentId: value.counterpartyIntent.id,
        kind: 'timeout',
        continuationStatus: 'requested',
      },
    },
    updatedAt: new Date(),
  }).where(eq(schema.tasks.id, value.task.id));

  const successorTaskId = randomUUID();
  const now = new Date();
  await db.insert(schema.tasks).values({
    id: successorTaskId,
    conversationId: value.conversation.id,
    state: 'waiting_for_agent',
    metadata: {
      ...priorMetadata,
      isContinuation: true,
      resumeFromTaskId: value.task.id,
      continuationSettlementId: settlementId,
      continuationExecution: {
        version: 1,
        priorTaskId: value.task.id,
        settlementId,
        successorTaskId,
        token: randomUUID(),
        fence: 1,
        status: 'parked',
        leaseExpiresAt: now.toISOString(),
        claimedAt: now.toISOString(),
        heartbeatAt: now.toISOString(),
      },
    },
  });
  const runId = randomUUID();
  const pickedUp = await value.service.pickup(
    value.prepared.executorId,
    value.owner,
    value.principal,
    runId,
  );
  expect(pickedUp).toMatchObject({ taskId: successorTaskId });
  if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing continuation run capability');
  return {
    ...value,
    priorTaskId: value.task.id,
    successorTaskId,
    settlementId,
    runId,
    runCapability: pickedUp.runCapability,
  };
}

async function heartbeat(agentId: string): Promise<Date | null> {
  const [row] = await db.select({ value: schema.agents.lastNegotiationPickupAt })
    .from(schema.agents)
    .where(eq(schema.agents.id, agentId));
  return row?.value ?? null;
}

async function setHeartbeat(agentId: string, value: Date | null): Promise<void> {
  await db.update(schema.agents)
    .set({ lastNegotiationPickupAt: value })
    .where(eq(schema.agents.id, agentId));
}

async function taskState(taskId: string): Promise<{ state: string; claimedByAgentId: string | null }> {
  const [row] = await db.select({ state: schema.tasks.state, claimedByAgentId: schema.tasks.claimedByAgentId })
    .from(schema.tasks)
    .where(eq(schema.tasks.id, taskId));
  if (!row) throw new Error(`Missing task ${taskId}`);
  return row;
}

async function holdOwnerRuntimeLock(ownerId: string): Promise<{
  backendPid: number;
  release: () => void;
  done: Promise<void>;
}> {
  let acquired!: (backendPid: number) => void;
  let release!: () => void;
  const acquiredPromise = new Promise<number>((resolve) => { acquired = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const done = db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`agent-runtime:${ownerId}`}, 0))`);
    const rows = await tx.execute(sql`SELECT pg_backend_pid()::int AS pid`);
    acquired(Number((rows as unknown as Array<{ pid: number }>)[0]?.pid));
    await releasePromise;
  });
  return { backendPid: await acquiredPromise, release, done };
}

async function waitForOwnerRuntimeWaiters(holderPid: number, expected: number): Promise<number[]> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await db.execute(sql`
      SELECT DISTINCT waiter.pid AS pid
      FROM pg_locks holder
      JOIN pg_locks waiter
        ON waiter.locktype = holder.locktype
       AND waiter.database IS NOT DISTINCT FROM holder.database
       AND waiter.classid IS NOT DISTINCT FROM holder.classid
       AND waiter.objid IS NOT DISTINCT FROM holder.objid
       AND waiter.objsubid IS NOT DISTINCT FROM holder.objsubid
      WHERE holder.pid = ${holderPid}
        AND holder.locktype = 'advisory'
        AND holder.granted = true
        AND waiter.pid <> holder.pid
        AND waiter.granted = false
      ORDER BY waiter.pid
    `);
    const waiterPids = (rows as unknown as Array<{ pid: number }>).map((row) => Number(row.pid));
    if (waiterPids.length >= expected) return waiterPids;
    // Cadence only: pg_locks rows, not elapsed time, are the synchronization evidence.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} owner-runtime lock waiter(s) behind backend ${holderPid}`);
}

async function holdTaskRowLock(taskId: string, claimOnReleaseByAgentId?: string): Promise<{
  backendPid: number;
  release: () => void;
  done: Promise<void>;
}> {
  let acquired!: (backendPid: number) => void;
  let release!: () => void;
  const acquiredPromise = new Promise<number>((resolve) => { acquired = resolve; });
  const releasePromise = new Promise<void>((resolve) => { release = resolve; });
  const done = db.transaction(async (tx) => {
    await tx.select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .for('update');
    const rows = await tx.execute(sql`SELECT pg_backend_pid()::int AS pid`);
    acquired(Number((rows as unknown as Array<{ pid: number }>)[0]?.pid));
    await releasePromise;
    if (claimOnReleaseByAgentId) {
      await tx.update(schema.tasks).set({
        state: 'claimed',
        claimedByAgentId: claimOnReleaseByAgentId,
        claimedAt: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId));
    }
  });
  return { backendPid: await acquiredPromise, release, done };
}

async function waitForTaskRowWaiters(
  holderPid: number,
  expected: number,
  earlierWaiterPids: number[] = [],
): Promise<Array<{ pid: number; blockerPids: number[]; state: string; waitEventType: string }>> {
  const deadline = Date.now() + 5_000;
  const knownBlockers = [holderPid, ...earlierWaiterPids];
  while (Date.now() < deadline) {
    const rows = await db.execute(sql`
      SELECT
        activity.pid::int AS pid,
        pg_blocking_pids(activity.pid)::int[] AS "blockerPids",
        activity.state,
        activity.wait_event_type AS "waitEventType"
      FROM pg_stat_activity activity
      WHERE activity.pid <> pg_backend_pid()
        AND activity.state = 'active'
        AND activity.wait_event_type = 'Lock'
        AND ${taskRowBlockerPredicate(knownBlockers)}
      ORDER BY activity.query_start, activity.pid
    `);
    const evidence = (rows as unknown as Array<{
      pid: number;
      blockerPids: number[];
      state: string;
      waitEventType: string;
    }>).map((row) => ({
      pid: Number(row.pid),
      blockerPids: row.blockerPids.map(Number),
      state: row.state,
      waitEventType: row.waitEventType,
    }));
    if (evidence.length >= expected) return evidence;
    // Cadence only: PostgreSQL's blocking graph is the synchronization evidence.
    await new Promise<void>((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${expected} task-row waiter(s) behind backend ${holderPid}`);
}

async function invalidateRuntime(value: RuntimeFixture, race: RuntimeInvalidation): Promise<unknown> {
  if (race === 'deselect') return value.runtime.setRuntime(value.owner, { runtime: 'index' });
  if (race === 'disconnect') return value.runtime.disconnectHermes(value.owner, value.installationId);
  return value.runtime.prepareHermes(value.owner, value.installationId, randomUUID());
}

async function queueInvalidationBeforeContender<T>(
  value: RuntimeFixture,
  race: RuntimeInvalidation,
  contender: () => Promise<T>,
): Promise<{ invalidation: unknown; contender: PromiseSettledResult<T> }> {
  const held = await holdOwnerRuntimeLock(value.owner);
  const invalidationPromise = invalidateRuntime(value, race);
  try {
    await waitForOwnerRuntimeWaiters(held.backendPid, 1);
    const contenderOutcome = settlePromiseOutcome(contender());
    await waitForOwnerRuntimeWaiters(held.backendPid, 2);
    held.release();
    await held.done;
    return { invalidation: await invalidationPromise, contender: await contenderOutcome };
  } catch (error) {
    held.release();
    await held.done.catch(() => undefined);
    await invalidationPromise.catch(() => undefined);
    throw error;
  }
}

afterAll(async () => {
  const cleanupErrors: unknown[] = [];
  const capture = async (operation: () => Promise<unknown>) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };

  for (const id of cleanupConversations) {
    await capture(() => conversationDatabaseAdapter.deleteConversation(id));
  }
  if (cleanupAuthorizations.length) {
    await capture(() => db.delete(schema.hermesAuthorizations)
      .where(inArray(schema.hermesAuthorizations.requestId, cleanupAuthorizations)));
  }
  for (const id of cleanupOpportunities) {
    await capture(() => db.delete(schema.opportunities).where(eq(schema.opportunities.id, id)));
  }
  if (cleanupNetworks.length) {
    await capture(() => db.delete(schema.intentNetworks)
      .where(inArray(schema.intentNetworks.networkId, cleanupNetworks)));
    await capture(() => db.delete(schema.networkMembers)
      .where(inArray(schema.networkMembers.networkId, cleanupNetworks)));
  }
  if (cleanupIntents.length) {
    await capture(() => db.delete(schema.intents).where(inArray(schema.intents.id, cleanupIntents)));
  }
  for (const id of cleanupNetworks) {
    await capture(() => db.delete(schema.networks).where(eq(schema.networks.id, id)));
  }
  for (const id of cleanupUsers) {
    await capture(() => db.delete(schema.users).where(eq(schema.users.id, id)));
  }
  await capture(async () => {
    const rows = await db.execute(sql`
      SELECT (
        (SELECT count(*) FROM users WHERE email LIKE ${`runtime-authority-${fixtureTag}-%`})
        + (SELECT count(*) FROM networks WHERE title LIKE ${`Runtime authority ${fixtureTag} %`})
      )::int AS count
    `);
    const remainingAuthorizations = cleanupAuthorizations.length
      ? await db.select({ id: schema.hermesAuthorizations.requestId })
        .from(schema.hermesAuthorizations)
        .where(inArray(schema.hermesAuthorizations.requestId, cleanupAuthorizations))
      : [];
    const [remainingNetworkMembers, remainingIntentNetworks, remainingIntents] = await Promise.all([
      cleanupNetworks.length
        ? db.select({ id: schema.networkMembers.userId }).from(schema.networkMembers)
          .where(inArray(schema.networkMembers.networkId, cleanupNetworks))
        : [],
      cleanupNetworks.length
        ? db.select({ id: schema.intentNetworks.intentId }).from(schema.intentNetworks)
          .where(inArray(schema.intentNetworks.networkId, cleanupNetworks))
        : [],
      cleanupIntents.length
        ? db.select({ id: schema.intents.id }).from(schema.intents)
          .where(inArray(schema.intents.id, cleanupIntents))
        : [],
    ]);
    if (
      Number((rows as unknown as Array<{ count: number }>)[0]?.count ?? 0) !== 0
      || remainingAuthorizations.length !== 0
      || remainingNetworkMembers.length !== 0
      || remainingIntentNetworks.length !== 0
      || remainingIntents.length !== 0
    ) {
      throw new Error('Negotiation authority fixture rows remain after cleanup');
    }
  });
  mock.restore();
  if (cleanupErrors.length) {
    throw new AggregateError(cleanupErrors, 'Negotiation authority fixture cleanup failed');
  }
});

describe('real negotiation runtime authority SQL seam', () => {
  it('lets only the authoritative opening speaker win simultaneous two-participant polls and heartbeat', async () => {
    const source = await fixture('speaker-opening-source');
    const counterparty = await prepareRuntimeForUser(source.counterparty, 'speaker-opening-counterparty');
    const task = await seedWaitingTask(source.owner, source.counterparty);
    await Promise.all([
      setHeartbeat(source.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
      setHeartbeat(counterparty.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
    ]);

    const [sourceResult, counterpartyResult] = await Promise.all([
      source.service.pickup(source.prepared.executorId, source.owner, source.principal, randomUUID()),
      counterparty.service.pickup(counterparty.prepared.executorId, counterparty.owner, counterparty.principal, randomUUID()),
    ]);

    expect(sourceResult).toMatchObject({ taskId: task.id });
    expect(counterpartyResult).toBeNull();
    expect((await heartbeat(source.prepared.executorId))!.getTime()).toBeGreaterThan(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect((await heartbeat(counterparty.prepared.executorId))!.getTime()).toBe(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect(await taskState(task.id)).toMatchObject({ state: 'claimed', claimedByAgentId: source.prepared.executorId });
  });

  it('moves the pickup fence to the other participant after a continuation turn under simultaneous polls', async () => {
    const source = await fixture('speaker-continuation-source');
    const counterparty = await prepareRuntimeForUser(source.counterparty, 'speaker-continuation-counterparty');
    const task = await seedWaitingTask(source.owner, source.counterparty);
    const runId = randomUUID();
    const opening = await source.service.pickup(
      source.prepared.executorId, source.owner, source.principal, runId,
    );
    if (!opening || !('runCapability' in opening)) throw new Error('Missing opening run capability');
    await source.service.respondHermes(
      source.prepared.executorId,
      source.owner,
      task.id,
      { action: 'continue', roleAlignment: 'peers' },
      source.principal,
      { runId, capability: opening.runCapability, outcome: 'responded' },
    );
    await Promise.all([
      setHeartbeat(source.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
      setHeartbeat(counterparty.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
    ]);

    const [sourceResult, counterpartyResult] = await Promise.all([
      source.service.pickup(source.prepared.executorId, source.owner, source.principal, randomUUID()),
      counterparty.service.pickup(counterparty.prepared.executorId, counterparty.owner, counterparty.principal, randomUUID()),
    ]);

    expect(sourceResult).toBeNull();
    expect(counterpartyResult).toMatchObject({ taskId: task.id });
    expect((await heartbeat(source.prepared.executorId))!.getTime()).toBe(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect((await heartbeat(counterparty.prepared.executorId))!.getTime()).toBeGreaterThan(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect(await taskState(task.id)).toMatchObject({ state: 'claimed', claimedByAgentId: counterparty.prepared.executorId });
  });

  it('queues the non-speaker before the eligible waiter on the exact continuation task row', async () => {
    const source = await fixture('speaker-row-lock-source');
    const counterparty = await prepareRuntimeForUser(source.counterparty, 'speaker-row-lock-counterparty');
    const task = await seedWaitingTask(source.owner, source.counterparty);
    const runId = randomUUID();
    const opening = await source.service.pickup(
      source.prepared.executorId, source.owner, source.principal, runId,
    );
    if (!opening || !('runCapability' in opening)) throw new Error('Missing opening run capability');
    await source.service.respondHermes(
      source.prepared.executorId,
      source.owner,
      task.id,
      { action: 'continue', roleAlignment: 'peers' },
      source.principal,
      { runId, capability: opening.runCapability, outcome: 'responded' },
    );
    await Promise.all([
      setHeartbeat(source.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
      setHeartbeat(counterparty.prepared.executorId, CONTROLLED_OLD_HEARTBEAT),
    ]);

    const held = await holdTaskRowLock(task.id);
    const sourceOutcome = settlePromiseOutcome(source.service.pickup(
      source.prepared.executorId, source.owner, source.principal, randomUUID(),
    ));
    let counterpartyOutcome: Promise<PromiseSettledResult<Awaited<ReturnType<typeof pickup>>>> | undefined;
    try {
      const sourceWaiters = await waitForTaskRowWaiters(held.backendPid, 1);
      expect(sourceWaiters).toHaveLength(1);
      expect(sourceWaiters[0]).toMatchObject({ state: 'active', waitEventType: 'Lock' });

      counterpartyOutcome = settlePromiseOutcome(counterparty.service.pickup(
        counterparty.prepared.executorId,
        counterparty.owner,
        counterparty.principal,
        randomUUID(),
      ));
      const bothWaiters = await waitForTaskRowWaiters(
        held.backendPid,
        2,
        sourceWaiters.map(({ pid }) => pid),
      );
      expect(bothWaiters.map(({ pid }) => pid)).toContain(sourceWaiters[0]!.pid);
      expect(new Set(bothWaiters.map(({ pid }) => pid)).size).toBe(2);
      expect(bothWaiters.every(({ blockerPids }) => blockerPids.length > 0)).toBe(true);
    } finally {
      held.release();
      await held.done;
    }

    const [sourceResult, counterpartyResult] = await Promise.all([
      sourceOutcome,
      counterpartyOutcome ?? Promise.reject(new Error('Eligible waiter did not start')),
    ]);
    expect(sourceResult).toEqual({ status: 'fulfilled', value: null });
    expect(counterpartyResult.status).toBe('fulfilled');
    if (counterpartyResult.status !== 'fulfilled') throw counterpartyResult.reason;
    expect(counterpartyResult.value).toMatchObject({ taskId: task.id });
    expect((await heartbeat(source.prepared.executorId))!.getTime()).toBe(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect((await heartbeat(counterparty.prepared.executorId))!.getTime()).toBeGreaterThan(CONTROLLED_OLD_HEARTBEAT.getTime());
    expect(await taskState(task.id)).toEqual({
      state: 'claimed',
      claimedByAgentId: counterparty.prepared.executorId,
    });
  });

  it('continues to the next eligible task after an older row-lock contender commits a claim', async () => {
    const value = await fixture('pickup-multiple-task-contention');
    const counterparty = await prepareRuntimeForUser(value.counterparty, 'pickup-multiple-task-contender');
    const [olderTask, newerTask] = await Promise.all([
      seedWaitingTask(value.owner, value.counterparty),
      seedWaitingTask(value.owner, value.counterparty),
    ]);
    await Promise.all([
      db.update(schema.tasks).set({ createdAt: new Date('2020-01-01T00:00:00.000Z') })
        .where(eq(schema.tasks.id, olderTask.id)),
      db.update(schema.tasks).set({ createdAt: new Date('2020-01-01T00:00:01.000Z') })
        .where(eq(schema.tasks.id, newerTask.id)),
    ]);

    const held = await holdTaskRowLock(olderTask.id, counterparty.prepared.executorId);
    const pickupOutcome = settlePromiseOutcome(pickup(value));
    try {
      const evidence = await waitForTaskRowWaiters(held.backendPid, 1);
      expect(evidence[0]).toMatchObject({ state: 'active', waitEventType: 'Lock' });
      expect(await taskState(newerTask.id)).toEqual({ state: 'waiting_for_agent', claimedByAgentId: null });
    } finally {
      held.release();
      await held.done;
    }

    const result = await pickupOutcome;
    expect(result.status).toBe('fulfilled');
    if (result.status !== 'fulfilled') throw result.reason;
    expect(result.value).toMatchObject({ taskId: newerTask.id });
    expect(await taskState(olderTask.id)).toEqual({
      state: 'claimed',
      claimedByAgentId: counterparty.prepared.executorId,
    });
    expect(await taskState(newerTask.id)).toEqual({
      state: 'claimed',
      claimedByAgentId: value.prepared.executorId,
    });
  });

  it('strictly refreshes a controlled old heartbeat on existing-claim pickup', async () => {
    const value = await fixture('existing-heartbeat');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    await expect(pickup(value)).resolves.toMatchObject({ taskId: task.id });
    await setHeartbeat(value.prepared.executorId, CONTROLLED_OLD_HEARTBEAT);

    await expect(pickup(value)).resolves.toMatchObject({ taskId: task.id });

    expect((await heartbeat(value.prepared.executorId))!.getTime())
      .toBeGreaterThan(CONTROLLED_OLD_HEARTBEAT.getTime());
  });

  it('preserves the original park-start deadline across a repeated existing-claim pickup', async () => {
    const value = await fixture('existing-deadline');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    const controlledParkOrigin = new Date(value.clock.now - 60_000);
    await db.update(schema.tasks).set({
      metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object(
        'hermesParkStartedAt', ${controlledParkOrigin.toISOString()}::text
      )`,
      updatedAt: controlledParkOrigin,
    }).where(eq(schema.tasks.id, task.id));

    const first = await pickup(value);
    const repeated = await pickup(value);
    if (!first || !repeated) throw new Error('Expected claimed pickup results');
    const expectedDeadline = new Date(controlledParkOrigin.getTime() + AMBIENT_PARK_WINDOW_MS).toISOString();
    expect(first.turn.deadline).toBe(expectedDeadline);
    expect(repeated.turn.deadline).toBe(expectedDeadline);
    expect(repeated.taskId).toBe(task.id);
  });

  const pickupLockBoundaries = ['existing', 'new'] as const;
  for (const boundary of pickupLockBoundaries) {
    it(`holds the real ${boundary}-claim pickup outcome and heartbeat behind the owner advisory lock`, async () => {
      const value = await fixture(`barrier-${boundary}`);
      const task = await seedWaitingTask(value.owner, value.counterparty);
      if (boundary === 'existing') {
        await pickup(value);
        await setHeartbeat(value.prepared.executorId, CONTROLLED_OLD_HEARTBEAT);
      }
      const before = await taskState(task.id);
      const held = await holdOwnerRuntimeLock(value.owner);
      const pickupAttempt = pickup(value);
      try {
        await waitForOwnerRuntimeWaiters(held.backendPid, 1);
        expect(await taskState(task.id)).toEqual(before);
        expect(await heartbeat(value.prepared.executorId)).toEqual(
          boundary === 'existing' ? CONTROLLED_OLD_HEARTBEAT : null,
        );
      } finally {
        held.release();
        await held.done;
      }

      await expect(pickupAttempt).resolves.toMatchObject({ taskId: task.id });
      expect(await taskState(task.id)).toEqual({
        state: 'claimed',
        claimedByAgentId: value.prepared.executorId,
      });
      expect((await heartbeat(value.prepared.executorId))!.getTime()).toBeGreaterThan(
        boundary === 'existing' ? CONTROLLED_OLD_HEARTBEAT.getTime() : 0,
      );
    });
  }

  for (const boundary of ['empty', 'existing', 'new'] as const satisfies readonly PickupBoundary[]) {
    for (const race of ['deselect', 'disconnect', 'rotate'] as const satisfies readonly RuntimeInvalidation[]) {
      it(`rejects ${boundary} pickup when real ${race} is queued first on the owner advisory lock`, async () => {
        const value = await fixture(`pickup-${boundary}-${race}`);
        const task = boundary === 'empty' ? null : await seedWaitingTask(value.owner, value.counterparty);
        if (boundary === 'existing') {
          await pickup(value);
          await setHeartbeat(value.prepared.executorId, CONTROLLED_OLD_HEARTBEAT);
        }
        const raced = await queueInvalidationBeforeContender(value, race, () => pickup(value));

        expect(raced.invalidation).toBeDefined();
        expect(raced.contender.status).toBe('rejected');
        if (raced.contender.status !== 'rejected') throw new Error('Expected pickup rejection');
        expect(raced.contender.reason).toBeInstanceOf(UnauthorizedError);
        expect(await heartbeat(value.prepared.executorId)).toEqual(
          boundary === 'existing' ? CONTROLLED_OLD_HEARTBEAT : null,
        );
        if (task) {
          expect(await taskState(task.id)).toEqual(boundary === 'existing'
            ? { state: 'claimed', claimedByAgentId: value.prepared.executorId }
            : { state: 'waiting_for_agent', claimedByAgentId: null });
        }
      });
    }
  }

  for (const race of ['deselect', 'disconnect', 'rotate'] as const satisfies readonly RuntimeInvalidation[]) {
    it(`rejects respond at its real transition transaction when ${race} invalidates the current generation first`, async () => {
      const value = await fixture(`respond-${race}`);
      const task = await seedWaitingTask(value.owner, value.counterparty);
      const runId = randomUUID();
      const pickedUp = await pickup(value, runId);
      if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing dedicated run capability');
      const messagesBefore = await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId);
      const raced = await queueInvalidationBeforeContender(value, race, () => value.service.respondHermes(
        value.prepared.executorId,
        value.owner,
        task.id,
        { action: 'decline', roleAlignment: 'peers' },
        value.principal,
        { runId, capability: pickedUp.runCapability, outcome: 'responded' },
      ));

      expect(raced.invalidation).toBeDefined();
      expect(raced.contender.status).toBe('rejected');
      if (raced.contender.status !== 'rejected') throw new Error('Expected respond rejection');
      expect(raced.contender.reason).toBeInstanceOf(UnauthorizedError);
      expect(await taskState(task.id)).toEqual({ state: 'claimed', claimedByAgentId: value.prepared.executorId });
      expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(messagesBefore.length);
    });

    it(`rejects consult at its real pause transaction when ${race} invalidates the current generation first`, async () => {
      const value = await seedConsultableClaim(`consult-${race}`);
      const messagesBefore = await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id);
      const raced = await queueInvalidationBeforeContender(value, race, () => value.service.consult(
        value.prepared.executorId,
        value.owner,
        value.task.id,
        { reason: 'consequential_disclosure_permission' },
        value.principal,
        { runId: value.runId, capability: value.runCapability, outcome: 'consulted' },
      ));

      expect(raced.invalidation).toBeDefined();
      expect(raced.contender.status).toBe('rejected');
      if (raced.contender.status !== 'rejected') throw new Error('Expected consult rejection');
      expect(raced.contender.reason).toBeInstanceOf(ConflictError);
      expect(await taskState(value.task.id)).toEqual({ state: 'claimed', claimedByAgentId: value.prepared.executorId });
      expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(messagesBefore.length);
    });
  }

  it('enforces one pickup per run and makes concurrent exact capability consumption replay-safe', async () => {
    const value = await fixture('run-capability');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    const runId = randomUUID();
    const pickedUp = await pickup(value, runId);
    if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing dedicated run capability');

    await expect(pickup(value, runId)).rejects.toBeInstanceOf(ConflictError);
    const authority = { runId, capability: pickedUp.runCapability, outcome: 'responded' as const };
    const results = await Promise.all([
      value.service.respondHermes(
        value.prepared.executorId, value.owner, task.id,
        { action: 'continue', roleAlignment: 'peers' }, value.principal, authority,
      ),
      value.service.respondHermes(
        value.prepared.executorId, value.owner, task.id,
        { action: 'continue', roleAlignment: 'peers' }, value.principal, authority,
      ),
    ]);

    expect(results).toEqual([{ success: true }, { success: true }]);
    expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(1);
  });

  it('returns a retryable pending outbox failure and a fresh pickup repairs queue delivery', async () => {
    const value = await fixture('response-outbox-repair');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    const runId = randomUUID();
    const pickedUp = await pickup(value, runId);
    if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing dedicated run capability');
    const authority = { runId, capability: pickedUp.runCapability, outcome: 'responded' as const };
    rearmCalls.length = 0;
    failRearm = true;

    await expect(value.service.respondHermes(
      value.prepared.executorId, value.owner, task.id,
      { action: 'request_time', roleAlignment: 'peers' }, value.principal, authority,
    )).rejects.toThrow('injected queue delivery failure');
    expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(1);
    expect(rearmCalls).toHaveLength(1);
    const failedEnqueue = rearmCalls[0];
    const pending = await conversationDatabaseAdapter.getTask(task.id);
    const pendingOutbox = (pending?.metadata as Record<string, Record<string, unknown>>).hermesResponseOutbox;
    const pendingQueueIntent = pendingOutbox.queueIntent as Record<string, Record<string, unknown>>;
    const pendingRearm = pendingQueueIntent.rearmParkTimeout;
    const deadlineAt = String(pendingRearm.deadlineAt);
    expect(pendingOutbox.deliveredAt).toBeUndefined();

    failRearm = false;
    value.clock.now = Date.parse(String(pendingOutbox.createdAt)) + 60_000;
    const expectedDelay = Math.max(0, Date.parse(deadlineAt) - value.clock.now);
    // A later pickup session repairs by exact current agent/owner scope without
    // retaining or replaying the old raw response capability.
    await value.service.pickup(
      value.prepared.executorId,
      value.owner,
      value.principal,
      randomUUID(),
    );
    expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(1);
    expect(rearmCalls).toEqual([
      failedEnqueue,
      {
        negotiationId: task.id,
        turnNumber: pendingRearm.turnNumber,
        delayMs: expectedDelay,
        parkGeneration: pendingRearm.parkGeneration,
        continuation: pendingRearm.continuation,
      },
    ]);
    const delivered = await conversationDatabaseAdapter.getTask(task.id);
    const deliveredOutbox = (delivered?.metadata as Record<string, Record<string, unknown>>).hermesResponseOutbox;
    const deliveredQueueIntent = deliveredOutbox.queueIntent as Record<string, Record<string, unknown>>;
    expect(typeof deliveredOutbox.deliveredAt).toBe('string');
    expect(deliveredQueueIntent.rearmParkTimeout.deadlineAt).toBe(deadlineAt);
  });

  it('parks the exact continuation fence atomically on a continue/request-time response', async () => {
    const value = await seedClaimedContinuation('continuation-park');
    const authority = { runId: value.runId, capability: value.runCapability, outcome: 'responded' as const };

    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'request_time', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).resolves.toEqual({ success: true });

    const successor = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const prior = await conversationDatabaseAdapter.getTask(value.priorTaskId);
    expect(successor?.state).toBe('waiting_for_agent');
    expect(((successor?.metadata as Record<string, Record<string, unknown>>).continuationExecution).status).toBe('parked');
    expect(((prior?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus).toBe('requested');
    expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(2);
  });

  it('completes the exact continuation settlement atomically with terminal artifact and opportunity', async () => {
    const value = await seedClaimedContinuation('continuation-complete');
    const authority = { runId: value.runId, capability: value.runCapability, outcome: 'responded' as const };

    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'decline', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).resolves.toEqual({ success: true });

    const successor = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const prior = await conversationDatabaseAdapter.getTask(value.priorTaskId);
    const [opportunity] = await db.select({ status: schema.opportunities.status })
      .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
    expect(successor?.state).toBe('completed');
    expect(((successor?.metadata as Record<string, Record<string, unknown>>).continuationExecution).status).toBe('completed');
    expect(((prior?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus).toBe('completed');
    expect(opportunity.status).toBe('rejected');
    expect(await conversationDatabaseAdapter.getArtifacts(value.successorTaskId)).toHaveLength(1);
  });

  it('rolls back real continuation completion when faulted after the continuation boundary', async () => {
    const value = await seedClaimedContinuation('continuation-fault');
    const authority = { runId: value.runId, capability: value.runCapability, outcome: 'responded' as const };
    const beforeMessages = await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id);
    value.responseFault.afterStep = (step) => {
      if (step === 'continuation') throw new Error('injected real continuation fault');
    };

    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'decline', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).rejects.toThrow('injected real continuation fault');

    const successor = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const prior = await conversationDatabaseAdapter.getTask(value.priorTaskId);
    const [opportunity] = await db.select({ status: schema.opportunities.status })
      .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
    expect(successor?.state).toBe('claimed');
    expect(((successor?.metadata as Record<string, Record<string, unknown>>).continuationExecution).status).toBe('claimed');
    expect(((successor?.metadata as Record<string, Record<string, unknown>>).hermesRunCapability).consumedAt).toBeUndefined();
    expect(((prior?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus).toBe('requested');
    expect(opportunity.status).toBe('negotiating');
    expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(beforeMessages.length);
    expect(await conversationDatabaseAdapter.getArtifacts(value.successorTaskId)).toHaveLength(0);

    value.responseFault.afterStep = undefined;
    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'decline', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).resolves.toEqual({ success: true });
  });

  for (const step of HERMES_RESPONSE_ATOMIC_STEPS) {
    it(`rolls back every response effect after an injected ${step} boundary fault, then exact-retries`, async () => {
      // A terminal continuation makes message/task/artifact/opportunity and the
      // real continuation settlement meaningful before receipt/outbox commit.
      const value = await seedClaimedContinuation(`fault-${step}`);
      const authority = {
        runId: value.runId,
        capability: value.runCapability,
        outcome: 'responded' as const,
      };
      const beforeMessages = await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id);
      const beforeSessions = await db.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions).where(eq(schema.conversationSessions.taskId, value.successorTaskId));
      const [beforeOpportunity] = await db.select({ status: schema.opportunities.status })
        .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
      value.responseFault.afterStep = (candidate) => {
        if (candidate === step) throw new Error(`injected response fault after ${step}`);
      };

      await expect(value.service.respondHermes(
        value.prepared.executorId,
        value.owner,
        value.successorTaskId,
        { action: 'decline', roleAlignment: 'peers' },
        value.principal,
        authority,
      )).rejects.toThrow(`injected response fault after ${step}`);

      expect(await taskState(value.successorTaskId)).toEqual({ state: 'claimed', claimedByAgentId: value.prepared.executorId });
      expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(beforeMessages.length);
      expect(await db.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions).where(eq(schema.conversationSessions.taskId, value.successorTaskId)))
        .toEqual(beforeSessions);
      expect(await conversationDatabaseAdapter.getArtifacts(value.successorTaskId)).toHaveLength(0);
      const rolledBack = await conversationDatabaseAdapter.getTask(value.successorTaskId);
      const rolledBackMetadata = rolledBack?.metadata as Record<string, Record<string, unknown>>;
      expect(rolledBackMetadata.hermesRunCapability.consumedAt).toBeUndefined();
      expect(rolledBackMetadata.hermesResponseReceipt).toBeUndefined();
      expect(rolledBackMetadata.hermesResponseOutbox).toBeUndefined();
      expect(rolledBackMetadata.continuationExecution.status).toBe('claimed');
      const priorAfterFault = await conversationDatabaseAdapter.getTask(value.priorTaskId);
      expect(((priorAfterFault?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus)
        .toBe('requested');
      const [opportunityAfterFault] = await db.select({ status: schema.opportunities.status })
        .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
      expect(opportunityAfterFault.status).toBe(beforeOpportunity.status);

      value.responseFault.afterStep = undefined;
      await expect(value.service.respondHermes(
        value.prepared.executorId,
        value.owner,
        value.successorTaskId,
        { action: 'decline', roleAlignment: 'peers' },
        value.principal,
        authority,
      )).resolves.toEqual({ success: true });
      const committed = await conversationDatabaseAdapter.getTask(value.successorTaskId);
      const committedMetadata = committed?.metadata as Record<string, Record<string, unknown>>;
      const committedReceipt = structuredClone(committedMetadata.hermesResponseReceipt);
      const committedOutbox = structuredClone(committedMetadata.hermesResponseOutbox);
      expect(committedReceipt.receiptId).toBe(committedOutbox.receiptId);

      await expect(value.service.respondHermes(
        value.prepared.executorId,
        value.owner,
        value.successorTaskId,
        { action: 'decline', roleAlignment: 'peers' },
        value.principal,
        authority,
      )).resolves.toEqual({ success: true });
      const replayed = await conversationDatabaseAdapter.getTask(value.successorTaskId);
      const replayedMetadata = replayed?.metadata as Record<string, Record<string, unknown>>;
      expect(replayedMetadata.hermesResponseReceipt).toEqual(committedReceipt);
      expect(replayedMetadata.hermesResponseOutbox).toEqual(committedOutbox);
      expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(beforeMessages.length + 1);
      expect(await conversationDatabaseAdapter.getArtifacts(value.successorTaskId)).toHaveLength(1);
      expect(await db.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions).where(eq(schema.conversationSessions.taskId, value.successorTaskId)))
        .toHaveLength(1);
      expect(replayedMetadata.continuationExecution.status).toBe('completed');
      const priorAfterRetry = await conversationDatabaseAdapter.getTask(value.priorTaskId);
      expect(((priorAfterRetry?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus)
        .toBe('completed');
      const [opportunityAfterRetry] = await db.select({ status: schema.opportunities.status })
        .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
      expect(opportunityAfterRetry.status).toBe('rejected');
    });
  }

  it('keeps exactly one committed receipt/outbox and the first absolute continuation deadline on exact replay', async () => {
    const value = await seedClaimedContinuation('response-absolute-deadline');
    const authority = {
      runId: value.runId,
      capability: value.runCapability,
      outcome: 'responded' as const,
    };
    const beforeMessages = await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id);

    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'request_time', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).resolves.toEqual({ success: true });
    const committed = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const committedMetadata = committed?.metadata as Record<string, Record<string, unknown>>;
    const receipt = structuredClone(committedMetadata.hermesResponseReceipt);
    const outbox = structuredClone(committedMetadata.hermesResponseOutbox);
    const queueIntent = outbox.queueIntent as Record<string, Record<string, unknown>>;
    const deadlineAt = queueIntent.rearmParkTimeout.deadlineAt;
    expect(typeof deadlineAt).toBe('string');
    expect(new Date(String(deadlineAt)).getTime()).toBeGreaterThan(new Date(String(outbox.createdAt)).getTime());

    await expect(value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'request_time', roleAlignment: 'peers' },
      value.principal,
      authority,
    )).resolves.toEqual({ success: true });
    const replayed = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const replayedMetadata = replayed?.metadata as Record<string, Record<string, unknown>>;
    expect(replayedMetadata.hermesResponseReceipt).toEqual(receipt);
    expect(replayedMetadata.hermesResponseOutbox).toEqual(outbox);
    expect((((replayedMetadata.hermesResponseOutbox.queueIntent as Record<string, Record<string, unknown>>)
      .rearmParkTimeout).deadlineAt)).toBe(deadlineAt);
    expect(await conversationDatabaseAdapter.getMessagesForConversation(value.conversation.id)).toHaveLength(beforeMessages.length + 1);
    expect(await conversationDatabaseAdapter.getArtifacts(value.successorTaskId)).toHaveLength(0);
    expect(replayedMetadata.continuationExecution.status).toBe('parked');
    const prior = await conversationDatabaseAdapter.getTask(value.priorTaskId);
    expect(((prior?.metadata as Record<string, Record<string, unknown>>).questionSettlement).continuationStatus)
      .toBe('requested');
    const [opportunity] = await db.select({ status: schema.opportunities.status })
      .from(schema.opportunities).where(eq(schema.opportunities.id, value.opportunity.id));
    expect(opportunity.status).toBe('negotiating');
  });

  it('linearizes ordinary waiting-timeout CAS against real pickup on the exact park generation', async () => {
    const value = await fixture('ordinary-timeout-pickup');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    const parked = await conversationDatabaseAdapter.getTask(task.id);
    if (!parked) throw new Error('Missing parked task');

    const parkGeneration = (parked.metadata as Record<string, unknown>).negotiationParkGeneration;
    if (typeof parkGeneration !== 'string') throw new Error('Missing exact park generation');
    const [timeoutClaim, agentPickup] = await Promise.all([
      conversationDatabaseAdapter.transitionWaitingNegotiationToWorking({
        taskId: task.id,
        parkGeneration,
        turnNumber: 0,
      }),
      pickup(value),
    ]);

    expect(Number(Boolean(timeoutClaim)) + Number(Boolean(agentPickup))).toBe(1);
    expect(await taskState(task.id)).toEqual(timeoutClaim
      ? { state: 'working', claimedByAgentId: 'system:negotiation-timeout' }
      : { state: 'claimed', claimedByAgentId: value.prepared.executorId });
  });

  it('leaves a later ordinary park generation waiting when an old timeout is redelivered', async () => {
    const value = await fixture('ordinary-timeout-stale-generation');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    const before = await conversationDatabaseAdapter.getTask(task.id);
    if (!before) throw new Error('Missing waiting task');

    const claimed = await conversationDatabaseAdapter.transitionWaitingNegotiationToWorking({
      taskId: task.id,
      parkGeneration: 'stale-park-generation',
      turnNumber: 0,
    });

    expect(claimed).toBeNull();
    const after = await conversationDatabaseAdapter.getTask(task.id);
    expect(after?.state).toBe('waiting_for_agent');
    expect((after?.metadata as Record<string, unknown>).negotiationParkGeneration)
      .toBe((before.metadata as Record<string, unknown>).negotiationParkGeneration);
  });

  it('leaves a later exact claim claimed when an old claim timeout is redelivered', async () => {
    const value = await fixture('claim-timeout-stale-generation');
    const task = await seedWaitingTask(value.owner, value.counterparty);
    await pickup(value);
    const before = await conversationDatabaseAdapter.getTask(task.id);
    if (!before?.claimedAt) throw new Error('Missing claimed task generation');

    const claimed = await conversationDatabaseAdapter.transitionClaimedNegotiationTimeoutToWorking({
      taskId: task.id,
      claimedByAgentId: value.prepared.executorId,
      claimedAt: new Date(before.claimedAt.getTime() - 1),
      turnNumber: 0,
    });

    expect(claimed).toBeNull();
    const after = await conversationDatabaseAdapter.getTask(task.id);
    expect(after?.state).toBe('claimed');
    expect(after?.claimedAt?.getTime()).toBe(before.claimedAt.getTime());
  });

  it('leaves a later parked continuation fence unclaimed for an old timeout attempt', async () => {
    const value = await seedClaimedContinuation('continuation-timeout-stale-generation');
    await value.service.respondHermes(
      value.prepared.executorId,
      value.owner,
      value.successorTaskId,
      { action: 'continue', roleAlignment: 'peers' },
      value.principal,
      { runId: value.runId, capability: value.runCapability, outcome: 'responded' },
    );
    const before = await conversationDatabaseAdapter.getTask(value.successorTaskId);
    const beforeMetadata = before?.metadata as Record<string, unknown> | undefined;
    const stored = beforeMetadata?.continuationExecution as Record<string, unknown> | undefined;
    if (
      !before
      || typeof beforeMetadata?.negotiationParkGeneration !== 'string'
      || typeof stored?.priorTaskId !== 'string'
      || typeof stored.settlementId !== 'string'
      || typeof stored.successorTaskId !== 'string'
      || typeof stored.token !== 'string'
      || typeof stored.fence !== 'number'
    ) throw new Error('Missing parked continuation generation');
    const turns = await conversationDatabaseAdapter.getMessagesForConversation(before.conversationId);

    const claimed = await claimParkedContinuationExecutionForTimeout(db, {
      taskId: before.id,
      agentId: 'system:negotiation-timeout',
      parkGeneration: beforeMetadata.negotiationParkGeneration,
      turnNumber: turns.length,
      continuation: {
        priorTaskId: stored.priorTaskId,
        settlementId: stored.settlementId,
        successorTaskId: stored.successorTaskId,
        token: `${stored.token}-stale`,
        fence: stored.fence,
      },
    });

    expect(claimed).toBeNull();
    const after = await conversationDatabaseAdapter.getTask(before.id);
    const afterExecution = (after?.metadata as Record<string, unknown> | undefined)?.continuationExecution as Record<string, unknown> | undefined;
    expect(after?.state).toBe('waiting_for_agent');
    expect(afterExecution?.status).toBe('parked');
    expect(afterExecution?.token).toBe(stored.token);
    expect(afterExecution?.fence).toBe(stored.fence);
  });

  const timeoutTransactionBoundaries = [
    'message',
    'task',
    'artifact',
    'opportunity',
    'continuation',
    'receipt',
  ] as const;
  for (const boundary of timeoutTransactionBoundaries) {
    it(`rolls back a real timeout transaction at ${boundary} and resumes the invoked generation exactly once`, async () => {
      const value = await fixture(`timeout-atomic-${boundary}`);
      const task = await seedWaitingTask(value.owner, value.counterparty);
      const parked = await conversationDatabaseAdapter.getTask(task.id);
      const parkGeneration = (parked?.metadata as Record<string, unknown> | undefined)?.negotiationParkGeneration;
      if (typeof parkGeneration !== 'string') throw new Error('Missing park generation');
      const acquired = await conversationDatabaseAdapter.acquireWaitingNegotiationTimeoutExecution({
        taskId: task.id, parkGeneration, turnNumber: 0,
      });
      if (!acquired) throw new Error('Failed to acquire timeout execution');
      const turn = {
        action: 'accept' as const,
        message: null,
        assessment: { reasoning: 'atomic timeout', suggestedRoles: { ownUser: 'peer' as const, otherUser: 'peer' as const } },
      };
      const invoked = await conversationDatabaseAdapter.recordNegotiationTimeoutInvocation({
        taskId: task.id, executionId: acquired.execution.executionId, turn,
      });
      if (!invoked) throw new Error('Failed to persist timeout invocation');
      const plan = {
        executionId: acquired.execution.executionId,
        taskId: task.id,
        conversationId: task.conversationId,
        turn,
        finalState: 'completed' as const,
        turnNumber: 1,
        outcome: { hasOpportunity: true, agreedRoles: [], reasoning: 'atomic timeout', turnCount: 1 },
        rearm: null,
      };

      await expect(conversationDatabaseAdapter.completeNegotiationTimeoutExecution(
        plan,
        undefined,
        async (step) => {
          if (step === boundary) throw new Error(`injected timeout ${boundary}`);
        },
      )).rejects.toThrow(`injected timeout ${boundary}`);
      expect((await conversationDatabaseAdapter.getTask(task.id))?.state).toBe('working');
      expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(0);
      expect(await db.select({ id: schema.artifacts.id }).from(schema.artifacts).where(eq(schema.artifacts.taskId, task.id))).toHaveLength(0);

      const completed = await conversationDatabaseAdapter.completeNegotiationTimeoutExecution(plan);
      expect(completed?.execution.status).toBe('completed');
      expect(completed?.execution.receipt?.messageId).toBe(`${acquired.execution.executionId}:message`);
      expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(1);
      expect(await db.select({ id: schema.artifacts.id }).from(schema.artifacts).where(eq(schema.artifacts.taskId, task.id))).toHaveLength(1);
    });
  }

  it('reconciles legacy ordinary/claim generations concurrently and preserves elapsed deadlines', async () => {
    const value = await fixture('timeout-upgrade-db');
    const waiting = await seedWaitingTask(value.owner, value.counterparty);
    const claimed = await seedWaitingTask(value.owner, value.counterparty);
    const migrated = await seedWaitingTask(value.owner, value.counterparty);
    const origin = new Date('2020-01-02T03:04:05.000Z');
    const claimAt = new Date('2020-01-02T03:05:05.000Z');
    await db.update(schema.tasks).set({
      state: 'waiting_for_agent',
      metadata: {
        type: 'negotiation', sourceUserId: value.owner, candidateUserId: value.counterparty,
        hermesParkStartedAt: origin.toISOString(),
      },
      updatedAt: origin,
    }).where(eq(schema.tasks.id, waiting.id));
    // Actual pre-upgrade claimed shape: claim writes claimedAt/updatedAt but
    // preserves the waiting_for_agent statusTimestamp as pre-claim evidence.
    // No hermesParkStartedAt or park generation exists yet.
    await db.update(schema.tasks).set({
      state: 'claimed', claimedByAgentId: value.prepared.executorId, claimedAt: claimAt,
      statusTimestamp: origin,
      metadata: {
        type: 'negotiation', sourceUserId: value.owner, candidateUserId: value.counterparty,
        legacyPollingMetadata: { claimedBy: value.prepared.executorId },
      },
      updatedAt: claimAt,
    }).where(eq(schema.tasks.id, claimed.id));
    await db.update(schema.tasks).set({
      metadata: {
        type: 'negotiation', sourceUserId: value.owner, candidateUserId: value.counterparty,
        negotiationParkGeneration: 'already-current', hermesParkStartedAt: origin.toISOString(),
      },
    }).where(eq(schema.tasks.id, migrated.id));

    const concurrent = await Promise.all([
      conversationDatabaseAdapter.prepareLegacyNegotiationTimeoutBatch({ limit: 250, parkWindowMs: 300_000 }),
      conversationDatabaseAdapter.prepareLegacyNegotiationTimeoutBatch({ limit: 250, parkWindowMs: 300_000 }),
    ]);
    const ours = concurrent.flat().filter((row) => [waiting.id, claimed.id, migrated.id].includes(row.taskId));
    const waitingIntents = ours.filter((row) => row.taskId === waiting.id);
    const claimedIntents = ours.filter((row) => row.taskId === claimed.id);
    expect(waitingIntents.length).toBeGreaterThanOrEqual(1);
    expect(claimedIntents.length).toBeGreaterThanOrEqual(1);
    expect(new Set(waitingIntents.map((row) => row.generation)).size).toBe(1);
    expect(new Set(claimedIntents.map((row) => row.generation)).size).toBe(1);
    expect(ours.some((row) => row.taskId === migrated.id)).toBe(false);
    const waitingIntent = waitingIntents[0];
    const claimedIntent = claimedIntents[0];
    expect(waitingIntent.deadlineAt).toBe(new Date(origin.getTime() + 300_000).toISOString());
    expect(claimedIntent.deadlineAt).toBe(new Date(origin.getTime() + 300_000).toISOString());
    expect(claimedIntent.generation).toBe(claimAt.toISOString());

    await expect(conversationDatabaseAdapter.markLegacyNegotiationTimeoutJobInstalled({
      taskId: waiting.id, state: 'waiting_for_agent', generation: waitingIntent.generation,
    })).resolves.toBe(true);
    await expect(conversationDatabaseAdapter.markLegacyNegotiationTimeoutJobInstalled({
      taskId: claimed.id, state: 'claimed', generation: claimedIntent.generation,
    })).resolves.toBe(true);
    const replay = await conversationDatabaseAdapter.prepareLegacyNegotiationTimeoutBatch({ limit: 250, parkWindowMs: 300_000 });
    expect(replay.some((row) => row.taskId === waiting.id || row.taskId === claimed.id || row.taskId === migrated.id)).toBe(false);
  });

  for (const race of ['deselect', 'disconnect', 'rotate'] as const satisfies readonly RuntimeInvalidation[]) {
    it(`holds ${race} behind the owner fence until the complete atomic response commits`, async () => {
      const value = await fixture(`post-working-${race}`);
      const task = await seedWaitingTask(value.owner, value.counterparty);
      const runId = randomUUID();
      const pickedUp = await pickup(value, runId);
      if (!pickedUp || !('runCapability' in pickedUp)) throw new Error('Missing dedicated run capability');
      rearmCalls.length = 0;

      let consumed!: () => void;
      let release!: () => void;
      const consumedPromise = new Promise<void>((resolve) => { consumed = resolve; });
      const releasePromise = new Promise<void>((resolve) => { release = resolve; });
      value.responseFault.afterStep = async (step) => {
        if (step !== 'consume') return;
        consumed();
        await releasePromise;
      };

      const held = await holdOwnerRuntimeLock(value.owner);
      let response: ReturnType<typeof value.service.respondHermes> | undefined;
      try {
        response = value.service.respondHermes(
          value.prepared.executorId,
          value.owner,
          task.id,
          { action: 'continue', roleAlignment: 'peers' },
          value.principal,
          { runId, capability: pickedUp.runCapability, outcome: 'responded' },
        );
        const [responseBackendPid] = await waitForOwnerRuntimeWaiters(held.backendPid, 1);
        if (responseBackendPid === undefined) throw new Error('Missing queued response backend');
        held.release();
        await held.done;
        await consumedPromise;

        const invalidation = invalidateRuntime(value, race);
        let invalidated = false;
        void invalidation.then(() => { invalidated = true; });
        await waitForOwnerRuntimeWaiters(responseBackendPid, 1);
        expect(invalidated).toBe(false);

        release();
        await expect(response).resolves.toEqual({ success: true });
        await invalidation;
        expect(await taskState(task.id)).toEqual({ state: 'waiting_for_agent', claimedByAgentId: value.prepared.executorId });
        expect(await conversationDatabaseAdapter.getMessagesForConversation(task.conversationId)).toHaveLength(1);
        expect(rearmCalls.some((call) => call.negotiationId === task.id)).toBe(true);
      } finally {
        held.release();
        release();
        await held.done.catch(() => undefined);
        await response?.catch(() => undefined);
        value.responseFault.afterStep = undefined;
      }
    });
  }
});
