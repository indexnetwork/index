import { and, eq, isNull, or, sql } from 'drizzle-orm/sql';

import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { log } from '../lib/log';
import { intentNetworks, intents, networkMembers, networks, opportunities, premiseNetworks, premises, questions } from '../schemas/database.schema';
import { artifacts, messages, tasks } from '../schemas/conversation.schema';

const logger = log.lib.from('negotiation-continuation');

/** Structural mirror of the protocol's `NegotiationCounterpartyBinding` (adapters may not import the protocol package). */
type NegotiationCounterpartyBinding =
  | { kind: 'intent'; id: string }
  | { kind: 'premise'; id: string };

export const CONTINUATION_EXECUTION_LEASE_MS = 45_000;

/** Mirrors `NEGOTIATION_START_STATUSES` semantics (conversation.database.adapter): the statuses run-existing accepts an attempt from. */
export const RESUMABLE_OPPORTUNITY_STATUSES = new Set<string>(['latent', 'draft', 'pending', 'negotiating', 'stalled']);

export interface ContinuationConsultation {
  recipientUserId: string;
  recipientIntentId: string;
  kind: 'answer' | 'dismiss' | 'timeout';
  selectedOptions: string[];
  freeText?: string;
}

export interface ContinuationCoordinates {
  taskId: string;
  settlementId: string;
  opportunityId: string;
  userId: string;
  recipientIntentId: string;
  networkId: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  counterpartyBinding: NegotiationCounterpartyBinding;
}

export interface ContinuationExecutionFence extends ContinuationCoordinates {
  successorTaskId: string;
  conversationId: string;
  token: string;
  fence: number;
  leaseExpiresAt: string;
  consultation: ContinuationConsultation;
}

interface StoredSettlement {
  version: 1;
  settlementId: string;
  taskId: string;
  recipientUserId: string;
  recipientIntentId: string;
  opportunityId: string;
  networkId: string;
  intentFingerprint: string;
  opportunityStatus: string;
  opportunityUpdatedAt: string;
  counterpartyUserId: string;
  counterpartyBinding: NegotiationCounterpartyBinding;
  kind: 'answer' | 'dismiss' | 'timeout';
  questionId?: string;
  /** Row-less DM-path settlements store the client's answer inline instead of on a QUESTIONS row. */
  answer?: { selectedOptions: string[]; freeText?: string; answeredAt: string };
  continuationStatus: 'requested' | 'completed';
}

interface StoredExecution {
  version: 1;
  priorTaskId: string;
  settlementId: string;
  successorTaskId: string;
  token: string;
  fence: number;
  /** `parked` retains the fence while an external agent owns the next turn. */
  status: 'claimed' | 'parked' | 'released' | 'completed';
  leaseExpiresAt: string;
  claimedAt: string;
  heartbeatAt: string;
  releasedAt?: string;
  completedAt?: string;
}

export type ContinuationClaimResult =
  | { status: 'claimed'; execution: ContinuationExecutionFence; existingReceipt?: ContinuationReceipt }
  | { status: 'busy' | 'completed' | 'invalid' };

export interface ContinuationReceipt {
  priorTaskId: string;
  settlementId: string;
  successorTaskId: string;
  fence: number;
  outcome: 'accepted' | 'rejected' | 'stalled' | 'waiting_for_agent' | 'input_required';
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function parseInlineAnswer(value: unknown): StoredSettlement['answer'] | null {
  const raw = record(value);
  if (
    !raw
    || !Array.isArray(raw.selectedOptions)
    || !raw.selectedOptions.every((option) => typeof option === 'string')
    || (raw.freeText !== undefined && typeof raw.freeText !== 'string')
    || typeof raw.answeredAt !== 'string'
  ) return null;
  return raw as StoredSettlement['answer'];
}

function parseSettlement(value: unknown): StoredSettlement | null {
  const raw = record(value);
  if (
    raw?.version !== 1
    || typeof raw.settlementId !== 'string'
    || typeof raw.taskId !== 'string'
    || typeof raw.recipientUserId !== 'string'
    || typeof raw.recipientIntentId !== 'string'
    || typeof raw.opportunityId !== 'string'
    || typeof raw.networkId !== 'string'
    || typeof raw.intentFingerprint !== 'string'
    || typeof raw.opportunityStatus !== 'string'
    || typeof raw.opportunityUpdatedAt !== 'string'
    || typeof raw.counterpartyUserId !== 'string'
    || parseCounterpartyBinding(raw) === null
    || !['answer', 'dismiss', 'timeout'].includes(String(raw.kind))
    || (raw.questionId !== undefined && typeof raw.questionId !== 'string')
    || (raw.answer !== undefined && parseInlineAnswer(raw.answer) === null)
    // An answer settlement carries its content either on a question row
    // (card path, questionId) or inline (row-less DM path) — never neither.
    || (raw.kind === 'answer' && typeof raw.questionId !== 'string' && raw.answer === undefined)
    || (raw.continuationStatus !== 'requested' && raw.continuationStatus !== 'completed')
  ) return null;
  // Normalize on the way out so every reader sees one shape. Settlements
  // written before the binding existed carry a flat `counterpartyIntentId`,
  // and a park already in flight must keep resuming across the deploy.
  return { ...raw, counterpartyBinding: parseCounterpartyBinding(raw) } as unknown as StoredSettlement;
}

/**
 * The counterparty binding a stored settlement carries, or null when it has
 * none that can be trusted.
 *
 * Two accepted shapes: the discriminated `counterpartyBinding` written today,
 * and the legacy flat `counterpartyIntentId` string, which is by definition an
 * intent-bound counterparty. A settlement with neither is malformed — the
 * caller treats null as "unparseable" and refuses the resume rather than
 * guessing at the pair.
 */
function parseCounterpartyBinding(raw: Record<string, unknown>): NegotiationCounterpartyBinding | null {
  const binding = record(raw.counterpartyBinding);
  if (binding && (binding.kind === 'intent' || binding.kind === 'premise') && typeof binding.id === 'string' && binding.id.length > 0) {
    return { kind: binding.kind, id: binding.id };
  }
  return typeof raw.counterpartyIntentId === 'string' && raw.counterpartyIntentId.length > 0
    ? { kind: 'intent', id: raw.counterpartyIntentId }
    : null;
}

function parseExecution(value: unknown): StoredExecution | null {
  const raw = record(value);
  if (
    raw?.version !== 1
    || typeof raw.priorTaskId !== 'string'
    || typeof raw.settlementId !== 'string'
    || typeof raw.successorTaskId !== 'string'
    || typeof raw.token !== 'string'
    || typeof raw.fence !== 'number'
    || !Number.isInteger(raw.fence)
    || !['claimed', 'parked', 'released', 'completed'].includes(String(raw.status))
    || typeof raw.leaseExpiresAt !== 'string'
    || typeof raw.claimedAt !== 'string'
    || typeof raw.heartbeatAt !== 'string'
  ) return null;
  return raw as unknown as StoredExecution;
}

function settlementMatches(settlement: StoredSettlement, input: ContinuationCoordinates): boolean {
  return settlement.taskId === input.taskId
    && settlement.settlementId === input.settlementId
    && settlement.opportunityId === input.opportunityId
    && settlement.recipientUserId === input.userId
    && settlement.recipientIntentId === input.recipientIntentId
    && settlement.networkId === input.networkId
    && settlement.intentFingerprint === input.intentFingerprint
    && settlement.opportunityStatus === input.opportunityStatus
    && settlement.opportunityUpdatedAt === input.opportunityUpdatedAt
    && settlement.counterpartyUserId === input.counterpartyUserId
    && settlement.counterpartyBinding.kind === input.counterpartyBinding.kind
    && settlement.counterpartyBinding.id === input.counterpartyBinding.id;
}

async function validateMaterialBinding(
  database: DrizzleDB,
  input: ContinuationCoordinates,
  terminalOpportunityStatus?: string,
): Promise<{ prior: typeof tasks.$inferSelect; settlement: StoredSettlement } | null> {
  const rows = await database.select({
    prior: tasks,
    payload: intents.payload,
    summary: intents.summary,
    opportunityStatus: opportunities.status,
    opportunityUpdatedAt: opportunities.updatedAt,
  })
    .from(tasks)
    .innerJoin(intents, eq(intents.id, input.recipientIntentId))
    .innerJoin(intentNetworks, and(
      eq(intentNetworks.intentId, intents.id),
      eq(intentNetworks.networkId, input.networkId),
    ))
    .innerJoin(networkMembers, and(
      eq(networkMembers.userId, input.userId),
      eq(networkMembers.networkId, input.networkId),
      isNull(networkMembers.deletedAt),
    ))
    .innerJoin(networks, and(
      eq(networks.id, input.networkId),
      eq(networks.isPersonal, false),
      isNull(networks.deletedAt),
    ))
    .innerJoin(opportunities, eq(opportunities.id, input.opportunityId))
    .where(and(
      eq(tasks.id, input.taskId),
      eq(tasks.state, 'canceled'),
      eq(intents.userId, input.userId),
      isNull(intents.archivedAt),
      or(isNull(intents.status), eq(intents.status, 'ACTIVE')),
      sql`EXISTS (
        SELECT 1 FROM ${networkMembers} counterparty_member
        WHERE counterparty_member.user_id = ${input.counterpartyUserId}
          AND counterparty_member.network_id = ${input.networkId}
          AND counterparty_member.deleted_at IS NULL
      )`,
      sql`(
        SELECT count(*) FROM jsonb_array_elements(${opportunities.actors}) recipient_actor
        WHERE recipient_actor->>'userId' = ${input.userId}
          AND recipient_actor->>'intent' = ${input.recipientIntentId}
          AND recipient_actor->>'networkId' = ${input.networkId}
          AND COALESCE(recipient_actor->>'role', '') <> 'introducer'
      ) = 1`,
      // Exactly one counterparty actor, matched on the key it actually carries.
      // An intent-bound park matches `intent`; a premise-bound one matches
      // `premise`. Matching a premise id against `->>'intent'` would count zero
      // actors and fail every such resume — which is the same class of mistake
      // that made the park throw in the first place.
      sql`(
        SELECT count(*) FROM jsonb_array_elements(${opportunities.actors}) counterparty_actor
        WHERE counterparty_actor->>'userId' = ${input.counterpartyUserId}
          AND counterparty_actor->>${input.counterpartyBinding.kind} = ${input.counterpartyBinding.id}
          AND counterparty_actor->>'networkId' = ${input.networkId}
          AND COALESCE(counterparty_actor->>'role', '') <> 'introducer'
      ) = 1`,
      // The counterparty's side of the match must still be live after the park.
      // Both kinds can go stale while a client takes 24h to answer: an intent
      // can be archived or deactivated, a premise can be retracted or deleted.
      // Each is checked against its own table and its own network assignment,
      // which is what a nullable id could not have done — it would have had to
      // skip the check for premise-bound parks entirely.
      input.counterpartyBinding.kind === 'intent'
        ? sql`EXISTS (
        SELECT 1 FROM ${intents} counterparty_intent
        JOIN ${intentNetworks} counterparty_assignment
          ON counterparty_assignment.intent_id = counterparty_intent.id
         AND counterparty_assignment.network_id = ${input.networkId}
        WHERE counterparty_intent.id = ${input.counterpartyBinding.id}
          AND counterparty_intent.user_id = ${input.counterpartyUserId}
          AND counterparty_intent.archived_at IS NULL
          AND (counterparty_intent.status IS NULL OR counterparty_intent.status = 'ACTIVE')
      )`
        : sql`EXISTS (
        SELECT 1 FROM ${premises} counterparty_premise
        JOIN ${premiseNetworks} counterparty_assignment
          ON counterparty_assignment.premise_id = counterparty_premise.id
         AND counterparty_assignment.network_id = ${input.networkId}
        WHERE counterparty_premise.id = ${input.counterpartyBinding.id}
          AND counterparty_premise.user_id = ${input.counterpartyUserId}
          AND counterparty_premise.retracted_at IS NULL
          AND counterparty_premise.deleted_at IS NULL
          AND (counterparty_premise.status IS NULL OR counterparty_premise.status = 'ACTIVE')
      )`,
    ))
    .limit(2)
    .for('update');
  if (rows.length !== 1) return null;
  const metadata = record(rows[0].prior.metadata);
  const settlement = parseSettlement(metadata?.questionSettlement);
  if (
    !settlement
    || settlement.continuationStatus !== 'requested'
    || !settlementMatches(settlement, input)
  ) return null;
  if (terminalOpportunityStatus) {
    return rows[0].opportunityStatus === terminalOpportunityStatus
      ? { prior: rows[0].prior, settlement }
      : null;
  }
  // Answers are authoritative over staleness; drift is logged, not fatal.
  // The joins and settlement match above are coherence; the world having
  // moved since the park never refuses the resume — only a non-resumable
  // current status still returns null, because no turn can run on a
  // terminal opportunity.
  if (!RESUMABLE_OPPORTUNITY_STATUSES.has(rows[0].opportunityStatus)) return null;
  const currentFingerprint = computeIntentFingerprint(rows[0].payload, rows[0].summary);
  const currentUpdatedAt = rows[0].opportunityUpdatedAt.toISOString();
  if (
    currentFingerprint !== input.intentFingerprint
    || rows[0].opportunityStatus !== input.opportunityStatus
    || currentUpdatedAt !== input.opportunityUpdatedAt
  ) {
    // Heartbeat and effect assertions re-run this validation while the graph
    // executes, and the turn itself may legitimately touch the opportunity —
    // with drift log-only, a heartbeat can no longer kill its own execution.
    logger.info('negotiation_continuation_claimed_despite_drift', {
      taskId: input.taskId,
      settlementId: input.settlementId,
      opportunityId: input.opportunityId,
      intentFingerprintMoved: currentFingerprint !== input.intentFingerprint,
      opportunityStatus: { bound: input.opportunityStatus, current: rows[0].opportunityStatus },
      opportunityUpdatedAt: { bound: input.opportunityUpdatedAt, current: currentUpdatedAt },
    });
  }
  return { prior: rows[0].prior, settlement };
}

function toFence(
  input: ContinuationCoordinates,
  successor: typeof tasks.$inferSelect,
  execution: StoredExecution,
  consultation: ContinuationConsultation,
): ContinuationExecutionFence {
  return {
    ...input,
    successorTaskId: successor.id,
    conversationId: successor.conversationId,
    token: execution.token,
    fence: execution.fence,
    leaseExpiresAt: execution.leaseExpiresAt,
    consultation,
  };
}

async function loadPrivateConsultation(
  database: DrizzleDB,
  settlement: StoredSettlement,
): Promise<ContinuationConsultation | null> {
  if (settlement.kind === 'answer' && settlement.answer) {
    // Row-less DM-path settlement: the answer was stored inline by the
    // adapter settle, under the same recipient validation the card path
    // performs on its question row. There is no QUESTIONS row to consult.
    return {
      recipientUserId: settlement.recipientUserId,
      recipientIntentId: settlement.recipientIntentId,
      kind: 'answer',
      selectedOptions: settlement.answer.selectedOptions,
      ...(typeof settlement.answer.freeText === 'string' ? { freeText: settlement.answer.freeText } : {}),
    };
  }
  if (settlement.kind === 'answer') {
    const [row] = await database.select({ answer: questions.answer, actors: questions.actors, status: questions.status })
      .from(questions)
      .where(eq(questions.id, settlement.questionId!))
      .limit(1)
      .for('update');
    const answer = record(row?.answer);
    const actors = Array.isArray(row?.actors) ? row.actors : [];
    if (
      row?.status !== 'answered'
      || !actors.some((actor) => record(actor)?.userId === settlement.recipientUserId)
      || !answer
      || answer.answeredBy !== settlement.recipientUserId
      || !Array.isArray(answer.selectedOptions)
      || !answer.selectedOptions.every((option) => typeof option === 'string')
      || (answer.freeText !== undefined && typeof answer.freeText !== 'string')
    ) return null;
    return {
      recipientUserId: settlement.recipientUserId,
      recipientIntentId: settlement.recipientIntentId,
      kind: 'answer',
      selectedOptions: answer.selectedOptions as string[],
      ...(typeof answer.freeText === 'string' ? { freeText: answer.freeText } : {}),
    };
  }
  return {
    recipientUserId: settlement.recipientUserId,
    recipientIntentId: settlement.recipientIntentId,
    kind: settlement.kind,
    selectedOptions: [],
    freeText: settlement.kind === 'dismiss'
      ? '(dismissed) Conservative default applies: do not disclose or commit; continue without this information.'
      : '(no response) Conservative default applies: do not disclose or commit; continue without this information.',
  };
}

async function detectExistingReceipt(
  database: DrizzleDB,
  successor: typeof tasks.$inferSelect,
  execution: StoredExecution,
): Promise<ContinuationReceipt | undefined> {
  if (successor.state !== 'completed') return undefined;
  const [artifact] = await database.select({ metadata: artifacts.metadata })
    .from(artifacts)
    .where(and(eq(artifacts.taskId, successor.id), eq(artifacts.name, 'negotiation-outcome')))
    .limit(1);
  const metadata = record(artifact?.metadata);
  if (!artifact || typeof metadata?.continuationOutcome !== 'string') return undefined;
  const outcome = metadata.continuationOutcome;
  if (!['accepted', 'rejected', 'stalled'].includes(outcome)) return undefined;
  return {
    priorTaskId: execution.priorTaskId,
    settlementId: execution.settlementId,
    successorTaskId: successor.id,
    fence: execution.fence,
    outcome: outcome as ContinuationReceipt['outcome'],
  };
}

export async function claimContinuationExecution(
  database: DrizzleDB,
  input: ContinuationCoordinates,
  leaseMs = CONTINUATION_EXECUTION_LEASE_MS,
): Promise<ContinuationClaimResult> {
  return database.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`negotiation-continuation:${input.settlementId}`}, 0))`);
    const binding = await validateMaterialBinding(tx as unknown as DrizzleDB, input);
    if (!binding) {
      const [prior] = await tx.select({ metadata: tasks.metadata }).from(tasks)
        .where(eq(tasks.id, input.taskId)).limit(1).for('update');
      const settlement = parseSettlement(record(prior?.metadata)?.questionSettlement);
      return settlement?.continuationStatus === 'completed' ? { status: 'completed' } : { status: 'invalid' };
    }

    const consultation = await loadPrivateConsultation(tx as unknown as DrizzleDB, binding.settlement);
    // Do not mint or lease a successor until the only recipient-private input
    // is present and structurally valid. Otherwise an invalid answer would
    // strand a claimed successor until its lease elapsed.
    if (!consultation) return { status: 'invalid' };

    const successors = await tx.select().from(tasks).where(and(
      eq(tasks.conversationId, binding.prior.conversationId),
      sql`${tasks.metadata}->>'continuationSettlementId' = ${input.settlementId}`,
      sql`${tasks.metadata}->>'resumeFromTaskId' = ${input.taskId}`,
    )).orderBy(tasks.createdAt, tasks.id).limit(2).for('update');
    if (successors.length > 1) throw new Error('Duplicate negotiation continuation successors');

    const now = new Date();
    let successor = successors[0];
    const existingExecution = parseExecution(record(successor?.metadata)?.continuationExecution);
    if (existingExecution?.status === 'completed') return { status: 'completed' };
    // A parked successor is owned by the external-agent/polling path. It is
    // deliberately not a terminal receipt and must never be re-run from the
    // original question-resume queue.
    if (existingExecution?.status === 'parked') return { status: 'busy' };
    if (
      existingExecution?.status === 'claimed'
      && new Date(existingExecution.leaseExpiresAt).getTime() > now.getTime()
    ) return { status: 'busy' };

    const fence = (existingExecution?.fence ?? 0) + 1;
    const execution: StoredExecution = {
      version: 1,
      priorTaskId: input.taskId,
      settlementId: input.settlementId,
      successorTaskId: successor?.id ?? crypto.randomUUID(),
      token: crypto.randomUUID(),
      fence,
      status: 'claimed',
      leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
      claimedAt: now.toISOString(),
      heartbeatAt: now.toISOString(),
    };

    if (!successor) {
      const priorMetadata = record(binding.prior.metadata) ?? {};
      const { questionSettlement: _settlement, ...safePriorMetadata } = priorMetadata;
      [successor] = await tx.insert(tasks).values({
        id: execution.successorTaskId,
        conversationId: binding.prior.conversationId,
        state: 'submitted',
        metadata: {
          ...safePriorMetadata,
          isContinuation: true,
          resumeFromTaskId: input.taskId,
          continuationSettlementId: input.settlementId,
          continuationExecution: execution,
        },
      }).returning();
    } else {
      [successor] = await tx.update(tasks).set({
        state: ['submitted', 'working', 'failed'].includes(successor.state) ? 'submitted' : successor.state,
        metadata: sql`jsonb_set(COALESCE(${tasks.metadata}, '{}'::jsonb), '{continuationExecution}', ${JSON.stringify(execution)}::jsonb, true)`,
        updatedAt: now,
      }).where(eq(tasks.id, successor.id)).returning();
    }

    const existingReceipt = await detectExistingReceipt(tx as unknown as DrizzleDB, successor, execution);
    return { status: 'claimed', execution: toFence(input, successor, execution, consultation), ...(existingReceipt ? { existingReceipt } : {}) };
  });
}

async function assertFenceOwnership(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
): Promise<typeof tasks.$inferSelect> {
  const [successor] = await database.select().from(tasks)
    .where(eq(tasks.id, execution.successorTaskId)).limit(1).for('update');
  const stored = parseExecution(record(successor?.metadata)?.continuationExecution);
  if (
    !successor
    || !stored
    || stored.status !== 'claimed'
    || stored.token !== execution.token
    || stored.fence !== execution.fence
    || stored.priorTaskId !== execution.taskId
    || stored.settlementId !== execution.settlementId
    || new Date(stored.leaseExpiresAt).getTime() <= Date.now()
  ) throw new Error('Negotiation continuation execution fence was lost');
  return successor;
}

export async function assertContinuationExecutionEffect(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
): Promise<typeof tasks.$inferSelect> {
  const successor = await assertFenceOwnership(database, execution);
  const binding = await validateMaterialBinding(database, execution);
  if (!binding) throw new Error('Negotiation continuation material binding drifted');
  return successor;
}

export async function heartbeatContinuationExecution(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
  leaseMs = CONTINUATION_EXECUTION_LEASE_MS,
): Promise<ContinuationExecutionFence> {
  return database.transaction(async (tx) => {
    await assertContinuationExecutionEffect(tx as unknown as DrizzleDB, execution);
    const now = new Date();
    const leaseExpiresAt = new Date(now.getTime() + leaseMs).toISOString();
    const [updated] = await tx.update(tasks).set({
      metadata: sql`jsonb_set(jsonb_set(${tasks.metadata}, '{continuationExecution,heartbeatAt}', to_jsonb(${now.toISOString()}::text), false), '{continuationExecution,leaseExpiresAt}', to_jsonb(${leaseExpiresAt}::text), false)`,
      updatedAt: now,
    }).where(eq(tasks.id, execution.successorTaskId)).returning();
    if (!updated) throw new Error('Negotiation continuation heartbeat target disappeared');
    return { ...execution, leaseExpiresAt };
  });
}

/**
 * Convert a graph pause into a durable external-agent handoff. A pause is not
 * completion: the parent settlement stays requested and the stored fence is
 * retained until a fenced polling/timeout path produces a terminal receipt.
 */
export async function parkContinuationExecutionInTransaction(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
): Promise<void> {
  const successor = await assertFenceOwnership(database, execution);
  if (!['waiting_for_agent', 'claimed', 'input_required'].includes(successor.state)) {
    throw new Error('Negotiation continuation pause does not prove a parked successor');
  }
  await database.update(tasks).set({
    metadata: sql`jsonb_set(${tasks.metadata}, '{continuationExecution,status}', '"parked"'::jsonb, false)`,
    updatedAt: new Date(),
  }).where(eq(tasks.id, execution.successorTaskId));
}

export async function parkContinuationExecution(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
): Promise<void> {
  await database.transaction((tx) => parkContinuationExecutionInTransaction(
    tx as unknown as DrizzleDB,
    execution,
  ));
}

/**
 * Atomically restores a parked continuation fence when its recipient agent
 * picks up the exact task. The new token/fence defeats stale workers and
 * expired leases before the poller can write a turn.
 */
export async function claimParkedContinuationExecutionInTransaction(
  tx: DrizzleDB,
  taskId: string,
  agentId: string,
  leaseMs = CONTINUATION_EXECUTION_LEASE_MS,
): Promise<{ task: typeof tasks.$inferSelect; execution: ContinuationExecutionFence } | null> {
  const [task] = await tx.select().from(tasks).where(and(
    eq(tasks.id, taskId),
    eq(tasks.state, 'waiting_for_agent'),
  )).limit(1).for('update');
  const stored = parseExecution(record(task?.metadata)?.continuationExecution);
  if (!task || !stored || stored.status !== 'parked') return null;
  const [prior] = await tx.select({ metadata: tasks.metadata }).from(tasks)
    .where(eq(tasks.id, stored.priorTaskId)).limit(1).for('update');
  const settlement = parseSettlement(record(prior?.metadata)?.questionSettlement);
  const consultation = settlement
    ? await loadPrivateConsultation(tx, settlement)
    : null;
  if (!settlement || settlement.continuationStatus !== 'requested' || !consultation) {
    throw new Error('Parked continuation settlement is unavailable');
  }
  const now = new Date();
  const execution: StoredExecution = {
    ...stored,
    token: crypto.randomUUID(),
    fence: stored.fence + 1,
    status: 'claimed',
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    claimedAt: now.toISOString(),
    heartbeatAt: now.toISOString(),
  };
  const fence: ContinuationExecutionFence = {
    taskId: stored.priorTaskId, settlementId: stored.settlementId,
    opportunityId: settlement.opportunityId, userId: settlement.recipientUserId,
    recipientIntentId: settlement.recipientIntentId, networkId: settlement.networkId,
    intentFingerprint: settlement.intentFingerprint, opportunityStatus: settlement.opportunityStatus,
    opportunityUpdatedAt: settlement.opportunityUpdatedAt, counterpartyUserId: settlement.counterpartyUserId,
    counterpartyBinding: settlement.counterpartyBinding, successorTaskId: task.id,
    conversationId: task.conversationId, token: execution.token, fence: execution.fence,
    leaseExpiresAt: execution.leaseExpiresAt, consultation,
  };
  if (!await validateMaterialBinding(tx, fence)) {
    throw new Error('Parked continuation material binding drifted');
  }
  const [claimed] = await tx.update(tasks).set({
    state: 'claimed', claimedByAgentId: agentId, claimedAt: now, updatedAt: now,
    metadata: sql`jsonb_set(${tasks.metadata}, '{continuationExecution}', ${JSON.stringify(execution)}::jsonb, true)`,
  }).where(and(eq(tasks.id, task.id), eq(tasks.state, 'waiting_for_agent'))).returning();
  if (!claimed) return null;
  return { task: claimed, execution: fence };
}

export async function claimParkedContinuationExecution(
  database: DrizzleDB,
  taskId: string,
  agentId: string,
  leaseMs = CONTINUATION_EXECUTION_LEASE_MS,
): Promise<{ task: typeof tasks.$inferSelect; execution: ContinuationExecutionFence } | null> {
  return database.transaction((tx) => claimParkedContinuationExecutionInTransaction(
    tx as unknown as DrizzleDB,
    taskId,
    agentId,
    leaseMs,
  ));
}

/**
 * Atomically validates and claims the exact parked continuation generation for
 * timeout fallback. A stale job cannot increment the continuation fence or
 * change task state: park generation, stored attempt/fence, and conversation
 * turn count are checked under the task lock before the claim is written.
 */
export async function claimParkedContinuationExecutionForTimeout(
  database: DrizzleDB,
  input: {
    taskId: string;
    agentId: string;
    parkGeneration: string;
    turnNumber: number;
    continuation: {
      priorTaskId: string;
      settlementId: string;
      successorTaskId: string;
      token: string;
      fence: number;
    };
  },
): Promise<{ task: typeof tasks.$inferSelect; execution: ContinuationExecutionFence } | null> {
  return database.transaction(async (tx) => {
    const transaction = tx as unknown as DrizzleDB;
    const [current] = await transaction.select().from(tasks).where(and(
      eq(tasks.id, input.taskId),
      eq(tasks.state, 'waiting_for_agent'),
      sql`${tasks.metadata}->>'negotiationParkGeneration' = ${input.parkGeneration}`,
    )).limit(1).for('update');
    const stored = parseExecution(record(current?.metadata)?.continuationExecution);
    if (
      !current
      || !stored
      || stored.status !== 'parked'
      || stored.priorTaskId !== input.continuation.priorTaskId
      || stored.settlementId !== input.continuation.settlementId
      || stored.successorTaskId !== input.continuation.successorTaskId
      || stored.token !== input.continuation.token
      || stored.fence !== input.continuation.fence
    ) return null;
    const turns = await transaction.select({ id: messages.id }).from(messages)
      .where(eq(messages.conversationId, current.conversationId));
    if (turns.length !== input.turnNumber) return null;

    const claimed = await claimParkedContinuationExecutionInTransaction(
      transaction,
      input.taskId,
      input.agentId,
    );
    if (!claimed) return null;
    const [working] = await transaction.update(tasks).set({
      state: 'working',
      updatedAt: new Date(),
    }).where(and(
      eq(tasks.id, input.taskId),
      eq(tasks.state, 'claimed'),
      eq(tasks.claimedByAgentId, input.agentId),
    )).returning();
    return working ? { task: working, execution: claimed.execution } : null;
  });
}

/**
 * Load the exact continuation claim generation for its timeout worker. Unlike
 * an ordinary mutation fence, the lease is expected to have elapsed when this
 * runs; the job-supplied token/fence and current material binding are the CAS.
 */
export async function readClaimedContinuationExecutionForTimeoutInTransaction(
  database: DrizzleDB,
  taskId: string,
  expected: { priorTaskId: string; settlementId: string; successorTaskId: string; token: string; fence: number },
): Promise<ContinuationExecutionFence | null> {
  const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for('update');
  const stored = parseExecution(record(task?.metadata)?.continuationExecution);
  if (
    !task
    || !stored
    || stored.status !== 'claimed'
    || stored.priorTaskId !== expected.priorTaskId
    || stored.settlementId !== expected.settlementId
    || stored.successorTaskId !== expected.successorTaskId
    || stored.token !== expected.token
    || stored.fence !== expected.fence
  ) return null;
  const [prior] = await database.select({ metadata: tasks.metadata }).from(tasks)
    .where(eq(tasks.id, stored.priorTaskId)).limit(1).for('update');
  const settlement = parseSettlement(record(prior?.metadata)?.questionSettlement);
  const consultation = settlement ? await loadPrivateConsultation(database, settlement) : null;
  if (!settlement || settlement.continuationStatus !== 'requested' || !consultation) return null;
  const execution: ContinuationExecutionFence = {
    taskId: stored.priorTaskId, settlementId: stored.settlementId,
    opportunityId: settlement.opportunityId, userId: settlement.recipientUserId,
    recipientIntentId: settlement.recipientIntentId, networkId: settlement.networkId,
    intentFingerprint: settlement.intentFingerprint, opportunityStatus: settlement.opportunityStatus,
    opportunityUpdatedAt: settlement.opportunityUpdatedAt, counterpartyUserId: settlement.counterpartyUserId,
    counterpartyBinding: settlement.counterpartyBinding, successorTaskId: task.id,
    conversationId: task.conversationId, token: stored.token, fence: stored.fence,
    leaseExpiresAt: stored.leaseExpiresAt, consultation,
  };
  return await validateMaterialBinding(database, execution) ? execution : null;
}

/**
 * Rotate an elapsed external claim into a fresh timeout-owned continuation
 * fence. The old Bull identity is validated first; token/fence renewal and the
 * timeout task acquisition live in the caller's surrounding transaction.
 */
export async function rotateClaimedContinuationExecutionForTimeoutInTransaction(
  database: DrizzleDB,
  taskId: string,
  expected: { priorTaskId: string; settlementId: string; successorTaskId: string; token: string; fence: number },
  leaseMs = CONTINUATION_EXECUTION_LEASE_MS,
): Promise<ContinuationExecutionFence | null> {
  const current = await readClaimedContinuationExecutionForTimeoutInTransaction(database, taskId, expected);
  if (!current) return null;
  const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for('update');
  const stored = parseExecution(record(task?.metadata)?.continuationExecution);
  if (!task || !stored || stored.status !== 'claimed') return null;
  const now = new Date();
  const rotated: StoredExecution = {
    ...stored,
    token: crypto.randomUUID(),
    fence: stored.fence + 1,
    leaseExpiresAt: new Date(now.getTime() + leaseMs).toISOString(),
    heartbeatAt: now.toISOString(),
  };
  const [updated] = await database.update(tasks).set({
    metadata: sql`jsonb_set(${tasks.metadata}, '{continuationExecution}', ${JSON.stringify(rotated)}::jsonb, true)`,
    updatedAt: now,
  }).where(eq(tasks.id, taskId)).returning({ id: tasks.id });
  return updated ? {
    ...current,
    token: rotated.token,
    fence: rotated.fence,
    leaseExpiresAt: rotated.leaseExpiresAt,
  } : null;
}

/** Load the current claimed fence for a poller/timeout write; malformed or stale rows fail closed. */
export async function readClaimedContinuationExecutionInTransaction(
  database: DrizzleDB,
  taskId: string,
): Promise<ContinuationExecutionFence | null> {
  const [task] = await database.select().from(tasks).where(eq(tasks.id, taskId)).limit(1).for('update');
  const stored = parseExecution(record(task?.metadata)?.continuationExecution);
  if (!task || !stored || stored.status !== 'claimed') return null;
  const [prior] = await database.select({ metadata: tasks.metadata }).from(tasks)
    .where(eq(tasks.id, stored.priorTaskId)).limit(1).for('update');
  const settlement = parseSettlement(record(prior?.metadata)?.questionSettlement);
  const consultation = settlement
    ? await loadPrivateConsultation(database, settlement)
    : null;
  if (!settlement || settlement.continuationStatus !== 'requested' || !consultation) return null;
  const execution: ContinuationExecutionFence = {
    taskId: stored.priorTaskId, settlementId: stored.settlementId,
    opportunityId: settlement.opportunityId, userId: settlement.recipientUserId,
    recipientIntentId: settlement.recipientIntentId, networkId: settlement.networkId,
    intentFingerprint: settlement.intentFingerprint, opportunityStatus: settlement.opportunityStatus,
    opportunityUpdatedAt: settlement.opportunityUpdatedAt, counterpartyUserId: settlement.counterpartyUserId,
    counterpartyBinding: settlement.counterpartyBinding, successorTaskId: task.id,
    conversationId: task.conversationId, token: stored.token, fence: stored.fence,
    leaseExpiresAt: stored.leaseExpiresAt, consultation,
  };
  try {
    await assertContinuationExecutionEffect(database, execution);
    return execution;
  } catch {
    return null;
  }
}

export async function readClaimedContinuationExecution(
  database: DrizzleDB,
  taskId: string,
): Promise<ContinuationExecutionFence | null> {
  return database.transaction((tx) => readClaimedContinuationExecutionInTransaction(
    tx as unknown as DrizzleDB,
    taskId,
  ));
}

export async function releaseContinuationExecution(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
): Promise<void> {
  await database.transaction(async (tx) => {
    const [successor] = await tx.select().from(tasks)
      .where(eq(tasks.id, execution.successorTaskId)).limit(1).for('update');
    const stored = parseExecution(record(successor?.metadata)?.continuationExecution);
    if (!successor || !stored || stored.token !== execution.token || stored.fence !== execution.fence || stored.status !== 'claimed') return;
    const now = new Date().toISOString();
    await tx.update(tasks).set({
      state: ['submitted', 'working', 'failed'].includes(successor.state) ? 'submitted' : successor.state,
      metadata: sql`jsonb_set(jsonb_set(${tasks.metadata}, '{continuationExecution,status}', '"released"'::jsonb, false), '{continuationExecution,releasedAt}', to_jsonb(${now}::text), true)`,
      updatedAt: new Date(),
    }).where(eq(tasks.id, execution.successorTaskId));
  });
}

export async function completeContinuationExecutionInTransaction(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
  receipt: ContinuationReceipt,
): Promise<void> {
  const successor = await assertFenceOwnership(database, execution);
  if (
    receipt.priorTaskId !== execution.taskId
    || receipt.settlementId !== execution.settlementId
    || receipt.successorTaskId !== execution.successorTaskId
    || receipt.fence !== execution.fence
    || (receipt.outcome === 'waiting_for_agent' && !['waiting_for_agent', 'claimed'].includes(successor.state))
    || (receipt.outcome === 'input_required' && successor.state !== 'input_required')
    || (['accepted', 'rejected', 'stalled'].includes(receipt.outcome) && successor.state !== 'completed')
  ) throw new Error('Negotiation continuation receipt does not prove the exact successor');

  const terminalOpportunityStatus = receipt.outcome === 'accepted'
    ? 'pending'
    : receipt.outcome === 'rejected'
      ? 'rejected'
      : receipt.outcome === 'stalled'
        ? 'stalled'
        : undefined;
  const binding = await validateMaterialBinding(database, execution, terminalOpportunityStatus);
  if (!binding) throw new Error('Negotiation continuation material binding drifted before receipt');
  if (terminalOpportunityStatus) {
    const [artifact] = await database.select({ metadata: artifacts.metadata })
      .from(artifacts)
      .where(and(eq(artifacts.taskId, execution.successorTaskId), eq(artifacts.name, 'negotiation-outcome')))
      .limit(1)
      .for('update');
    if (record(artifact?.metadata)?.continuationOutcome !== receipt.outcome) {
      throw new Error('Negotiation continuation terminal receipt does not match its exact artifact');
    }
  }
  const [prior] = await database.select({ metadata: tasks.metadata }).from(tasks)
    .where(eq(tasks.id, execution.taskId)).limit(1).for('update');
  const settlement = parseSettlement(record(prior?.metadata)?.questionSettlement);
  if (!settlement || !settlementMatches(settlement, execution) || settlement.continuationStatus !== 'requested') {
    throw new Error('Exact negotiation continuation settlement is unavailable');
  }
  const completedAt = new Date().toISOString();
  await database.update(tasks).set({
    metadata: sql`jsonb_set(jsonb_set(${tasks.metadata}, '{continuationExecution,status}', '"completed"'::jsonb, false), '{continuationExecution,completedAt}', to_jsonb(${completedAt}::text), true)`,
    updatedAt: new Date(),
  }).where(eq(tasks.id, execution.successorTaskId));
  await database.update(tasks).set({
    metadata: sql`jsonb_set(jsonb_set(${tasks.metadata}, '{questionSettlement,continuationStatus}', '"completed"'::jsonb, false), '{questionSettlement,completedAt}', to_jsonb(${completedAt}::text), true)`,
    updatedAt: new Date(),
  }).where(eq(tasks.id, execution.taskId));
}

export async function completeContinuationExecution(
  database: DrizzleDB,
  execution: ContinuationExecutionFence,
  receipt: ContinuationReceipt,
): Promise<void> {
  await database.transaction((tx) => completeContinuationExecutionInTransaction(
    tx as unknown as DrizzleDB,
    execution,
    receipt,
  ));
}
