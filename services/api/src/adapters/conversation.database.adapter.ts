import { projectOwnerScreenDecision, readInitiatorUserId } from './negotiation-lifecycle.projection';
import { buildHermesResponseMetadataSql, buildNegotiationParkMetadataSql } from './conversation-hermes-metadata.sql';
import { readUserContext, schema, Artifact, ChatConversationMeta, ChatMessage, ChatMessageMeta, ChatScopeType, ChatSession, Conversation, ConversationParticipant, ConversationSession, ConversationSummary, CreateMessageInput, CreateSessionInput, Message, ResolvedParticipant, SYSTEM_AGENT_ID, Task, and, asc, count, db, desc, eq, gt, gte, inArray, isNull, lt, ne, opportunities, or, sql } from './database.shared';
import { emitOpportunityLifecycleBestEffort } from '../events/opportunity.event';
import { publishConversationMessageEvent } from '../lib/conversation-events';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { log } from '../lib/log';
import { projectNegotiationActivity } from '../lib/negotiation-activity';
import { assertContinuationExecutionEffect, claimParkedContinuationExecutionInTransaction, completeContinuationExecutionInTransaction, parkContinuationExecutionInTransaction, readClaimedContinuationExecutionForTimeoutInTransaction, readClaimedContinuationExecutionInTransaction, rotateClaimedContinuationExecutionForTimeoutInTransaction } from './negotiation-continuation.atomic';
import type { ContinuationExecutionFence, ContinuationReceipt } from './negotiation-continuation.atomic';
import { negotiationTimeoutExecutionId, parseNegotiationTimeoutExecution, timeoutExecutionMatches } from '../lib/negotiation/timeout-execution';
import type { AcquiredNegotiationTimeoutExecution, NegotiationTimeoutAtomicStep, NegotiationTimeoutCompletionPlan, NegotiationTimeoutExecutionIdentity, NegotiationTimeoutExecutionRecord } from '../lib/negotiation/timeout-execution';
import { deriveLegacyNegotiationParkOrigin, type TimeoutUpgradeJobIntent } from '../lib/negotiation/timeout-upgrade-reconciliation';
import { expectedNegotiationSpeaker, negotiationScopeKey } from '../lib/negotiation/expected-speaker';
import { acquireNegotiationAttemptLock, acquireNegotiationPairLock, notArchivedNegotiationTaskWhere, qualifyingNegotiationAttemptTaskWhere, qualifyingPairNegotiationTaskWhere, type NegotiationAttemptTransaction } from './negotiation-attempt.atomic';
import { consultationActorSetMatchesBinding, externalConsultationCoordinatesFor } from '../lib/negotiation/consultation';
import { authorizeNegotiationMutationInTransaction } from '../lib/agent/negotiation-runtime-authority';
import { isDedicatedHermesNegotiationAudience, type NegotiationCredentialPrincipal } from '../lib/agent/hermes-credential';
import { digestHermesRunId, issueHermesRunCapability, parseHermesRunCapabilityBinding, verifyHermesRunCapability, type HermesRunOutcome } from '../lib/agent/hermes-negotiation-run';

/**
 * In-transaction read of ONE negotiation's turn history, for the locked floor
 * checks below.
 *
 * Mirrors `getNegotiationMessages`, but must run inside the caller's `tx` so
 * the check and the write it guards observe the same snapshot. A task with no
 * opportunity has no identity apart from its conversation, so the conversation
 * is its scope.
 */
async function selectNegotiationTurnHistoryInTransaction(
  tx: { select: typeof db.select },
  scope: { conversationId: string; metadata: Record<string, unknown> | null },
): Promise<Array<{ id: string; senderId: string; parts: unknown }>> {
  const opportunityId = negotiationScopeKey(scope.metadata);
  const columns = {
    id: schema.messages.id,
    senderId: schema.messages.senderId,
    parts: schema.messages.parts,
  };
  if (!opportunityId) {
    return tx.select(columns).from(schema.messages)
      .where(eq(schema.messages.conversationId, scope.conversationId))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
  }
  return tx.select(columns).from(schema.messages)
    .innerJoin(schema.tasks, eq(schema.messages.taskId, schema.tasks.id))
    .where(and(
      sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
      sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
    ))
    .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
}

export type AtomicNegotiationPickupResult =
  | { kind: 'unauthorized' }
  | { kind: 'conflict' }
  | { kind: 'run_exhausted' }
  | { kind: 'empty' }
  | { kind: 'existing'; task: Task; parkStartTime: Date; parkGeneration: string; runCapability?: string }
  | { kind: 'claimed'; task: Task; parkStartTime: Date; parkGeneration: string; runCapability?: string };

export type HermesRunMutationAuthority = {
  runId: string;
  capability: string;
  outcome: HermesRunOutcome;
};

export const HERMES_RESPONSE_ATOMIC_STEPS = [
  'consume',
  'message',
  'task',
  'artifact',
  'opportunity',
  'continuation',
  'receipt',
  'outbox',
] as const;
export type HermesResponseAtomicStep = typeof HERMES_RESPONSE_ATOMIC_STEPS[number];

export type HermesResponseQueueIntent = {
  cancelClaimTimeout: true;
  /** Exact claimedAt generation of the timer being cancelled. */
  claimGeneration: string;
  rearmParkTimeout: {
    turnNumber: number;
    /** Absolute deadline committed with the response outbox. */
    deadlineAt: string;
    parkGeneration: string;
    continuation?: {
      priorTaskId: string;
      settlementId: string;
      successorTaskId: string;
      token: string;
      fence: number;
    };
  } | null;
};

export type HermesResponseReceipt = {
  version: 1;
  receiptId: string;
  taskId: string;
  messageId: string;
  artifactId: string | null;
  action: string;
  finalState: 'completed' | 'waiting_for_agent';
  turnNumber: number;
  completedAt: string;
};

export type AtomicHermesResponseResult =
  | { kind: 'unauthorized' }
  | { kind: 'not_found' }
  | { kind: 'conflict'; state?: string; claimedByAgentId?: string | null }
  | { kind: 'committed'; receipt: HermesResponseReceipt; queueIntent: HermesResponseQueueIntent; outboxDelivered: boolean }
  | { kind: 'replay'; receipt: HermesResponseReceipt; queueIntent: HermesResponseQueueIntent; outboxDelivered: boolean };

export type PendingHermesResponseOutbox = {
  taskId: string;
  result: Extract<AtomicHermesResponseResult, { kind: 'replay' }>;
};

export interface AtomicHermesResponseInput {
  agentId: string;
  ownerId: string;
  taskId: string;
  principal: NegotiationCredentialPrincipal;
  authority: HermesRunMutationAuthority;
  expectedConversationId: string;
  expectedTaskUpdatedAt: Date;
  expectedTurnCount: number;
  turn: { action: string; message?: string | null; assessment: unknown };
  finalState: 'completed' | 'waiting_for_agent';
  outcome?: Record<string, unknown>;
  opportunity?: { id: string; status: 'pending' | 'rejected' | 'stalled' };
  continuationOutcome?: 'accepted' | 'rejected' | 'stalled';
  parkTimeoutMs: number;
  identity: { receiptId: string; messageId: string; artifactId: string; sessionId: string };
  /** Test-only transaction fault seam. Rejected outside a guarded test process. */
  faultAfterStep?: (step: HermesResponseAtomicStep) => void | Promise<void>;
}

function responseReceipt(value: unknown): HermesResponseReceipt | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const receipt = value as Partial<HermesResponseReceipt>;
  return receipt.version === 1
    && typeof receipt.receiptId === 'string'
    && typeof receipt.taskId === 'string'
    && typeof receipt.messageId === 'string'
    && (typeof receipt.artifactId === 'string' || receipt.artifactId === null)
    && typeof receipt.action === 'string'
    && (receipt.finalState === 'completed' || receipt.finalState === 'waiting_for_agent')
    && typeof receipt.turnNumber === 'number'
    && typeof receipt.completedAt === 'string'
    ? receipt as HermesResponseReceipt
    : null;
}

function responseQueueIntent(value: unknown): HermesResponseQueueIntent | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const intent = value as Partial<HermesResponseQueueIntent>;
  const rearm = intent.rearmParkTimeout;
  if (intent.cancelClaimTimeout !== true || typeof intent.claimGeneration !== 'string') return null;
  if (rearm !== null && (
    !rearm
    || typeof rearm !== 'object'
    || typeof rearm.turnNumber !== 'number'
    || typeof rearm.deadlineAt !== 'string'
    || !Number.isFinite(new Date(rearm.deadlineAt).getTime())
    || typeof rearm.parkGeneration !== 'string'
  )) return null;
  const continuation = rearm && 'continuation' in rearm ? rearm.continuation : undefined;
  if (continuation !== undefined && (
    !continuation
    || typeof continuation !== 'object'
    || typeof continuation.priorTaskId !== 'string'
    || typeof continuation.settlementId !== 'string'
    || typeof continuation.successorTaskId !== 'string'
    || typeof continuation.token !== 'string'
    || typeof continuation.fence !== 'number'
  )) return null;
  return intent as HermesResponseQueueIntent;
}

function hasNegotiationContinuationIdentity(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const metadata = value as Record<string, unknown>;
  return Object.prototype.hasOwnProperty.call(metadata, 'continuationExecution')
    || metadata.isContinuation === true
    || typeof metadata.resumeFromTaskId === 'string'
    || typeof metadata.continuationSettlementId === 'string';
}

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function consumeHermesRunCapabilityMetadata(input: {
  metadata: unknown;
  taskId: string;
  principal: NegotiationCredentialPrincipal;
  authority: HermesRunMutationAuthority;
  now: Date;
}): Record<string, unknown> | null {
  const metadata = input.metadata && typeof input.metadata === 'object' && !Array.isArray(input.metadata)
    ? input.metadata as Record<string, unknown>
    : {};
  const binding = parseHermesRunCapabilityBinding(metadata.hermesRunCapability);
  if (!binding || verifyHermesRunCapability(binding, {
    taskId: input.taskId,
    runId: input.authority.runId,
    capability: input.authority.capability,
    principal: input.principal,
    now: input.now,
  }) !== 'fresh') return null;
  return {
    ...metadata,
    hermesRunCapability: {
      ...binding,
      consumedAt: input.now.toISOString(),
      ...(input.authority.outcome === 'consulted' ? { completedAt: input.now.toISOString() } : {}),
      outcome: input.authority.outcome,
    },
  };
}

/** Persona literals mirrored locally so the data layer stays protocol-agnostic. */
const NEGOTIATOR_PERSONA = 'negotiator';
const logger = log.lib.from('conversation-database');

/**
 * Persona-specific registry key for a canonical intent scope.
 *
 * Every persona gets its own `<persona>-intent` key, so the
 * `(user_id, scope_type, scope_id)` unique index keeps per-persona sessions
 * for the same signal distinct without a schema change.
 *
 * The bare `'intent'` key is retired: it belonged to the removed orchestrator
 * persona. Those rows are retained read-only.
 */

function intentRegistryScopeType(persona: string): string {
  return `${persona}-intent`;
}

/**
 * Registry scope_type for intent-pinned negotiator sessions (P4.2/IND-403).
 * Keying the `chat_session_scopes` unique index as ('negotiator-intent',
 * intentId) makes the negotiator's per-intent session distinct from the
 * orchestrator's ('intent', intentId) session for the same user — persona is
 * part of the key without a migration. This value is deliberately outside
 * the `ChatScopeType` ('network' | 'intent') envelope and never appears in
 * it — `_normalizeScopeType` ignores it, and conversation_metadata still says
 * scopeType 'intent' so scope-driven behavior (graph seeding, session load)
 * is identical to any intent-scoped session.
 */
const NEGOTIATOR_INTENT_SCOPE_TYPE = 'negotiator-intent';

const DEFAULT_CHAT_SESSION_GAP_MS = 24 * 60 * 60 * 1000;

function getChatSessionGapMs(): number {
  const configured = Number.parseInt(process.env.CHAT_SESSION_GAP_MS ?? '', 10);
  return Number.isFinite(configured) && configured > 0
    ? configured
    : DEFAULT_CHAT_SESSION_GAP_MS;
}

interface MatchProvenanceEntry {
  opportunityId: string;
  intents: Array<{ userId: string; intentId: string }>;
  recordedAt: string;
}

function isMatchProvenanceEntry(value: unknown): value is MatchProvenanceEntry {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const entry = value as Record<string, unknown>;
  return typeof entry.opportunityId === 'string'
    && typeof entry.recordedAt === 'string'
    && Array.isArray(entry.intents)
    && entry.intents.every((intent) => {
      if (typeof intent !== 'object' || intent === null || Array.isArray(intent)) return false;
      const record = intent as Record<string, unknown>;
      return typeof record.userId === 'string' && typeof record.intentId === 'string';
    });
}

function readNegotiationOutcome(parts: unknown): { hasOpportunity: boolean; reason: string | null; turnCount: number | null; reasoning: string | null } | null {
  if (!Array.isArray(parts)) return null;
  for (const part of parts) {
    if (typeof part !== 'object' || part === null || Array.isArray(part)) continue;
    const partRecord = part as Record<string, unknown>;
    if (partRecord.kind !== 'data' || typeof partRecord.data !== 'object' || partRecord.data === null || Array.isArray(partRecord.data)) continue;
    const data = partRecord.data as Record<string, unknown>;
    const hasOpportunity = typeof data.hasOpportunity === 'boolean'
      ? data.hasOpportunity
      : typeof data.consensus === 'boolean'
        ? data.consensus
        : null;
    if (hasOpportunity === null) continue;
    return {
      hasOpportunity,
      reason: typeof data.reason === 'string' ? data.reason : null,
      turnCount: typeof data.turnCount === 'number' && Number.isFinite(data.turnCount) ? data.turnCount : null,
      // IND-610: owner-only — never projected into the shared `outcome` field.
      // Only ever reaches a caller through `projectScreenDecision`, which is
      // itself gated on the viewer being the negotiation's initiator.
      reasoning: typeof data.reasoning === 'string' ? data.reasoning : null,
    };
  }
  return null;
}

function readNegotiationSignalCount(metadata: unknown): number {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return 0;
  const record = metadata as Record<string, unknown>;
  const intentIds = new Set<string>();
  if (Array.isArray(record.participantBindings)) {
    for (const binding of record.participantBindings) {
      if (typeof binding !== 'object' || binding === null || Array.isArray(binding)) continue;
      const intentId = (binding as Record<string, unknown>).intentId;
      if (typeof intentId === 'string' && intentId) intentIds.add(intentId);
    }
  }
  for (const key of ['sourceIntentId', 'candidateIntentId']) {
    const intentId = record[key];
    if (typeof intentId === 'string' && intentId) intentIds.add(intentId);
  }
  return intentIds.size;
}

type PersistedOpportunity = typeof opportunities.$inferSelect;
type PersistedOpportunityStatus = PersistedOpportunity['status'];

const NEGOTIATION_START_STATUSES = new Set<PersistedOpportunityStatus>([
  'latent',
  'draft',
  'pending',
  'negotiating',
]);

export interface CreateNegotiationTaskForAttemptInput {
  conversationId: string;
  opportunityId: string;
  expectedStatus: PersistedOpportunityStatus;
  expectedUpdatedAt: Date;
  metadata: Record<string, unknown>;
}

export interface StaleNegotiationTasksInput {
  submittedOlderThanMs: number;
  workingOlderThanMs: number;
  limit?: number;
}

export interface StaleNegotiationTask {
  id: string;
  conversationId: string;
  state: 'submitted' | 'working';
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
}

export interface WatchdogTaskTransitionInput {
  taskId: string;
  expectedState: 'submitted' | 'working';
  expectedUpdatedAt: Date;
  nextState: 'canceled' | 'failed';
  metadata: Record<string, unknown>;
  statusMessage: Record<string, unknown>;
}

/**
 * Claim an exact eligible opportunity state, promote it to negotiating, and
 * insert its task while the shared attempt, row, and pair locks are held.
 */
export async function createNegotiationTaskForAttemptInTransaction(
  tx: NegotiationAttemptTransaction,
  input: CreateNegotiationTaskForAttemptInput,
): Promise<Task | null> {
  if (input.metadata.type !== 'negotiation' || input.metadata.opportunityId !== input.opportunityId) {
    throw new Error('Negotiation task metadata does not match the claimed opportunity');
  }

  await acquireNegotiationAttemptLock(tx, input.opportunityId);

  const [opportunity] = await tx
    .select({
      status: opportunities.status,
      updatedAt: opportunities.updatedAt,
      actors: opportunities.actors,
    })
    .from(opportunities)
    .where(eq(opportunities.id, input.opportunityId))
    .for('update');
  if (!opportunity) return null;

  const actorUserIds = [...new Set(opportunity.actors
    .filter((actor) => actor.role !== 'introducer')
    .map((actor) => actor.userId))].sort();
  if (actorUserIds.length >= 2) {
    await acquireNegotiationPairLock(tx, actorUserIds);
  }

  if (
    opportunity.status !== input.expectedStatus
    || !NEGOTIATION_START_STATUSES.has(opportunity.status)
    || opportunity.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  ) {
    return null;
  }

  if (actorUserIds.length >= 2) {
    const [pairTask] = await tx
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .innerJoin(opportunities, sql`TRUE`)
      .where(qualifyingPairNegotiationTaskWhere(actorUserIds, input.opportunityId))
      .limit(1);
    if (pairTask) return null;
  }

  const [qualifyingTask] = await tx
    .select({ id: schema.tasks.id })
    .from(schema.tasks)
    .where(qualifyingNegotiationAttemptTaskWhere(input.opportunityId, input.expectedUpdatedAt))
    .limit(1);
  if (qualifyingTask) return null;

  if (opportunity.status !== 'negotiating') {
    const [promoted] = await tx
      .update(opportunities)
      .set({ status: 'negotiating', updatedAt: new Date() })
      .where(and(
        eq(opportunities.id, input.opportunityId),
        eq(opportunities.status, input.expectedStatus),
        eq(opportunities.updatedAt, input.expectedUpdatedAt),
      ))
      .returning({ id: opportunities.id });
    if (!promoted) return null;
  }

  const [task] = await tx
    .insert(schema.tasks)
    .values({
      conversationId: input.conversationId,
      metadata: input.metadata,
    })
    .returning();
  return task ?? null;
}

function isExactPoolPushParts(parts: unknown, expectedText: string): boolean {
  if (!Array.isArray(parts) || parts.length !== 1) return false;
  const part = parts[0];
  if (typeof part !== 'object' || part === null || Array.isArray(part)) return false;
  const record = part as Record<string, unknown>;
  return Object.keys(record).sort().join(',') === 'text,type'
    && record.type === 'text'
    && record.text === expectedText;
}

function isExactPoolPushMetadata(
  metadata: unknown,
  expected: Record<string, string>,
): boolean {
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return false;
  const record = metadata as Record<string, unknown>;
  const keys = Object.keys(expected).sort();
  return Object.keys(record).sort().join(',') === keys.join(',')
    && keys.every((key) => record[key] === expected[key]);
}

export class ConversationDatabaseAdapter {
  /**
   * Retrieve a single user_context row (global when networkId is null), or null.
   * Mirrors {@link ChatDatabaseAdapter.getUserContext} for the negotiation graph.
   */
  async getUserContext(userId: string, networkId: string | null) {
    return readUserContext(userId, networkId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversations
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a conversation and inserts participants in a single transaction.
   * @param participants - List of participant descriptors
   * @returns The newly created conversation row
   */
  async createConversation(
    participants: { participantId: string; participantType: 'user' | 'agent' }[],
  ): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({ id, createdAt: now, updatedAt: now });
      if (participants.length > 0) {
        await tx.insert(schema.conversationParticipants).values(
          participants.map((p) => ({
            conversationId: id,
            participantId: p.participantId,
            participantType: p.participantType,
          })),
        );
      }
    });

    return { id, dmPair: null, persona: 'none', lastMessageAt: null, createdAt: now, updatedAt: now };
  }

  /**
   * Resolve a conversation ID from a full UUID or short prefix.
   * @param idOrPrefix - Full UUID or prefix (e.g. first 8 chars)
   * @param userId - The user ID (for participant scoping)
   * @returns Object with resolved id, or null/ambiguous status
   */
  async resolveConversationId(idOrPrefix: string, userId: string): Promise<{ id: string } | { ambiguous: true } | null> {
    const normalized = idOrPrefix.trim().toLowerCase();
    const isFullUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(normalized);
    if (isFullUuid) {
      return { id: normalized };
    }
    const rows = await db.select({ id: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(and(
        sql`${schema.conversationParticipants.conversationId} LIKE ${normalized + '%'}`,
        eq(schema.conversationParticipants.participantId, userId),
      ))
      .limit(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) return { ambiguous: true };
    return { id: rows[0].id };
  }

  /**
   * Retrieves a conversation by ID with its participants.
   * @param id - Conversation ID
   * @returns Conversation with participants, or null if not found
   */
  async getConversation(
    id: string,
  ): Promise<(Conversation & { participants: ConversationParticipant[] }) | null> {
    const [conv] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, id))
      .limit(1);

    if (!conv) return null;

    const participants = await db
      .select()
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, id));

    return { ...conv, participants };
  }

  /**
   * Lists conversations for a user, ordered by most recent message.
   * @param participantId - The participant whose conversations to list. This
   * can be an `agent:<userId>` identity for A2A negotiations.
   * @param viewerUserId - The human owner whose intent provenance may be
   * projected into the summary. Defaults to `participantId` for ordinary DMs.
   * @param includeNegotiationLifecycle - Whether to project the latest task and
   * related opportunity lifecycle for the negotiations inbox.
   * @returns Summaries with participant lists
   */
  async getConversationsForUser(
    participantId: string,
    viewerUserId = participantId,
    includeNegotiationLifecycle = false,
  ): Promise<ConversationSummary[]> {
    // Include conversations that are not hidden OR have new messages since hiding
    const rows = await db
      .select({
        conversationId: schema.conversationParticipants.conversationId,
        hiddenAt: schema.conversationParticipants.hiddenAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, participantId),
          or(
            isNull(schema.conversationParticipants.hiddenAt),
            gt(schema.conversations.lastMessageAt, schema.conversationParticipants.hiddenAt),
          ),
        ),
      );

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.conversationId);
    const hiddenAtByConv = new Map<string, Date | null>();
    for (const r of rows) {
      hiddenAtByConv.set(r.conversationId, r.hiddenAt);
    }

    // Everything below only needs `ids` — run the lookups in one parallel
    // wave instead of sequential round trips; this method is on the chat
    // sidebar's critical path (GET /conversations and /conversations/negotiations).
    const [
      convs,
      allParticipants,
      negotiatorRow,
      claimRows,
      lastMessages,
      allMeta,
      unreadRows,
      latestNegotiationTasks,
    ] = await Promise.all([
      db
        .select()
        .from(schema.conversations)
        .where(inArray(schema.conversations.id, ids))
        .orderBy(sql`${schema.conversations.lastMessageAt} DESC NULLS LAST`),
      db
        .select()
        .from(schema.conversationParticipants)
        .where(inArray(schema.conversationParticipants.conversationId, ids)),
      // System negotiator name — fallback label when no personal agent drove a
      // side. Well-known UUID from agent.database.adapter.ts SYSTEM_AGENT_IDS.
      db
        .select({ name: schema.agents.name })
        .from(schema.agents)
        .where(eq(schema.agents.id, '00000000-0000-0000-0000-000000000002'))
        .limit(1),
      // The *actual* agent that drove each user's side. For polling-backed
      // turns, tasks.claimed_by_agent_id is the personal agent that picked the
      // turn up. Deterministic ordering: most recent claim per owner wins.
      db
        .select({
          conversationId: schema.tasks.conversationId,
          agentId: schema.tasks.claimedByAgentId,
          agentName: schema.agents.name,
          agentType: schema.agents.type,
          ownerId: schema.agents.ownerId,
          avatar: schema.users.avatar,
        })
        .from(schema.tasks)
        .innerJoin(schema.agents, eq(schema.agents.id, schema.tasks.claimedByAgentId))
        .leftJoin(schema.users, eq(schema.users.id, schema.agents.ownerId))
        .where(
          and(
            inArray(schema.tasks.conversationId, ids),
            eq(schema.agents.type, 'external'),
          ),
        )
        .orderBy(desc(schema.tasks.claimedAt), asc(schema.agents.id)),
      // Last message per conversation via DISTINCT ON.
      db
        .selectDistinctOn([schema.messages.conversationId], {
          conversationId: schema.messages.conversationId,
          parts: schema.messages.parts,
          senderId: schema.messages.senderId,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, ids))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt)),
      db
        .select()
        .from(schema.conversationMetadata)
        .where(inArray(schema.conversationMetadata.conversationId, ids)),
      // Count only messages from other participants after this viewer's
      // participant-scoped read cursor. An inner join makes missing viewer
      // participant rows a defensive zero rather than counting everything.
      db
        .select({
          conversationId: schema.messages.conversationId,
          unreadCount: count(schema.messages.id),
        })
        .from(schema.messages)
        .innerJoin(
          schema.conversationParticipants,
          and(
            eq(schema.conversationParticipants.conversationId, schema.messages.conversationId),
            eq(schema.conversationParticipants.participantId, participantId),
          ),
        )
        .where(and(
          inArray(schema.messages.conversationId, ids),
          ne(schema.messages.senderId, participantId),
          or(
            isNull(schema.conversationParticipants.lastReadAt),
            gt(schema.messages.createdAt, schema.conversationParticipants.lastReadAt),
          ),
        ))
        .groupBy(schema.messages.conversationId),
      includeNegotiationLifecycle
        ? db
          .selectDistinctOn([schema.tasks.conversationId], {
            conversationId: schema.tasks.conversationId,
            taskId: schema.tasks.id,
            state: schema.tasks.state,
            statusTimestamp: schema.tasks.statusTimestamp,
            metadata: schema.tasks.metadata,
            updatedAt: schema.tasks.updatedAt,
            artifactParts: schema.artifacts.parts,
            opportunityStatus: opportunities.status,
            opportunityAcceptedBy: opportunities.acceptedBy,
            currentTurnCount: sql<number>`(
              SELECT count(*)::int
              FROM ${schema.messages}
              WHERE ${schema.messages.taskId} = ${schema.tasks.id}
            )`,
          })
          .from(schema.tasks)
          .leftJoin(
            schema.artifacts,
            and(
              eq(schema.artifacts.taskId, schema.tasks.id),
              eq(schema.artifacts.name, 'negotiation-outcome'),
            ),
          )
          .leftJoin(opportunities, sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunities.id}`)
          .where(and(
            inArray(schema.tasks.conversationId, ids),
            sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
            notArchivedNegotiationTaskWhere(),
          ))
          .orderBy(schema.tasks.conversationId, desc(schema.tasks.createdAt), desc(schema.tasks.id))
        : Promise.resolve([]),
    ]);

    const unreadCountByConv = new Map(
      unreadRows.map((row) => [row.conversationId, Number(row.unreadCount)]),
    );

    // Resolve user names/avatars for participants
    const userIds = [...new Set(allParticipants.filter(p => p.participantType === 'user').map(p => p.participantId))];
    // Also resolve owner users behind agent: participants
    const agentOwnerIds = [...new Set(
      allParticipants
        .filter(p => p.participantType === 'agent' && p.participantId.startsWith('agent:'))
        .map(p => p.participantId.slice('agent:'.length)),
    )];
    const allUserIds = [...new Set([...userIds, ...agentOwnerIds])];
    const userMap = new Map<string, { name: string; avatar: string | null }>();
    if (allUserIds.length > 0) {
      const users = await db
        .select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatar })
        .from(schema.users)
        .where(inArray(schema.users.id, allUserIds));
      for (const u of users) {
        userMap.set(u.id, { name: u.name, avatar: u.avatar });
      }
    }

    const systemNegotiatorName = negotiatorRow.length > 0 ? negotiatorRow[0].name : 'Index Negotiator';

    // Map: conversationId → (ownerUserId → agent { name, avatar })
    const claimedAgentByConv = new Map<string, Map<string, { name: string; avatar: string | null }>>();
    for (const r of claimRows) {
      if (!r.ownerId) continue;
      const convMap = claimedAgentByConv.get(r.conversationId) ?? new Map();
      // First row wins after deterministic ordering — most recent claim per owner.
      if (!convMap.has(r.ownerId)) {
        convMap.set(r.ownerId, { name: r.agentName, avatar: r.avatar });
      }
      claimedAgentByConv.set(r.conversationId, convMap);
    }

    const participantsByConv = new Map<string, ResolvedParticipant[]>();
    for (const p of allParticipants) {
      const list = participantsByConv.get(p.conversationId) ?? [];
      if (p.participantType === 'agent' && p.participantId.startsWith('agent:')) {
        const ownerId = p.participantId.slice('agent:'.length);
        const ownerInfo = userMap.get(ownerId);
        const claimedAgent = claimedAgentByConv.get(p.conversationId)?.get(ownerId);
        list.push({
          participantId: p.participantId,
          participantType: p.participantType,
          name: claimedAgent?.name ?? systemNegotiatorName,
          avatar: ownerInfo?.avatar ?? null,
          ownerName: ownerInfo?.name ?? null,
        });
      } else {
        const userInfo = userMap.get(p.participantId);
        list.push({
          participantId: p.participantId,
          participantType: p.participantType,
          name: userInfo?.name ?? null,
          avatar: userInfo?.avatar ?? null,
        });
      }
      participantsByConv.set(p.conversationId, list);
    }

    const lastMessageByConv = new Map<string, { parts: unknown[]; senderId: string; createdAt: Date }>();
    for (const r of lastMessages) {
      const hiddenAt = hiddenAtByConv.get(r.conversationId);
      if (hiddenAt && r.createdAt <= hiddenAt) continue;
      lastMessageByConv.set(r.conversationId, {
        parts: r.parts as unknown[],
        senderId: r.senderId,
        createdAt: r.createdAt,
      });
    }

    const metaByConv = new Map<string, Record<string, unknown>>();
    const provenanceIntentIds = new Set<string>();
    for (const m of allMeta) {
      const metadata = m.metadata as Record<string, unknown>;
      const publicMetadata = { ...metadata };
      delete publicMetadata.matchProvenance;
      metaByConv.set(m.conversationId, publicMetadata);
      if (Array.isArray(metadata.matchProvenance)) {
        for (const rawEntry of metadata.matchProvenance) {
          if (!isMatchProvenanceEntry(rawEntry)) continue;
          for (const intent of rawEntry.intents) {
            if (intent.userId === viewerUserId) provenanceIntentIds.add(intent.intentId);
          }
        }
      }
    }

    // Resolve only the viewer's own intent titles. Filtering by owner in the
    // query is a second privacy boundary: counterpart intent IDs in metadata
    // can never become visible through a conversation summary.
    const viewerIntentRows = provenanceIntentIds.size > 0
      ? await db
        .select({ id: schema.intents.id, payload: schema.intents.payload, summary: schema.intents.summary })
        .from(schema.intents)
        .where(and(
          inArray(schema.intents.id, [...provenanceIntentIds]),
          eq(schema.intents.userId, viewerUserId),
        ))
      : [];
    const viewerIntentTitles = new Map(
      viewerIntentRows.map((intent) => [intent.id, intent.summary?.trim() || intent.payload]),
    );

    const viaByConv = new Map<string, Array<{ intentId: string; opportunityId: string; title: string }>>();
    for (const metadataRow of allMeta) {
      const metadata = metadataRow.metadata as Record<string, unknown>;
      if (!Array.isArray(metadata.matchProvenance)) continue;
      const entries = metadata.matchProvenance
        .filter(isMatchProvenanceEntry)
        .map((entry, index) => ({ entry, index }))
        .sort((a, b) => {
          const recordedAtDelta = new Date(b.entry.recordedAt).getTime() - new Date(a.entry.recordedAt).getTime();
          return Number.isNaN(recordedAtDelta) || recordedAtDelta === 0
            ? b.index - a.index
            : recordedAtDelta;
        });
      const via: Array<{ intentId: string; opportunityId: string; title: string }> = [];
      for (const { entry } of entries) {
        for (const intent of entry.intents) {
          const title = intent.userId === viewerUserId ? viewerIntentTitles.get(intent.intentId) : undefined;
          if (title) via.push({ intentId: intent.intentId, opportunityId: entry.opportunityId, title });
        }
      }
      viaByConv.set(metadataRow.conversationId, via);
    }

    const negotiationByConv = new Map<string, NonNullable<ConversationSummary['negotiation']>>();
    for (const row of latestNegotiationTasks) {
      const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const outcome = readNegotiationOutcome(row.artifactParts);
      const priorTurnCount = typeof metadata.priorTurnCount === 'number' && Number.isFinite(metadata.priorTurnCount)
        ? metadata.priorTurnCount
        : 0;
      const maxTurns = typeof metadata.maxTurns === 'number' && Number.isFinite(metadata.maxTurns)
        ? metadata.maxTurns
        : null;
      // A screened-out outreach gate is private to the client that initiated
      // it. Never project its lifecycle to the counterparty through the shared
      // A2A conversation.
      const initiatorUserId = readInitiatorUserId(metadata);
      if (outcome?.reason === 'screened_out' && initiatorUserId !== viewerUserId) continue;
      negotiationByConv.set(row.conversationId, {
        taskId: row.taskId,
        state: row.state,
        statusTimestamp: row.statusTimestamp,
        opportunityId: typeof metadata.opportunityId === 'string' ? metadata.opportunityId : null,
        opportunityStatus: row.opportunityStatus,
        acceptedByViewer: row.opportunityAcceptedBy === viewerUserId,
        turnCount: priorTurnCount + (outcome?.turnCount ?? Number(row.currentTurnCount)),
        maxTurns,
        signalCount: readNegotiationSignalCount(metadata),
        outcome: outcome ? { hasOpportunity: outcome.hasOpportunity, reason: outcome.reason } : null,
        // IND-610: the owner-facing outreach-gate decision. The ownership
        // check lives inside the projection and is re-applied there — it is
        // not inherited from the `screened_out` skip above, which is a listing
        // rule for this one query rather than a privacy guarantee any caller
        // of the projection can rely on. Named-field projection only; the raw
        // `tasks.metadata` blob is never returned.
        screenDecision: projectOwnerScreenDecision(metadata, outcome, viewerUserId),
        updatedAt: row.updatedAt,
      });
    }

    return convs.map((c) => ({
      ...c,
      participants: participantsByConv.get(c.id) ?? [],
      lastMessage: lastMessageByConv.get(c.id) ?? null,
      metadata: metaByConv.get(c.id) ?? null,
      via: viaByConv.get(c.id) ?? [],
      unreadCount: unreadCountByConv.get(c.id) ?? 0,
      ...(includeNegotiationLifecycle ? { negotiation: negotiationByConv.get(c.id) ?? null } : {}),
    }));
  }

  /**
   * Finds an existing DM between exactly two users, or creates one.
   * Uses a unique `dmPair` column to prevent duplicate DMs under concurrency.
   * @param userA - First user ID
   * @param userB - Second user ID
   * @returns The existing or newly created conversation
   */
  async getOrCreateDM(userA: string, userB: string, participantType: 'user' | 'agent' = 'user'): Promise<Conversation> {
    if (userA === userB) {
      throw new Error('Cannot create a DM with yourself');
    }

    const dmPair = [userA, userB].sort().join(':');

    // Try to find existing DM by the unique pair key
    const [existing] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.dmPair, dmPair))
      .limit(1);

    if (existing) return existing;

    // Try to create — unique constraint prevents duplicates
    try {
      return await this.createConversationWithDmPair(
        [
          { participantId: userA, participantType },
          { participantId: userB, participantType },
        ],
        dmPair,
      );
    } catch (err: unknown) {
      // Unique constraint violation — concurrent create won
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('unique') || msg.includes('duplicate')) {
        const [conv] = await db
          .select()
          .from(schema.conversations)
          .where(eq(schema.conversations.dmPair, dmPair))
          .limit(1);
        if (conv) return conv;
      }
      throw err;
    }
  }

  /**
   * Creates a conversation with a dmPair key for DM deduplication.
   * @param participants - List of participant descriptors
   * @param dmPair - Normalized pair key (sorted user IDs joined by ':')
   * @returns The newly created conversation row
   */
  private async createConversationWithDmPair(
    participants: { participantId: string; participantType: 'user' | 'agent' }[],
    dmPair: string,
  ): Promise<Conversation> {
    const id = crypto.randomUUID();
    const now = new Date();

    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({ id, dmPair, createdAt: now, updatedAt: now });
      if (participants.length > 0) {
        await tx.insert(schema.conversationParticipants).values(
          participants.map((p) => ({
            conversationId: id,
            participantId: p.participantId,
            participantType: p.participantType,
          })),
        );
      }
    });

    return { id, dmPair, persona: 'none', lastMessageAt: null, createdAt: now, updatedAt: now };
  }

  /**
   * Deletes a conversation (cascades to participants, messages, tasks, artifacts).
   * @param id - Conversation ID
   */
  async deleteConversation(id: string): Promise<void> {
    await db.delete(schema.conversations).where(eq(schema.conversations.id, id));
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Messages
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates a message, stamps its durable conversation session, and updates the
   * conversation timestamp. A transaction-scoped advisory lock serializes
   * writers for a conversation so concurrent writes cannot open duplicate
   * sessions.
   *
   * @param data - Message payload.
   * @returns The inserted and session-stamped message row.
   */
  async createMessage(data: {
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId?: string;
    metadata?: Record<string, unknown> | null;
    extensions?: string[];
    referenceTaskIds?: string[];
    continuationExecution?: ContinuationExecutionFence;
  }): Promise<Message> {
    const message = await this.insertMessageWithConversationSession({
      id: crypto.randomUUID(),
      conversationId: data.conversationId,
      senderId: data.senderId,
      role: data.role,
      parts: data.parts,
      taskId: data.taskId ?? null,
      metadata: data.metadata ?? null,
      extensions: data.extensions ?? null,
      referenceTaskIds: data.referenceTaskIds ?? null,
    }, data.continuationExecution);

    // All message writers (including the protocol negotiation graph) converge
    // here. Publish only after persistence, and only to authenticated owners
    // represented by the stored participant rows.
    try {
      const senderUserId = data.senderId.startsWith('agent:')
        ? data.senderId.slice('agent:'.length)
        : data.senderId;
      const [sender] = await db
        .select({ name: schema.users.name, avatar: schema.users.avatar })
        .from(schema.users)
        .where(eq(schema.users.id, senderUserId))
        .limit(1);
      await publishConversationMessageEvent(
        {
          ...message,
          ...(sender?.name?.trim() ? { senderName: sender.name.trim() } : {}),
          ...(sender?.avatar?.trim() ? { senderAvatar: sender.avatar.trim() } : {}),
        },
        await this.getParticipants(data.conversationId),
      );
    } catch (error) {
      logger.error('Failed to publish conversation SSE event', {
        conversationId: data.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return message;
  }

  /**
   * Persist a message under the durable session selected for its task or
   * conversation activity window.
   *
   * @param data - Fully normalized message fields.
   * @returns The newly persisted message.
   */
  private async insertMessageWithConversationSession(data: {
    id: string;
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId: string | null;
    metadata: Record<string, unknown> | null;
    extensions: string[] | null;
    referenceTaskIds: string[] | null;
  }, continuationExecution?: ContinuationExecutionFence): Promise<Message> {
    return db.transaction(async (tx) => {
      if (continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      }
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${data.conversationId}`}, 0)
        )
      `);

      const now = new Date();
      let sessionId: string;

      if (data.taskId) {
        const [existingTaskSession] = await tx
          .select({ id: schema.conversationSessions.id })
          .from(schema.conversationSessions)
          .where(eq(schema.conversationSessions.taskId, data.taskId))
          .limit(1);

        if (existingTaskSession) {
          sessionId = existingTaskSession.id;
          await tx
            .update(schema.conversationSessions)
            .set({ lastMessageAt: now })
            .where(eq(schema.conversationSessions.id, sessionId));
        } else {
          sessionId = crypto.randomUUID();
          await tx.insert(schema.conversationSessions).values({
            id: sessionId,
            conversationId: data.conversationId,
            taskId: data.taskId,
            startedAt: now,
            lastMessageAt: now,
          });
        }
      } else {
        const [currentSession] = await tx
          .select()
          .from(schema.conversationSessions)
          .where(and(
            eq(schema.conversationSessions.conversationId, data.conversationId),
            isNull(schema.conversationSessions.taskId),
          ))
          .orderBy(
            desc(schema.conversationSessions.lastMessageAt),
            desc(schema.conversationSessions.startedAt),
            desc(schema.conversationSessions.id),
          )
          .limit(1);

        const startsNewSession = !currentSession
          || now.getTime() - currentSession.lastMessageAt.getTime() > getChatSessionGapMs();
        if (startsNewSession) {
          sessionId = crypto.randomUUID();
          await tx.insert(schema.conversationSessions).values({
            id: sessionId,
            conversationId: data.conversationId,
            startedAt: now,
            lastMessageAt: now,
          });
        } else {
          sessionId = currentSession.id;
          await tx
            .update(schema.conversationSessions)
            .set({ lastMessageAt: now })
            .where(eq(schema.conversationSessions.id, sessionId));
        }
      }

      const [message] = await tx
        .insert(schema.messages)
        .values({ ...data, sessionId, createdAt: now })
        .returning();

      await tx
        .update(schema.conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, data.conversationId));
      await tx
        .update(schema.conversationParticipants)
        .set({ hiddenAt: null })
        .where(and(
          eq(schema.conversationParticipants.conversationId, data.conversationId),
          eq(schema.conversationParticipants.participantId, data.senderId),
        ));

      return message;
    });
  }

  /**
   * Deliver a claimed pool-question push atomically with its message ledger.
   * The question row is locked before lifecycle recheck, so answer/dismiss and
   * message insertion cannot cross. The question ID is the deterministic
   * message ID and retries verify, rather than duplicate, an existing insert.
   *
   * @param input - Claimed question, stable negotiator DM, and public template.
   * @returns Whether a message was freshly delivered or delivery was suppressed.
   * @throws When the session or deterministic message conflicts with the claim.
   */
  async deliverClaimedPoolQuestionPush(input: {
    questionId: string;
    recipientId: string;
    intentId: string;
    cycleKey: string;
    conversationId: string;
    messageText: string;
  }): Promise<{ status: 'delivered'; inserted: boolean } | { status: 'suppressed' }> {
    return db.transaction(async (tx) => {
      const [clock] = await tx.execute<{ now: Date | string }>(sql`SELECT transaction_timestamp() AS now`);
      const transactionNow = clock.now instanceof Date ? clock.now : new Date(clock.now);
      if (Number.isNaN(transactionNow.getTime())) {
        throw new Error('Database returned an invalid transaction timestamp');
      }
      const [question] = await tx
        .select()
        .from(schema.questions)
        .where(eq(schema.questions.id, input.questionId))
        .limit(1)
        .for('update');
      if (!question) throw new Error(`Pool push question ${input.questionId} is missing`);

      const detection = question.detection as import('../schemas/database.schema').QuestionDetection;
      const push = detection.push;
      if (
        !push
        || push.recipientId !== input.recipientId
        || push.intentId !== input.intentId
        || push.cycleKey !== input.cycleKey
        || push.messageId !== input.questionId
      ) {
        throw new Error(`Pool push claim conflict for question ${input.questionId}`);
      }
      if (push.deliveryStatus === 'suppressed' || push.deliveryStatus === 'failed') {
        return { status: 'suppressed' } as const;
      }
      const suppress = async (): Promise<{ status: 'suppressed' }> => {
        if (!detection.pushedAt && push.deliveryStatus !== 'delivered') {
          await tx.update(schema.questions)
            .set({
              detection: {
                ...detection,
                push: {
                  ...push,
                  deliveryStatus: 'suppressed',
                  suppressedAt: transactionNow.toISOString(),
                },
              },
            })
            .where(eq(schema.questions.id, input.questionId));
        }
        return { status: 'suppressed' };
      };

      if (
        question.status !== 'pending'
        || (question.expiresAt !== null && question.expiresAt <= transactionNow)
      ) return suppress();

      const [intent] = await tx
        .select({
          userId: schema.intents.userId,
          status: schema.intents.status,
          archivedAt: schema.intents.archivedAt,
          lastVisitedAt: schema.intents.lastVisitedAt,
        })
        .from(schema.intents)
        .where(eq(schema.intents.id, input.intentId))
        .limit(1)
        .for('update');
      if (
        !intent
        || intent.userId !== input.recipientId
        || intent.archivedAt !== null
        || (intent.status !== null && intent.status !== 'ACTIVE')
        || (intent.lastVisitedAt !== null && intent.lastVisitedAt > question.createdAt)
      ) return suppress();

      const [session] = await tx
        .select({
          conversationId: schema.chatSessionScopes.conversationId,
          userId: schema.chatSessionScopes.userId,
          scopeType: schema.chatSessionScopes.scopeType,
          scopeId: schema.chatSessionScopes.scopeId,
          persona: schema.conversations.persona,
        })
        .from(schema.chatSessionScopes)
        .innerJoin(
          schema.conversations,
          eq(schema.conversations.id, schema.chatSessionScopes.conversationId),
        )
        .where(eq(schema.chatSessionScopes.conversationId, input.conversationId))
        .limit(1)
        .for('update');
      if (
        !session
        || session.userId !== input.recipientId
        || session.scopeType !== NEGOTIATOR_INTENT_SCOPE_TYPE
        || session.scopeId !== input.intentId
        || session.persona !== NEGOTIATOR_PERSONA
      ) {
        throw new Error(`Pool push requires the recipient's negotiator session pinned to intent ${input.intentId}`);
      }

      const [existing] = await tx
        .select()
        .from(schema.messages)
        .where(eq(schema.messages.id, input.questionId))
        .limit(1);
      const messageMetadata: Record<string, string> = {
        source: 'pool_question_push',
        questionId: input.questionId,
        recipientId: input.recipientId,
        intentId: input.intentId,
        cycleKey: input.cycleKey,
      };
      let inserted = false;
      const expectedParts = [{ type: 'text', text: input.messageText }];
      if (existing) {
        if (
          existing.conversationId !== input.conversationId
          || existing.senderId !== SYSTEM_AGENT_ID
          || existing.role !== 'agent'
          || !isExactPoolPushMetadata(existing.metadata, messageMetadata)
          || !isExactPoolPushParts(existing.parts, input.messageText)
        ) {
          throw new Error(`Deterministic pool push message ${input.questionId} conflicts with existing data`);
        }
      } else {
        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`conversation-session:${input.conversationId}`}, 0)
          )
        `);
        const [currentSession] = await tx
          .select()
          .from(schema.conversationSessions)
          .where(and(
            eq(schema.conversationSessions.conversationId, input.conversationId),
            isNull(schema.conversationSessions.taskId),
          ))
          .orderBy(
            desc(schema.conversationSessions.lastMessageAt),
            desc(schema.conversationSessions.startedAt),
            desc(schema.conversationSessions.id),
          )
          .limit(1);
        const startsNewSession = !currentSession
          || transactionNow.getTime() - currentSession.lastMessageAt.getTime() > getChatSessionGapMs();
        const sessionId = startsNewSession ? crypto.randomUUID() : currentSession.id;
        if (startsNewSession) {
          await tx.insert(schema.conversationSessions).values({
            id: sessionId,
            conversationId: input.conversationId,
            startedAt: transactionNow,
            lastMessageAt: transactionNow,
          });
        } else {
          await tx.update(schema.conversationSessions)
            .set({ lastMessageAt: transactionNow })
            .where(eq(schema.conversationSessions.id, sessionId));
        }
        await tx.insert(schema.messages).values({
          id: input.questionId,
          conversationId: input.conversationId,
          sessionId,
          senderId: SYSTEM_AGENT_ID,
          role: 'agent',
          parts: expectedParts,
          metadata: messageMetadata,
          createdAt: transactionNow,
        });
        await tx.update(schema.conversations)
          .set({ lastMessageAt: transactionNow, updatedAt: transactionNow })
          .where(eq(schema.conversations.id, input.conversationId));
        await tx.update(schema.conversationParticipants)
          .set({ hiddenAt: null })
          .where(and(
            eq(schema.conversationParticipants.conversationId, input.conversationId),
            eq(schema.conversationParticipants.participantId, input.recipientId),
          ));
        inserted = true;
      }

      const deliveredAt = detection.pushedAt ?? transactionNow.toISOString();
      await tx.update(schema.questions)
        .set({
          detection: {
            ...detection,
            pushedAt: deliveredAt,
            push: {
              ...push,
              deliveryStatus: 'delivered',
              conversationId: input.conversationId,
              deliveredAt,
            },
          },
        })
        .where(eq(schema.questions.id, input.questionId));
      return { status: 'delivered', inserted } as const;
    });
  }

  /**
   * Retrieves messages for a conversation, ordered by creation time ascending.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), or taskId filter
   * @returns Ordered list of messages
   */
  async getMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string; taskId?: string; userId?: string },
  ): Promise<Message[]> {
    const conditions = [eq(schema.messages.conversationId, conversationId)];

    // Filter out messages before hiddenAt for this user
    if (opts?.userId) {
      const [participant] = await db
        .select({ hiddenAt: schema.conversationParticipants.hiddenAt })
        .from(schema.conversationParticipants)
        .where(and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, opts.userId),
        ))
        .limit(1);
      if (participant?.hiddenAt) {
        conditions.push(gt(schema.messages.createdAt, participant.hiddenAt));
      }
    }

    if (opts?.taskId) {
      conditions.push(eq(schema.messages.taskId, opts.taskId));
    }

    if (opts?.before) {
      // Cursor-based: get messages created before the given message
      const [ref] = await db
        .select({ createdAt: schema.messages.createdAt, id: schema.messages.id })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.id, opts.before),
          eq(schema.messages.conversationId, conversationId),
        ))
        .limit(1);

      if (ref) {
        const beforeCondition = or(
          lt(schema.messages.createdAt, ref.createdAt),
          and(
            eq(schema.messages.createdAt, ref.createdAt),
            lt(schema.messages.id, ref.id),
          ),
        );
        if (beforeCondition) conditions.push(beforeCondition);
      }
    }

    // Query newest messages first (DESC), then reverse for chronological order.
    // This ensures limit returns the LATEST N messages, not the oldest.
    let query = db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id));

    if (opts?.limit) {
      query = query.limit(opts.limit) as typeof query;
    }

    const rows = await query;
    return rows.reverse();
  }

  /**
   * Load one durable conversation session and its messages. Calling without a
   * cursor selects the latest session; a `beforeSessionId` cursor selects the
   * immediately preceding session. The message read stays participant-scoped.
   *
   * @param conversationId - Conversation to read.
   * @param opts - Visibility, A2A task, and prior-session cursor constraints.
   * @returns Exactly one session (when present), its messages, and whether an earlier session exists.
   */
  async getConversationSessionHistory(
    conversationId: string,
    opts?: { beforeSessionId?: string; taskId?: string; userId?: string },
  ): Promise<{
    session: ConversationSession | null;
    messages: Message[];
    hasPreviousSession: boolean;
    /** opportunityId from the session's negotiation task, if any. */
    sessionOpportunityId: string | null;
    /** Current status of the session's opportunity, if any. */
    sessionOpportunityStatus: string | null;
  }> {
    const conditions = [eq(schema.conversationSessions.conversationId, conversationId)];
    if (opts?.taskId) {
      conditions.push(eq(schema.conversationSessions.taskId, opts.taskId));
    } else if (opts?.beforeSessionId) {
      const [cursor] = await db
        .select({
          id: schema.conversationSessions.id,
          startedAt: schema.conversationSessions.startedAt,
        })
        .from(schema.conversationSessions)
        .where(and(
          eq(schema.conversationSessions.id, opts.beforeSessionId),
          eq(schema.conversationSessions.conversationId, conversationId),
        ))
        .limit(1);
      if (!cursor) {
        return { session: null, messages: [], hasPreviousSession: false, sessionOpportunityId: null, sessionOpportunityStatus: null };
      }
      const beforeSessionCondition = or(
        lt(schema.conversationSessions.startedAt, cursor.startedAt),
        and(
          eq(schema.conversationSessions.startedAt, cursor.startedAt),
          lt(schema.conversationSessions.id, cursor.id),
        ),
      );
      if (beforeSessionCondition) conditions.push(beforeSessionCondition);
    }

    const [session] = await db
      .select()
      .from(schema.conversationSessions)
      .where(and(...conditions))
      .orderBy(
        desc(schema.conversationSessions.startedAt),
        desc(schema.conversationSessions.id),
      )
      .limit(1);
    if (!session) return { session: null, messages: [], hasPreviousSession: false, sessionOpportunityId: null, sessionOpportunityStatus: null };

    const messageConditions = [eq(schema.messages.sessionId, session.id)];
    if (opts?.userId) {
      const [participant] = await db
        .select({ hiddenAt: schema.conversationParticipants.hiddenAt })
        .from(schema.conversationParticipants)
        .where(and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, opts.userId),
        ))
        .limit(1);
      if (participant?.hiddenAt) {
        messageConditions.push(gt(schema.messages.createdAt, participant.hiddenAt));
      }
    }

    const messages = await db
      .select()
      .from(schema.messages)
      .where(and(...messageConditions))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

    const previousConditions = [eq(schema.conversationSessions.conversationId, conversationId)];
    if (opts?.taskId) {
      previousConditions.push(eq(schema.conversationSessions.taskId, opts.taskId));
    } else {
      const previousSessionCondition = or(
        lt(schema.conversationSessions.startedAt, session.startedAt),
        and(
          eq(schema.conversationSessions.startedAt, session.startedAt),
          lt(schema.conversationSessions.id, session.id),
        ),
      );
      if (previousSessionCondition) previousConditions.push(previousSessionCondition);
    }
    const [previous] = await db
      .select({ id: schema.conversationSessions.id })
      .from(schema.conversationSessions)
      .where(and(...previousConditions))
      .limit(1);

    // IND-570: resolve opportunity attribution for this session so the web
    // client can label older sections with the opportunity title + outcome chip.
    let sessionOpportunityId: string | null = null;
    let sessionOpportunityStatus: string | null = null;
    if (session.taskId) {
      const [taskOpp] = await db
        .select({
          opportunityId: sql<string | null>`(${schema.tasks.metadata}->>'opportunityId')`,
          opportunityStatus: opportunities.status,
        })
        .from(schema.tasks)
        .leftJoin(opportunities, sql`(${schema.tasks.metadata}->>'opportunityId') = ${opportunities.id}`)
        .where(eq(schema.tasks.id, session.taskId))
        .limit(1);
      if (taskOpp?.opportunityId) {
        sessionOpportunityId = taskOpp.opportunityId;
        sessionOpportunityStatus = taskOpp.opportunityStatus ?? null;
      }
    }

    return { session, messages, hasPreviousSession: Boolean(previous), sessionOpportunityId, sessionOpportunityStatus };
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Conversation State
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Bumps the lastMessageAt timestamp on a conversation to now.
   * @param conversationId - Conversation ID
   */
  async updateLastMessageAt(conversationId: string): Promise<void> {
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.conversations.id, conversationId));
  }

  /**
   * Retrieves participant info for a conversation.
   * @param conversationId - Conversation ID
   * @returns Array of participant records
   */
  async getParticipants(conversationId: string) {
    return db
      .select({
        participantId: schema.conversationParticipants.participantId,
        participantType: schema.conversationParticipants.participantType,
      })
      .from(schema.conversationParticipants)
      .where(eq(schema.conversationParticipants.conversationId, conversationId));
  }

  /**
   * Checks whether a user is a participant in a conversation.
   * @param conversationId - Conversation ID
   * @param userId - User ID to check
   * @returns True if the user is a participant
   */
  async isParticipant(conversationId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      )
      .limit(1);
    return !!row;
  }

  /**
   * Marks a conversation read for a specific participant.
   * @param userId - The participant marking the conversation read
   * @param conversationId - Conversation ID
   */
  async markConversationRead(userId: string, conversationId: string): Promise<void> {
    await db
      .update(schema.conversationParticipants)
      .set({ lastReadAt: new Date() })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      );
  }

  /**
   * Hides a conversation for a specific user by setting hiddenAt.
   * @param userId - The user hiding the conversation
   * @param conversationId - The conversation to hide
   */
  async hideConversation(userId: string, conversationId: string): Promise<void> {
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: new Date() })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      );
  }

  /**
   * Unhides a conversation for a specific user by clearing hiddenAt.
   * @param userId - The user unhiding the conversation
   * @param conversationId - Conversation ID
   */
  async unhideConversation(userId: string, conversationId: string): Promise<void> {
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      );
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Metadata
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Upserts metadata for a conversation.
   * @param conversationId - Conversation ID
   * @param metadata - Arbitrary JSON metadata
   */
  async upsertMetadata(conversationId: string, metadata: Record<string, unknown>): Promise<void> {
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId, metadata })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata, updatedAt: new Date() },
      });
  }

  /**
   * Retrieves metadata for a conversation.
   * @param conversationId - Conversation ID
   * @returns The metadata object, or null if none exists
   */
  async getMetadata(conversationId: string): Promise<Record<string, unknown> | null> {
    const [row] = await db
      .select({ metadata: schema.conversationMetadata.metadata })
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, conversationId))
      .limit(1);

    return (row?.metadata as Record<string, unknown>) ?? null;
  }

  /**
   * Appends match provenance without duplicating an opportunity on DM re-entry.
   * The metadata sidecar remains the source of truth; no message is written.
   */
  async appendMatchProvenance(conversationId: string, provenance: MatchProvenanceEntry): Promise<void> {
    const existing = await this.getMetadata(conversationId);
    const existingEntries = Array.isArray(existing?.matchProvenance)
      ? existing.matchProvenance.filter(isMatchProvenanceEntry)
      : [];
    const nextEntries = [
      ...existingEntries.filter((entry) => entry.opportunityId !== provenance.opportunityId),
      provenance,
    ];
    await this.upsertMetadata(conversationId, {
      ...(existing ?? {}),
      matchProvenance: nextEntries,
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Users
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Looks up a user by ID.
   * @param userId - User ID
   * @returns Core user fields, or null if not found
   */
  async getUser(userId: string): Promise<{ id: string; name: string | null; email: string | null; deletedAt: Date | null } | null> {
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        deletedAt: schema.users.deletedAt,
      })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    return row ?? null;
  }

  /**
   * Returns notification settings for a user, creating a default row if none exists.
   * @param userId - The user's ID
   * @returns The notification settings row (includes unsubscribeToken)
   */
  async getOrCreateNotificationSettings(userId: string): Promise<{ id: string; userId: string; unsubscribeToken: string }> {
    const projection = {
      id: schema.userNotificationSettings.id,
      userId: schema.userNotificationSettings.userId,
      unsubscribeToken: schema.userNotificationSettings.unsubscribeToken,
    };

    await db.insert(schema.userNotificationSettings)
      .values({ userId })
      .onConflictDoNothing({ target: schema.userNotificationSettings.userId });

    const [row] = await db.select(projection)
      .from(schema.userNotificationSettings)
      .where(eq(schema.userNotificationSettings.userId, userId))
      .limit(1);
    if (!row) {
      throw new Error(`Failed to get or create notification settings for user ${userId}`);
    }
    return row;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Tasks
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Atomically creates a negotiation task for an exact persisted opportunity attempt.
   * Task creation and fallback compensation serialize on the same advisory lock;
   * the opportunity row is then locked and revalidated before insertion.
   *
   * @param input - Conversation, opportunity version, and unchanged task metadata
   * @returns The created task, or null when the attempt is stale or already claimed
   */
  async createNegotiationTaskForAttempt(
    input: CreateNegotiationTaskForAttemptInput,
  ): Promise<Task | null> {
    return db.transaction((tx) => createNegotiationTaskForAttemptInTransaction(tx, input));
  }

  /**
   * Creates a task in the submitted state.
   * @param conversationId - Conversation the task belongs to
   * @param metadata - Optional task metadata
   * @returns The newly created task
   */
  async createTask(conversationId: string, metadata?: Record<string, unknown>): Promise<Task> {
    const [task] = await db
      .insert(schema.tasks)
      .values({
        conversationId,
        metadata: metadata ?? null,
      })
      .returning();

    return task;
  }

  /**
   * Idempotently create or recover the exact successor for one durable
   * ask_user settlement. The advisory lock and exact prior-task validation
   * prevent concurrent Bull deliveries from minting sibling continuations.
   */
  async getOrCreateNegotiationContinuationTask(input: {
    priorTaskId: string;
    settlementId: string;
    conversationId: string;
    opportunityId: string;
    metadata: Record<string, unknown>;
  }): Promise<(Task & { created: boolean }) | null> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`negotiation-continuation:${input.settlementId}`}, 0))`);
      const [prior] = await tx.select({ id: schema.tasks.id })
        .from(schema.tasks)
        .where(and(
          eq(schema.tasks.id, input.priorTaskId),
          eq(schema.tasks.conversationId, input.conversationId),
          eq(schema.tasks.state, 'canceled'),
          sql`${schema.tasks.metadata}->>'opportunityId' = ${input.opportunityId}`,
          sql`${schema.tasks.metadata}->'questionSettlement'->>'settlementId' = ${input.settlementId}`,
        ))
        .limit(1)
        .for('update');
      if (!prior) return null;

      const existing = await tx.select()
        .from(schema.tasks)
        .where(and(
          eq(schema.tasks.conversationId, input.conversationId),
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${input.opportunityId}`,
          sql`${schema.tasks.metadata}->>'continuationSettlementId' = ${input.settlementId}`,
          sql`${schema.tasks.metadata}->>'resumeFromTaskId' = ${input.priorTaskId}`,
        ))
        .orderBy(schema.tasks.createdAt, schema.tasks.id)
        .limit(2)
        .for('update');
      if (existing.length > 1) throw new Error('Duplicate negotiation continuation tasks');
      if (existing[0]) return { ...existing[0], created: false };

      const [created] = await tx.insert(schema.tasks).values({
        conversationId: input.conversationId,
        metadata: {
          ...input.metadata,
          continuationSettlementId: input.settlementId,
          resumeFromTaskId: input.priorTaskId,
        },
      }).returning();
      return { ...created, created: true };
    });
  }

  /**
   * Lists old negotiation tasks that may have lost their kickoff or worker job.
   * The state-specific age thresholds deliberately use createdAt for submitted
   * tasks and updatedAt for working tasks.
   */
  async getStaleNegotiationTasks({
    submittedOlderThanMs,
    workingOlderThanMs,
    limit = 25,
  }: StaleNegotiationTasksInput): Promise<StaleNegotiationTask[]> {
    const submittedCutoff = new Date(Date.now() - submittedOlderThanMs);
    const workingCutoff = new Date(Date.now() - workingOlderThanMs);
    const rows = await db
      .select({
        id: schema.tasks.id,
        conversationId: schema.tasks.conversationId,
        state: schema.tasks.state,
        createdAt: schema.tasks.createdAt,
        updatedAt: schema.tasks.updatedAt,
        metadata: schema.tasks.metadata,
      })
      .from(schema.tasks)
      .where(and(
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        notArchivedNegotiationTaskWhere(),
        or(
          and(eq(schema.tasks.state, 'submitted'), lt(schema.tasks.createdAt, submittedCutoff)),
          and(eq(schema.tasks.state, 'working'), lt(schema.tasks.updatedAt, workingCutoff)),
        ),
      ))
      .orderBy(asc(schema.tasks.createdAt))
      .limit(Math.max(1, Math.floor(limit)));

    return rows.map((row) => ({
      ...row,
      state: row.state as 'submitted' | 'working',
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }));
  }

  /**
   * Transitions a stale negotiation task only if its state and timestamp still
   * match the watchdog's read. This is the duplicate-prevention CAS: the stale
   * row is canceled before the new run-existing job can create its replacement.
   */
  async transitionNegotiationTaskForWatchdog({
    taskId,
    expectedState,
    expectedUpdatedAt,
    nextState,
    metadata,
    statusMessage,
  }: WatchdogTaskTransitionInput): Promise<Task | null> {
    const [task] = await db
      .update(schema.tasks)
      .set({
        state: nextState,
        metadata,
        statusMessage,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.state, expectedState),
        eq(schema.tasks.updatedAt, expectedUpdatedAt),
      ))
      .returning();

    return task ?? null;
  }

  /**
   * Transitions a task to a new state.
   * @param taskId - Task ID
   * @param state - New task state
   * @param statusMessage - Optional status message payload
   * @returns The updated task
   * @throws If the task is not found
   */
  async updateTaskState(
    taskId: string,
    state: string,
    statusMessage?: unknown,
    continuationExecution?: ContinuationExecutionFence,
    parkGeneration?: string,
  ): Promise<Task> {
    return db.transaction(async (tx) => {
      if (continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      }
      const [task] = await tx.update(schema.tasks).set({
        state: state as typeof schema.taskStateEnum.enumValues[number],
        statusMessage: statusMessage ?? null,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
        ...(state === 'waiting_for_agent' && parkGeneration
          ? {
              metadata: buildNegotiationParkMetadataSql(parkGeneration),
            }
          : {}),
      }).where(eq(schema.tasks.id, taskId)).returning();
      if (!task) throw new Error(`Task ${taskId} not found`);
      return task;
    });
  }

  /**
   * Linearize one authenticated negotiation pickup outcome with runtime
   * authority and its health heartbeat. The owner advisory lock held by the
   * authority check serializes deselection, disconnect, and setup rotation;
   * task row locks serialize the exact existing/new/empty outcome.
   */
  async pickupNegotiationAtomically(input: {
    agentId: string;
    ownerId: string;
    principal: NegotiationCredentialPrincipal;
    runId?: string;
  }): Promise<AtomicNegotiationPickupResult> {
    if (input.principal.agentId !== input.agentId) return { kind: 'unauthorized' };

    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      if (!await authorizeNegotiationMutationInTransaction(database, input.ownerId, input.principal)) {
        return { kind: 'unauthorized' };
      }

      // Participant validity is a prerequisite for every owner or speaker
      // predicate below. Malformed/empty/duplicate bilateral roles cannot use
      // the source no-history fallback and can never enter a pickup race.
      const validParticipantsWhere = sql`(
        NULLIF(BTRIM(${schema.tasks.metadata}->>'sourceUserId'), '') IS NOT NULL
        AND NULLIF(BTRIM(${schema.tasks.metadata}->>'candidateUserId'), '') IS NOT NULL
        AND ${schema.tasks.metadata}->>'sourceUserId' <> ${schema.tasks.metadata}->>'candidateUserId'
      )`;
      const participantWhere = sql`(
        ${schema.tasks.metadata}->>'sourceUserId' = ${input.ownerId}
        OR ${schema.tasks.metadata}->>'candidateUserId' = ${input.ownerId}
      )`;
      // The parked speaker is authoritative conversation state, not merely a
      // participant. Read the latest canonical sender and persisted action in
      // one correlated selection. Ordinary bilateral turns alternate; an
      // ask_user pause retains that participant sender's floor for the exact
      // settlement-bound successor. Unrelated/system/owner-answer messages are
      // ignored and an empty bilateral history starts with source. This exact
      // predicate runs while the task row is locked, matching the in-memory
      // expectedNegotiationSpeaker helper used by both timeout paths.
      const expectedSpeakerWhere = sql`CASE
        WHEN ${validParticipantsWhere} THEN COALESCE((
          SELECT CASE
            WHEN latest_speaker.action = 'ask_user'
              THEN latest_speaker.sender_id = 'agent:' || ${input.ownerId}
            ELSE latest_speaker.sender_id = 'agent:' || CASE
              WHEN ${schema.tasks.metadata}->>'sourceUserId' = ${input.ownerId}
                THEN ${schema.tasks.metadata}->>'candidateUserId'
              ELSE ${schema.tasks.metadata}->>'sourceUserId'
            END
          END
          FROM (
            SELECT
              speaker_message.sender_id,
              (
                SELECT data_part->'data'->>'action'
                FROM jsonb_array_elements(
                  CASE
                    WHEN jsonb_typeof(speaker_message.parts) = 'array' THEN speaker_message.parts
                    ELSE '[]'::jsonb
                  END
                ) data_part
                WHERE data_part->>'kind' = 'data'
                LIMIT 1
              ) AS action
            FROM ${schema.messages} speaker_message
            WHERE speaker_message.conversation_id = ${schema.tasks.conversationId}
              AND speaker_message.sender_id IN (
                'agent:' || (${schema.tasks.metadata}->>'sourceUserId'),
                'agent:' || (${schema.tasks.metadata}->>'candidateUserId')
              )
            ORDER BY speaker_message.created_at DESC, speaker_message.id DESC
            LIMIT 1
          ) latest_speaker
        ), ${schema.tasks.metadata}->>'sourceUserId' = ${input.ownerId})
        ELSE FALSE
      END`;
      const dedicated = isDedicatedHermesNegotiationAudience(input.principal.audience);
      if (dedicated && !input.runId) return { kind: 'unauthorized' };
      if (dedicated) {
        const [priorRun] = await tx.select({ id: schema.tasks.id }).from(schema.tasks).where(and(
          sql`${schema.tasks.metadata}->'hermesRunCapability'->>'runIdDigest' = ${digestHermesRunId(input.runId!)}`,
          sql`${schema.tasks.metadata}->'hermesRunCapability'->>'credentialId' = ${input.principal.credentialId}`,
          sql`${schema.tasks.metadata}->'hermesRunCapability'->>'agentId' = ${input.principal.agentId}`,
          validParticipantsWhere,
          participantWhere,
        )).limit(1).for('update');
        if (priorRun) return { kind: 'run_exhausted' };
      }

      const [existing] = await tx
        .select()
        .from(schema.tasks)
        .where(and(
          eq(schema.tasks.state, 'claimed'),
          eq(schema.tasks.claimedByAgentId, input.agentId),
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          notArchivedNegotiationTaskWhere(),
          validParticipantsWhere,
          participantWhere,
          expectedSpeakerWhere,
        ))
        .limit(1)
        .for('update');

      const heartbeatAt = new Date();
      if (existing) {
        const existingMetadata = (existing.metadata ?? {}) as Record<string, unknown>;
        const parkStartTime = deriveLegacyNegotiationParkOrigin({
          taskId: existing.id,
          state: 'claimed',
          metadata: existingMetadata,
          statusTimestamp: existing.statusTimestamp,
          claimedAt: existing.claimedAt,
        });
        const parkGeneration = typeof existingMetadata.negotiationParkGeneration === 'string'
          ? existingMetadata.negotiationParkGeneration
          : parkStartTime.toISOString();
        let task = existing;
        let runCapability: string | undefined;
        if (dedicated) {
          const issued = issueHermesRunCapability({
            taskId: existing.id,
            runId: input.runId!,
            principal: input.principal,
            now: heartbeatAt,
          });
          runCapability = issued.capability;
          [task] = await tx.update(schema.tasks).set({
            metadata: {
              ...existingMetadata,
              hermesParkStartedAt: parkStartTime.toISOString(),
              hermesRunCapability: issued.binding,
            },
          }).where(eq(schema.tasks.id, existing.id)).returning();
        }
        await tx.update(schema.agents)
          .set({ lastNegotiationPickupAt: heartbeatAt })
          .where(eq(schema.agents.id, input.agentId));
        return {
          kind: 'existing',
          task,
          parkStartTime,
          parkGeneration,
          ...(runCapability ? { runCapability } : {}),
        };
      }

      const [pending] = await tx
        .select()
        .from(schema.tasks)
        .where(and(
          eq(schema.tasks.state, 'waiting_for_agent'),
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          notArchivedNegotiationTaskWhere(),
          validParticipantsWhere,
          participantWhere,
          expectedSpeakerWhere,
        ))
        .orderBy(asc(schema.tasks.createdAt))
        .limit(1)
        .for('update');

      if (!pending) {
        // A participant task for the other speaker is not an empty successful
        // poll: in particular it must not refresh this non-speaker's health
        // heartbeat. Locking a matching row also makes this decision serialize
        // with simultaneous pickup/respond/continuation transitions.
        const [otherSpeakerTask] = await tx.select({ id: schema.tasks.id })
          .from(schema.tasks)
          .where(and(
            sql`${schema.tasks.state} IN ('waiting_for_agent', 'claimed')`,
            sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
            notArchivedNegotiationTaskWhere(),
            validParticipantsWhere,
            participantWhere,
          ))
          .orderBy(asc(schema.tasks.createdAt))
          .limit(1)
          .for('update');
        if (otherSpeakerTask) return { kind: 'conflict' };
        await tx.update(schema.agents)
          .set({ lastNegotiationPickupAt: heartbeatAt })
          .where(eq(schema.agents.id, input.agentId));
        return { kind: 'empty' };
      }

      const continuation = pending.metadata as { continuationExecution?: { status?: unknown } } | null;
      const parkedContinuation = continuation?.continuationExecution?.status === 'parked';
      const claimed = parkedContinuation
        ? (await claimParkedContinuationExecutionInTransaction(database, pending.id, input.agentId))?.task
        : (await tx.update(schema.tasks)
            .set({
              state: 'claimed',
              claimedByAgentId: input.agentId,
              claimedAt: heartbeatAt,
              updatedAt: heartbeatAt,
            })
            .where(and(
              eq(schema.tasks.id, pending.id),
              eq(schema.tasks.state, 'waiting_for_agent'),
            ))
            .returning())[0];
      if (!claimed) return { kind: 'conflict' };

      const pendingMetadata = (pending.metadata ?? {}) as Record<string, unknown>;
      const parkStartTime = deriveLegacyNegotiationParkOrigin({
        taskId: pending.id,
        state: 'waiting_for_agent',
        metadata: pendingMetadata,
        statusTimestamp: pending.statusTimestamp,
        claimedAt: null,
      });
      const parkGeneration = typeof pendingMetadata.negotiationParkGeneration === 'string'
        ? pendingMetadata.negotiationParkGeneration
        : parkStartTime.toISOString();
      const claimedMetadata = (claimed.metadata ?? {}) as Record<string, unknown>;
      let claimedWithBinding = claimed;
      let runCapability: string | undefined;
      if (dedicated) {
        const issued = issueHermesRunCapability({
          taskId: claimed.id,
          runId: input.runId!,
          principal: input.principal,
          now: heartbeatAt,
        });
        runCapability = issued.capability;
        [claimedWithBinding] = await tx.update(schema.tasks).set({
          metadata: {
            ...claimedMetadata,
            hermesParkStartedAt: parkStartTime.toISOString(),
            hermesRunCapability: issued.binding,
          },
        }).where(and(
          eq(schema.tasks.id, claimed.id),
          eq(schema.tasks.state, 'claimed'),
          eq(schema.tasks.claimedByAgentId, input.agentId),
        )).returning();
        if (!claimedWithBinding) return { kind: 'conflict' };
      }

      await tx.update(schema.agents)
        .set({ lastNegotiationPickupAt: heartbeatAt })
        .where(eq(schema.agents.id, input.agentId));
      return {
        kind: 'claimed',
        task: claimedWithBinding,
        parkStartTime,
        parkGeneration,
        ...(runCapability ? { runCapability } : {}),
      };
    });
  }

  /**
   * Atomically claims a timed-out task for fallback processing.
   *
   * @param taskId - Claimed task to transition.
   * @returns The transitioned task, or null when another path already moved it.
   */
  async transitionClaimedTaskToWorking(
    taskId: string,
    claimedByAgentId: string,
    continuationExecution?: ContinuationExecutionFence,
    principal?: NegotiationCredentialPrincipal,
    ownerId?: string,
    runAuthority?: HermesRunMutationAuthority,
    authorityAlreadyHeld = false,
  ): Promise<Task | null> {
    return db.transaction(async (tx) => {
      if (principal && !authorityAlreadyHeld && (!ownerId || !await authorizeNegotiationMutationInTransaction(
        tx as unknown as typeof db,
        ownerId,
        principal,
      ))) return null;
      if (continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      }
      const [current] = await tx.select().from(schema.tasks).where(and(
        eq(schema.tasks.id, taskId),
        eq(schema.tasks.state, 'claimed'),
        eq(schema.tasks.claimedByAgentId, claimedByAgentId),
      )).limit(1).for('update');
      if (!current) return null;
      if (ownerId) {
        const history = await selectNegotiationTurnHistoryInTransaction(tx, {
          conversationId: current.conversationId,
          metadata: metadataRecord(current.metadata),
        });
        if (expectedNegotiationSpeaker(metadataRecord(current.metadata), history) !== ownerId) return null;
      }

      const now = new Date();
      let metadata = current.metadata;
      if (principal && isDedicatedHermesNegotiationAudience(principal.audience)) {
        if (!runAuthority || runAuthority.outcome !== 'responded') return null;
        const consumed = consumeHermesRunCapabilityMetadata({
          metadata,
          taskId,
          principal,
          authority: runAuthority,
          now,
        });
        if (!consumed) return null;
        metadata = consumed;
      }
      const [task] = await tx
        .update(schema.tasks)
        .set({ state: 'working', metadata, updatedAt: now })
        .where(and(
          eq(schema.tasks.id, taskId),
          eq(schema.tasks.state, 'claimed'),
          eq(schema.tasks.claimedByAgentId, claimedByAgentId),
        ))
        .returning();
      return task ?? null;
    });
  }

  /**
   * Claim-timeout CAS. The job-supplied claim generation, turn cardinality,
   * and optional continuation fence are all validated under the task row lock
   * before the claimed task can move to working.
   */
  async transitionClaimedNegotiationTimeoutToWorking(input: {
    taskId: string;
    claimedByAgentId: string;
    claimedAt: Date;
    turnNumber: number;
    continuation?: {
      priorTaskId: string;
      settlementId: string;
      successorTaskId: string;
      token: string;
      fence: number;
    };
  }): Promise<{ task: Task; continuationExecution?: ContinuationExecutionFence } | null> {
    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      const [current] = await tx.select().from(schema.tasks).where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'claimed'),
        eq(schema.tasks.claimedByAgentId, input.claimedByAgentId),
        eq(schema.tasks.claimedAt, input.claimedAt),
      )).limit(1).for('update');
      if (!current) return null;

      // Match-scoped: the arming side counts THIS negotiation's turns
      // (`payload.history.length`), so a conversation-wide count would never
      // agree in a DM that already holds another negotiation, and the parked
      // turn would never get its fallback.
      const turns = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: current.conversationId,
        metadata: metadataRecord(current.metadata),
      });
      if (turns.length !== input.turnNumber) return null;

      const hasContinuation = hasNegotiationContinuationIdentity(current.metadata);
      let continuationExecution: ContinuationExecutionFence | null = null;
      if (hasContinuation) {
        if (!input.continuation) return null;
        continuationExecution = await readClaimedContinuationExecutionForTimeoutInTransaction(
          database,
          input.taskId,
          input.continuation,
        );
        if (
          !continuationExecution
          || continuationExecution.taskId !== input.continuation.priorTaskId
          || continuationExecution.settlementId !== input.continuation.settlementId
          || continuationExecution.successorTaskId !== input.continuation.successorTaskId
          || continuationExecution.token !== input.continuation.token
          || continuationExecution.fence !== input.continuation.fence
        ) return null;
      } else if (input.continuation) {
        return null;
      }

      const [task] = await tx.update(schema.tasks).set({ state: 'working', updatedAt: new Date() })
        .where(and(
          eq(schema.tasks.id, input.taskId),
          eq(schema.tasks.state, 'claimed'),
          eq(schema.tasks.claimedByAgentId, input.claimedByAgentId),
          eq(schema.tasks.claimedAt, input.claimedAt),
        )).returning();
      if (!task) return null;
      return {
        task,
        ...(continuationExecution ? { continuationExecution } : {}),
      };
    });
  }

  /**
   * Atomically acquire (or resume) one exact ordinary timeout generation. The
   * durable execution record is written in the same transaction as the
   * waiting→working CAS, so Bull redelivery can resume a process crash rather
   * than treating the working row as stale.
   */
  async acquireWaitingNegotiationTimeoutExecution(input: {
    taskId: string;
    parkGeneration: string;
    turnNumber: number;
    continuation?: { priorTaskId: string; settlementId: string; successorTaskId: string; token: string; fence: number };
  }): Promise<AcquiredNegotiationTimeoutExecution | null> {
    const identity: NegotiationTimeoutExecutionIdentity = {
      executionId: negotiationTimeoutExecutionId({
        taskId: input.taskId,
        source: 'ordinary',
        generation: input.parkGeneration,
        turnNumber: input.turnNumber,
        ...(input.continuation ? { continuation: input.continuation } : {}),
      }),
      taskId: input.taskId,
      source: 'ordinary',
      generation: input.parkGeneration,
      turnNumber: input.turnNumber,
    };
    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      const [current] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
      if (!current || metadataRecord(current.metadata).type !== 'negotiation') return null;
      const existing = parseNegotiationTimeoutExecution(
        metadataRecord(current.metadata).negotiationTimeoutExecution,
      );
      if (existing && timeoutExecutionMatches(existing, identity)) {
        if (!['working', 'completed', 'waiting_for_agent'].includes(current.state)) return null;
        let continuationExecution: ContinuationExecutionFence | null = null;
        if (existing.status !== 'completed' && input.continuation) {
          // The initial parked-timeout acquisition rotates the continuation
          // token/fence. The Bull payload remains bound to the old parked
          // identity through executionId; resume rotates the stored claimed
          // identity again to renew its timeout-owned lease.
          const stored = metadataRecord(metadataRecord(current.metadata).continuationExecution);
          const resumedIdentity = typeof stored.priorTaskId === 'string'
            && typeof stored.settlementId === 'string'
            && typeof stored.successorTaskId === 'string'
            && typeof stored.token === 'string'
            && typeof stored.fence === 'number'
            ? {
                priorTaskId: stored.priorTaskId,
                settlementId: stored.settlementId,
                successorTaskId: stored.successorTaskId,
                token: stored.token,
                fence: stored.fence,
              }
            : null;
          if (!resumedIdentity) return null;
          continuationExecution = await rotateClaimedContinuationExecutionForTimeoutInTransaction(
            database,
            input.taskId,
            resumedIdentity,
          );
          if (!continuationExecution) return null;
        }
        return {
          task: current,
          execution: existing,
          ...(continuationExecution ? { continuationExecution } : {}),
        };
      }
      if (
        current.state !== 'waiting_for_agent'
        || metadataRecord(current.metadata).negotiationParkGeneration !== input.parkGeneration
      ) return null;
      // Match-scoped: the arming side counts THIS negotiation's turns
      // (`payload.history.length`), so a conversation-wide count would never
      // agree in a DM that already holds another negotiation and the parked
      // turn would never receive its system-agent fallback.
      const turns = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: current.conversationId,
        metadata: metadataRecord(current.metadata),
      });
      if (turns.length !== input.turnNumber) return null;

      const hasContinuation = hasNegotiationContinuationIdentity(current.metadata);
      let continuationExecution: ContinuationExecutionFence | null = null;
      let acquiredTask = current;
      if (hasContinuation) {
        if (!input.continuation) return null;
        const storedContinuation = metadataRecord(metadataRecord(current.metadata).continuationExecution);
        if (
          storedContinuation.status !== 'parked'
          || storedContinuation.priorTaskId !== input.continuation.priorTaskId
          || storedContinuation.settlementId !== input.continuation.settlementId
          || storedContinuation.successorTaskId !== input.continuation.successorTaskId
          || storedContinuation.token !== input.continuation.token
          || storedContinuation.fence !== input.continuation.fence
        ) return null;
        const claimed = await claimParkedContinuationExecutionInTransaction(
          database,
          input.taskId,
          'system:negotiation-timeout',
        );
        if (!claimed) return null;
        continuationExecution = claimed.execution;
        acquiredTask = claimed.task;
      } else if (input.continuation) {
        return null;
      }

      const now = new Date();
      const execution: NegotiationTimeoutExecutionRecord = {
        version: 1,
        ...identity,
        status: 'pending',
        createdAt: now.toISOString(),
      };
      const [working] = await tx.update(schema.tasks).set({
        state: 'working',
        claimedByAgentId: 'system:negotiation-timeout',
        claimedAt: now,
        updatedAt: now,
        metadata: { ...metadataRecord(acquiredTask.metadata), negotiationTimeoutExecution: execution },
      }).where(eq(schema.tasks.id, input.taskId)).returning();
      return working ? {
        task: working,
        execution,
        ...(continuationExecution ? { continuationExecution } : {}),
      } : null;
    });
  }

  /** Same durable acquisition contract for an exact claimed generation. */
  async acquireClaimedNegotiationTimeoutExecution(input: {
    taskId: string;
    claimedByAgentId: string;
    claimedAt: Date;
    turnNumber: number;
    continuation?: { priorTaskId: string; settlementId: string; successorTaskId: string; token: string; fence: number };
  }): Promise<AcquiredNegotiationTimeoutExecution | null> {
    const generation = input.claimedAt.toISOString();
    const identity: NegotiationTimeoutExecutionIdentity = {
      executionId: negotiationTimeoutExecutionId({
        taskId: input.taskId,
        source: 'claim',
        generation,
        turnNumber: input.turnNumber,
        ...(input.continuation ? { continuation: input.continuation } : {}),
      }),
      taskId: input.taskId,
      source: 'claim',
      generation,
      turnNumber: input.turnNumber,
    };
    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      const [current] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
      if (!current || metadataRecord(current.metadata).type !== 'negotiation') return null;
      const existing = parseNegotiationTimeoutExecution(
        metadataRecord(current.metadata).negotiationTimeoutExecution,
      );
      if (existing && timeoutExecutionMatches(existing, identity)) {
        if (!['working', 'completed', 'waiting_for_agent'].includes(current.state)) return null;
        let continuationExecution: ContinuationExecutionFence | null = null;
        if (existing.status !== 'completed' && input.continuation) {
          const stored = metadataRecord(metadataRecord(current.metadata).continuationExecution);
          const resumedIdentity = typeof stored.priorTaskId === 'string'
            && typeof stored.settlementId === 'string'
            && typeof stored.successorTaskId === 'string'
            && typeof stored.token === 'string'
            && typeof stored.fence === 'number'
            ? {
                priorTaskId: stored.priorTaskId,
                settlementId: stored.settlementId,
                successorTaskId: stored.successorTaskId,
                token: stored.token,
                fence: stored.fence,
              }
            : null;
          if (!resumedIdentity) return null;
          continuationExecution = await rotateClaimedContinuationExecutionForTimeoutInTransaction(
            database,
            input.taskId,
            resumedIdentity,
          );
          if (!continuationExecution) return null;
        }
        return {
          task: current,
          execution: existing,
          ...(continuationExecution ? { continuationExecution } : {}),
        };
      }
      if (
        current.state !== 'claimed'
        || current.claimedByAgentId !== input.claimedByAgentId
        || current.claimedAt?.getTime() !== input.claimedAt.getTime()
      ) return null;
      // Match-scoped, as above: pickup arms this timer with the negotiation's
      // own turn count.
      const turns = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: current.conversationId,
        metadata: metadataRecord(current.metadata),
      });
      if (turns.length !== input.turnNumber) return null;
      const hasContinuation = hasNegotiationContinuationIdentity(current.metadata);
      let continuationExecution: ContinuationExecutionFence | null = null;
      let acquiredTask = current;
      if (hasContinuation) {
        if (!input.continuation) return null;
        continuationExecution = await rotateClaimedContinuationExecutionForTimeoutInTransaction(
          database,
          input.taskId,
          input.continuation,
        );
        if (!continuationExecution) return null;
        [acquiredTask] = await tx.select().from(schema.tasks)
          .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
        if (!acquiredTask) return null;
      } else if (input.continuation) {
        return null;
      }
      const now = new Date();
      const execution: NegotiationTimeoutExecutionRecord = {
        version: 1,
        ...identity,
        status: 'pending',
        createdAt: now.toISOString(),
      };
      const [working] = await tx.update(schema.tasks).set({
        state: 'working',
        claimedByAgentId: 'system:negotiation-timeout',
        updatedAt: now,
        metadata: { ...metadataRecord(acquiredTask.metadata), negotiationTimeoutExecution: execution },
      }).where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'claimed'),
        eq(schema.tasks.claimedByAgentId, input.claimedByAgentId),
        eq(schema.tasks.claimedAt, input.claimedAt),
      )).returning();
      return working ? {
        task: working,
        execution,
        ...(continuationExecution ? { continuationExecution } : {}),
      } : null;
    });
  }

  /** Persist the provider result before any dialogue effect is attempted. */
  async recordNegotiationTimeoutInvocation(input: {
    executionId: string;
    taskId: string;
    turn: NegotiationTimeoutCompletionPlan['turn'];
  }): Promise<AcquiredNegotiationTimeoutExecution | null> {
    return db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
      if (!task || task.state !== 'working') return null;
      const metadata = metadataRecord(task.metadata);
      const execution = parseNegotiationTimeoutExecution(metadata.negotiationTimeoutExecution);
      if (!execution || execution.executionId !== input.executionId) return null;
      if (execution.status === 'completed' || execution.status === 'invoked') {
        return { task, execution };
      }
      const invoked: NegotiationTimeoutExecutionRecord = {
        ...execution,
        status: 'invoked',
        turn: input.turn,
        invokedAt: new Date().toISOString(),
      };
      const [updated] = await tx.update(schema.tasks).set({
        metadata: { ...metadata, negotiationTimeoutExecution: invoked },
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, input.taskId)).returning();
      return updated ? { task: updated, execution: invoked } : null;
    });
  }

  /**
   * Commit the deterministic timeout turn, task/artifact/opportunity effects,
   * continuation receipt, and queue outbox as one transaction. Fault injection
   * is test-gated and therefore proves every persistence boundary rolls back.
   */
  async completeNegotiationTimeoutExecution(
    plan: NegotiationTimeoutCompletionPlan,
    continuationExecution?: ContinuationExecutionFence,
    faultAfterStep?: (step: NegotiationTimeoutAtomicStep) => void | Promise<void>,
  ): Promise<AcquiredNegotiationTimeoutExecution | null> {
    if (faultAfterStep && (
      process.env.NODE_ENV !== 'test'
      || process.env.TEST_DATABASE_SAFE !== '1'
      || (process.env.API_TEST_DATABASE_READY !== '1' && process.env.API_TEST_REQUIRE_DATABASE !== '1')
    )) throw new Error('Timeout execution fault injection requires the guarded disposable database test gate');
    const fault = async (step: NegotiationTimeoutAtomicStep) => faultAfterStep?.(step);
    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, plan.taskId)).limit(1).for('update');
      if (!task) return null;
      const metadata = metadataRecord(task.metadata);
      const execution = parseNegotiationTimeoutExecution(metadata.negotiationTimeoutExecution);
      if (!execution || execution.executionId !== plan.executionId) return null;
      if (execution.status === 'completed') return { task, execution };
      if (task.state !== 'working' || execution.status !== 'invoked' || !execution.turn) return null;
      if (continuationExecution) {
        await assertContinuationExecutionEffect(database, continuationExecution);
      } else if (hasNegotiationContinuationIdentity(task.metadata)) {
        return null;
      }

      const now = new Date();
      const committedRearm = plan.rearm
        ? {
            parkGeneration: plan.rearm.parkGeneration,
            deadlineAt: new Date(now.getTime() + plan.rearm.parkWindowMs).toISOString(),
            ...(plan.rearm.continuation ? { continuation: plan.rearm.continuation } : {}),
          }
        : null;
      const messageId = `${plan.executionId}:message`;
      const artifactId = `${plan.executionId}:artifact`;
      const sessionIdentity = `${plan.executionId}:session`;
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${task.conversationId}`}, 0)
        )
      `);
      const [existingSession] = await tx.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.taskId, task.id)).limit(1);
      const sessionId = existingSession?.id ?? sessionIdentity;
      if (existingSession) {
        await tx.update(schema.conversationSessions).set({ lastMessageAt: now })
          .where(eq(schema.conversationSessions.id, sessionId));
      } else {
        await tx.insert(schema.conversationSessions).values({
          id: sessionId,
          conversationId: task.conversationId,
          taskId: task.id,
          startedAt: now,
          lastMessageAt: now,
        });
      }
      const taskMetadata = metadataRecord(task.metadata);
      // The orchestration plan includes the exact model turn but sender identity
      // is derived from locked authoritative history, never trusted from a
      // provider response.
      const bilateralHistory = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: task.conversationId,
        metadata: taskMetadata,
      });
      const speakerUserId = expectedNegotiationSpeaker(taskMetadata, bilateralHistory);
      if (!speakerUserId) throw new Error('Timeout execution has malformed bilateral speaker metadata');
      await tx.insert(schema.messages).values({
        id: messageId,
        conversationId: task.conversationId,
        taskId: task.id,
        sessionId,
        senderId: `agent:${speakerUserId}`,
        role: 'agent',
        parts: [{ kind: 'data', data: execution.turn }],
        createdAt: now,
      });
      await tx.update(schema.conversations).set({ lastMessageAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, task.conversationId));
      await fault('message');

      const nextMetadata = {
        ...metadata,
        ...(committedRearm
          ? {
              negotiationParkGeneration: committedRearm.parkGeneration,
              hermesParkStartedAt: now.toISOString(),
            }
          : {}),
      };
      await tx.update(schema.tasks).set({
        state: plan.finalState,
        statusMessage: null,
        statusTimestamp: now,
        metadata: nextMetadata,
        updatedAt: now,
      }).where(eq(schema.tasks.id, task.id));
      await fault('task');

      if (plan.finalState === 'completed') {
        if (!plan.outcome) throw new Error('Terminal timeout execution requires an outcome');
        await tx.insert(schema.artifacts).values({
          id: artifactId,
          taskId: task.id,
          name: 'negotiation-outcome',
          parts: [{ kind: 'data', data: plan.outcome }],
          metadata: {
            hasOpportunity: plan.outcome.hasOpportunity,
            turnCount: plan.turnNumber,
            ...(continuationExecution && plan.continuationOutcome
              ? { continuationOutcome: plan.continuationOutcome }
              : {}),
          },
          createdAt: now,
        });
      }
      await fault('artifact');

      if (plan.opportunity) {
        const [updatedOpportunity] = await tx.update(opportunities).set({
          status: plan.opportunity.status,
          acceptedBy: null,
          updatedAt: now,
        }).where(eq(opportunities.id, plan.opportunity.id)).returning({ id: opportunities.id });
        if (!updatedOpportunity) throw new Error('Required timeout opportunity disappeared');
      }
      await fault('opportunity');

      if (continuationExecution) {
        if (plan.finalState === 'waiting_for_agent') {
          await parkContinuationExecutionInTransaction(database, continuationExecution);
        } else {
          if (!plan.continuationOutcome || plan.continuationOutcome === 'waiting_for_agent') {
            throw new Error('Terminal timeout continuation requires an exact outcome');
          }
          await completeContinuationExecutionInTransaction(database, continuationExecution, {
            priorTaskId: continuationExecution.taskId,
            settlementId: continuationExecution.settlementId,
            successorTaskId: continuationExecution.successorTaskId,
            fence: continuationExecution.fence,
            outcome: plan.continuationOutcome,
          });
        }
      }
      await fault('continuation');

      const completedAt = now.toISOString();
      const receipt = {
        version: 1 as const,
        executionId: execution.executionId,
        taskId: task.id,
        messageId,
        artifactId: plan.finalState === 'completed' ? artifactId : null,
        finalState: plan.finalState,
        turnNumber: plan.turnNumber,
        completedAt,
        rearm: committedRearm,
      };
      const completed: NegotiationTimeoutExecutionRecord = {
        ...execution,
        status: 'completed',
        completedAt,
        receipt,
      };
      const [latest] = await tx.select({ metadata: schema.tasks.metadata }).from(schema.tasks)
        .where(eq(schema.tasks.id, task.id)).limit(1);
      const [updated] = await tx.update(schema.tasks).set({
        metadata: { ...metadataRecord(latest?.metadata), negotiationTimeoutExecution: completed },
        updatedAt: now,
      }).where(eq(schema.tasks.id, task.id)).returning();
      await fault('receipt');
      return updated ? { task: updated, execution: completed } : null;
    });
  }

  /** Acknowledge the deterministic re-arm outbox after Bull accepted it. */
  async markNegotiationTimeoutOutboxDelivered(taskId: string, executionId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, taskId)).limit(1).for('update');
      const metadata = metadataRecord(task?.metadata);
      const execution = parseNegotiationTimeoutExecution(metadata.negotiationTimeoutExecution);
      if (!task || !execution || execution.executionId !== executionId || execution.status !== 'completed') return false;
      if (execution.outboxDeliveredAt) return true;
      const delivered: NegotiationTimeoutExecutionRecord = {
        ...execution,
        outboxDeliveredAt: new Date().toISOString(),
      };
      const [updated] = await tx.update(schema.tasks).set({
        metadata: { ...metadata, negotiationTimeoutExecution: delivered },
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId)).returning({ id: schema.tasks.id });
      return Boolean(updated);
    });
  }

  /** Authoritative global count; unlike the scan, this never uses SKIP LOCKED. */
  async countPendingLegacyNegotiationTimeouts(): Promise<number> {
    const [result] = await db.select({ value: count() }).from(schema.tasks).where(and(
      sql`${schema.tasks.state} IN ('waiting_for_agent', 'claimed')`,
      sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
      notArchivedNegotiationTaskWhere(),
      or(
        sql`NOT (COALESCE(${schema.tasks.metadata}, '{}'::jsonb) ? 'negotiationParkGeneration')`,
        sql`(
          ${schema.tasks.metadata}->'timeoutUpgradeOutbox'->>'version' = '1'
          AND NOT (${schema.tasks.metadata}->'timeoutUpgradeOutbox' ? 'deliveredAt')
        )`,
      ),
    ));
    return Number(result?.value ?? 0);
  }

  /**
   * Lock and stamp a bounded startup-upgrade batch. Generation assignment and
   * the pending queue-installation outbox are one transaction; SKIP LOCKED is
   * only a contention optimization. Global exhaustion is proved separately.
   */
  async prepareLegacyNegotiationTimeoutBatch(input: {
    limit: number;
    parkWindowMs: number;
  }): Promise<TimeoutUpgradeJobIntent[]> {
    return db.transaction(async (tx) => {
      const rows = await tx.select().from(schema.tasks).where(and(
        sql`${schema.tasks.state} IN ('waiting_for_agent', 'claimed')`,
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        notArchivedNegotiationTaskWhere(),
        or(
          sql`NOT (COALESCE(${schema.tasks.metadata}, '{}'::jsonb) ? 'negotiationParkGeneration')`,
          sql`(
            ${schema.tasks.metadata}->'timeoutUpgradeOutbox'->>'version' = '1'
            AND NOT (${schema.tasks.metadata}->'timeoutUpgradeOutbox' ? 'deliveredAt')
          )`,
        ),
      )).orderBy(asc(schema.tasks.id)).limit(Math.max(1, Math.min(250, input.limit)))
        .for('update', { skipLocked: true });
      const intents: TimeoutUpgradeJobIntent[] = [];
      for (const row of rows) {
        const metadata = metadataRecord(row.metadata);
        const state = row.state as 'waiting_for_agent' | 'claimed';
        const parkStartedAt = deriveLegacyNegotiationParkOrigin({
          taskId: row.id,
          state,
          metadata,
          statusTimestamp: row.statusTimestamp,
          claimedAt: row.claimedAt,
        });
        const parkGeneration = typeof metadata.negotiationParkGeneration === 'string'
          ? metadata.negotiationParkGeneration
          : `legacy-park:${row.id}:${parkStartedAt.toISOString()}`;
        const claimAt = state === 'claimed' ? row.claimedAt : null;
        if (state === 'claimed' && !claimAt) {
          throw new Error(`Legacy claimed negotiation timeout lacks claim generation for ${row.id}`);
        }
        const generation = state === 'claimed' ? claimAt!.toISOString() : parkGeneration;
        const priorOutbox = metadata.timeoutUpgradeOutbox && typeof metadata.timeoutUpgradeOutbox === 'object'
          && !Array.isArray(metadata.timeoutUpgradeOutbox)
          ? metadata.timeoutUpgradeOutbox as Record<string, unknown>
          : null;
        const deadlineAt = priorOutbox?.generation === generation && typeof priorOutbox.deadlineAt === 'string'
          ? priorOutbox.deadlineAt
          : new Date(parkStartedAt.getTime() + input.parkWindowMs).toISOString();
        // Arms `turnNumber` for the acquire CAS above, which is match-scoped;
        // a conversation-wide count here would never satisfy it.
        const messageRows = await selectNegotiationTurnHistoryInTransaction(tx, {
          conversationId: row.conversationId,
          metadata,
        });
        const rawContinuation = metadata.continuationExecution && typeof metadata.continuationExecution === 'object'
          && !Array.isArray(metadata.continuationExecution)
          ? metadata.continuationExecution as Record<string, unknown>
          : null;
        const continuation = rawContinuation
          && (rawContinuation.status === 'parked' || rawContinuation.status === 'claimed')
          && typeof rawContinuation.priorTaskId === 'string'
          && typeof rawContinuation.settlementId === 'string'
          && typeof rawContinuation.successorTaskId === 'string'
          && typeof rawContinuation.token === 'string'
          && typeof rawContinuation.fence === 'number'
          ? {
              priorTaskId: rawContinuation.priorTaskId,
              settlementId: rawContinuation.settlementId,
              successorTaskId: rawContinuation.successorTaskId,
              token: rawContinuation.token,
              fence: rawContinuation.fence,
            }
          : undefined;
        const outbox = priorOutbox?.generation === generation
          ? priorOutbox
          : {
              version: 1,
              state,
              generation,
              deadlineAt,
              turnNumber: messageRows.length,
              createdAt: new Date().toISOString(),
              ...(row.claimedByAgentId ? { agentId: row.claimedByAgentId } : {}),
              ...(continuation ? { continuation } : {}),
            };
        await tx.update(schema.tasks).set({
          claimedAt: state === 'claimed' ? claimAt : row.claimedAt,
          metadata: {
            ...metadata,
            negotiationParkGeneration: parkGeneration,
            hermesParkStartedAt: parkStartedAt.toISOString(),
            timeoutUpgradeOutbox: outbox,
          },
          updatedAt: row.updatedAt,
        }).where(eq(schema.tasks.id, row.id));
        if (typeof outbox.deliveredAt === 'string') continue;
        intents.push({
          taskId: row.id,
          state,
          turnNumber: typeof outbox.turnNumber === 'number' ? outbox.turnNumber : messageRows.length,
          generation,
          deadlineAt,
          ...(row.claimedByAgentId ? { agentId: row.claimedByAgentId } : {}),
          ...(continuation ? { continuation } : {}),
        });
      }
      return intents;
    });
  }

  /** Mark only the exact installed upgrade generation delivered. */
  async markLegacyNegotiationTimeoutJobInstalled(input: {
    taskId: string;
    state: 'waiting_for_agent' | 'claimed';
    generation: string;
  }): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
      if (!task || task.state !== input.state) return false;
      const metadata = metadataRecord(task.metadata);
      const outbox = metadata.timeoutUpgradeOutbox && typeof metadata.timeoutUpgradeOutbox === 'object'
        && !Array.isArray(metadata.timeoutUpgradeOutbox)
        ? metadata.timeoutUpgradeOutbox as Record<string, unknown>
        : null;
      if (outbox?.version !== 1 || outbox.generation !== input.generation) return false;
      if (typeof outbox.deliveredAt === 'string') return true;
      const [updated] = await tx.update(schema.tasks).set({
        metadata: {
          ...metadata,
          timeoutUpgradeOutbox: { ...outbox, deliveredAt: new Date().toISOString() },
        },
        // Reconciliation metadata must not move the preserved timeout origin.
        updatedAt: task.updatedAt,
      }).where(eq(schema.tasks.id, input.taskId)).returning({ id: schema.tasks.id });
      return Boolean(updated);
    });
  }

  /**
   * Commit a closed Hermes response and every required durable effect under the
   * owner authority lock in one database transaction. Queue delivery is the
   * sole post-commit side effect and is represented by a durable task outbox.
   */
  async respondHermesNegotiationAtomically(
    input: AtomicHermesResponseInput,
  ): Promise<AtomicHermesResponseResult> {
    if (input.faultAfterStep && (
      process.env.NODE_ENV !== 'test'
      || process.env.TEST_DATABASE_SAFE !== '1'
      || (process.env.API_TEST_DATABASE_READY !== '1' && process.env.API_TEST_REQUIRE_DATABASE !== '1')
    )) throw new Error('Hermes response fault injection requires the guarded disposable database test gate');
    if (
      input.principal.agentId !== input.agentId
      || !isDedicatedHermesNegotiationAudience(input.principal.audience)
      || input.authority.outcome !== 'responded'
    ) return { kind: 'unauthorized' };

    const fault = async (step: HermesResponseAtomicStep): Promise<void> => {
      await input.faultAfterStep?.(step);
    };

    return db.transaction(async (tx) => {
      const database = tx as unknown as typeof db;
      if (!await authorizeNegotiationMutationInTransaction(database, input.ownerId, input.principal)) {
        return { kind: 'unauthorized' } as const;
      }

      const [current] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).limit(1).for('update');
      if (!current) return { kind: 'not_found' } as const;
      const currentMetadata = current.metadata && typeof current.metadata === 'object' && !Array.isArray(current.metadata)
        ? current.metadata as Record<string, unknown>
        : {};
      const binding = parseHermesRunCapabilityBinding(currentMetadata.hermesRunCapability);
      const verification = binding
        ? verifyHermesRunCapability(binding, {
            taskId: input.taskId,
            runId: input.authority.runId,
            capability: input.authority.capability,
            principal: input.principal,
          })
        : 'invalid';

      if (verification === 'replay' && binding?.completedAt) {
        const receipt = responseReceipt(currentMetadata.hermesResponseReceipt);
        const outbox = currentMetadata.hermesResponseOutbox && typeof currentMetadata.hermesResponseOutbox === 'object'
          && !Array.isArray(currentMetadata.hermesResponseOutbox)
          ? currentMetadata.hermesResponseOutbox as Record<string, unknown>
          : null;
        const queueIntent = responseQueueIntent(outbox?.queueIntent);
        if (
          !receipt
          || receipt.receiptId !== input.identity.receiptId
          || receipt.taskId !== input.taskId
          || !outbox
          || outbox.receiptId !== receipt.receiptId
          || !queueIntent
        ) throw new Error('Committed Hermes response receipt/outbox is malformed');
        return {
          kind: 'replay',
          receipt,
          queueIntent,
          outboxDelivered: typeof outbox.deliveredAt === 'string',
        } as const;
      }
      if (verification !== 'fresh') {
        return { kind: 'conflict', state: current.state, claimedByAgentId: current.claimedByAgentId } as const;
      }
      if (
        current.state !== 'claimed'
        || current.claimedByAgentId !== input.agentId
        || current.conversationId !== input.expectedConversationId
        || current.updatedAt.getTime() !== input.expectedTaskUpdatedAt.getTime()
      ) return { kind: 'conflict', state: current.state, claimedByAgentId: current.claimedByAgentId } as const;

      const metadata = currentMetadata;
      if (
        metadata.type !== 'negotiation'
        || (metadata.sourceUserId !== input.ownerId && metadata.candidateUserId !== input.ownerId)
      ) return { kind: 'not_found' } as const;

      const messages = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: current.conversationId,
        metadata: metadata as Record<string, unknown> | null,
      });
      if (
        messages.length !== input.expectedTurnCount
        || expectedNegotiationSpeaker(metadata, messages) !== input.ownerId
      ) {
        return { kind: 'conflict', state: current.state, claimedByAgentId: current.claimedByAgentId } as const;
      }

      const hasContinuation = hasNegotiationContinuationIdentity(metadata);
      const continuationExecution = hasContinuation
        ? await readClaimedContinuationExecutionInTransaction(database, input.taskId)
        : null;
      if (hasContinuation && !continuationExecution) {
        return { kind: 'conflict', state: current.state, claimedByAgentId: current.claimedByAgentId } as const;
      }

      const now = new Date();
      const consumedMetadata = consumeHermesRunCapabilityMetadata({
        metadata,
        taskId: input.taskId,
        principal: input.principal,
        authority: input.authority,
        now,
      });
      if (!consumedMetadata) {
        return { kind: 'conflict', state: current.state, claimedByAgentId: current.claimedByAgentId } as const;
      }
      const consumedBinding = parseHermesRunCapabilityBinding(consumedMetadata.hermesRunCapability);
      if (!consumedBinding) throw new Error('Consumed Hermes capability metadata is malformed');
      await tx.update(schema.tasks).set({ state: 'working', metadata: consumedMetadata, updatedAt: now })
        .where(eq(schema.tasks.id, input.taskId));
      await fault('consume');

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${current.conversationId}`}, 0)
        )
      `);
      const [existingSession] = await tx.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.taskId, input.taskId)).limit(1);
      const sessionId = existingSession?.id ?? input.identity.sessionId;
      if (existingSession) {
        await tx.update(schema.conversationSessions).set({ lastMessageAt: now })
          .where(eq(schema.conversationSessions.id, sessionId));
      } else {
        await tx.insert(schema.conversationSessions).values({
          id: sessionId,
          conversationId: current.conversationId,
          taskId: input.taskId,
          startedAt: now,
          lastMessageAt: now,
        });
      }
      await tx.insert(schema.messages).values({
        id: input.identity.messageId,
        conversationId: current.conversationId,
        taskId: input.taskId,
        sessionId,
        senderId: `agent:${input.ownerId}`,
        role: 'agent',
        parts: [{ kind: 'data', data: input.turn }],
        createdAt: now,
      });
      await tx.update(schema.conversations).set({ lastMessageAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, current.conversationId));
      await tx.update(schema.conversationParticipants).set({ hiddenAt: null }).where(and(
        eq(schema.conversationParticipants.conversationId, current.conversationId),
        eq(schema.conversationParticipants.participantId, `agent:${input.ownerId}`),
      ));
      await fault('message');

      await tx.update(schema.tasks).set({
        state: input.finalState,
        statusMessage: null,
        statusTimestamp: now,
        updatedAt: now,
      }).where(eq(schema.tasks.id, input.taskId));
      await fault('task');

      if (input.finalState === 'completed') {
        if (!input.outcome) throw new Error('Terminal Hermes response requires an exact outcome artifact');
        await tx.insert(schema.artifacts).values({
          id: input.identity.artifactId,
          taskId: input.taskId,
          name: 'negotiation-outcome',
          parts: [{ kind: 'data', data: input.outcome }],
          metadata: {
            hasOpportunity: input.outcome.hasOpportunity,
            turnCount: input.expectedTurnCount + 1,
            ...(continuationExecution && input.continuationOutcome
              ? { continuationOutcome: input.continuationOutcome }
              : {}),
          },
          createdAt: now,
        });
      }
      await fault('artifact');

      if (input.opportunity) {
        const [updatedOpportunity] = await tx.update(opportunities).set({
          status: input.opportunity.status,
          acceptedBy: null,
          updatedAt: now,
        }).where(eq(opportunities.id, input.opportunity.id)).returning({ id: opportunities.id });
        if (!updatedOpportunity) throw new Error('Required negotiation opportunity disappeared');
      }
      await fault('opportunity');

      if (continuationExecution) {
        if (input.finalState === 'completed') {
          if (!input.continuationOutcome) throw new Error('Terminal continuation response requires an exact outcome');
          const continuationReceipt: ContinuationReceipt = {
            priorTaskId: continuationExecution.taskId,
            settlementId: continuationExecution.settlementId,
            successorTaskId: continuationExecution.successorTaskId,
            fence: continuationExecution.fence,
            outcome: input.continuationOutcome,
          };
          await completeContinuationExecutionInTransaction(database, continuationExecution, continuationReceipt);
        } else {
          await parkContinuationExecutionInTransaction(database, continuationExecution);
        }
      }
      await fault('continuation');

      const completedAt = now.toISOString();
      const receipt: HermesResponseReceipt = {
        version: 1,
        receiptId: input.identity.receiptId,
        taskId: input.taskId,
        messageId: input.identity.messageId,
        artifactId: input.finalState === 'completed' ? input.identity.artifactId : null,
        action: input.turn.action,
        finalState: input.finalState,
        turnNumber: input.expectedTurnCount + 1,
        completedAt,
      };
      const completedBinding = { ...consumedBinding, completedAt };
      await tx.update(schema.tasks).set({
        metadata: buildHermesResponseMetadataSql({
          completedBinding,
          receipt,
          parkGeneration: input.finalState === 'waiting_for_agent' ? receipt.receiptId : null,
          parkStartedAt: input.finalState === 'waiting_for_agent' ? completedAt : null,
        }),
        updatedAt: now,
      }).where(eq(schema.tasks.id, input.taskId));
      await fault('receipt');

      if (!current.claimedAt) throw new Error('Hermes response claim has no timer generation');
      const queueIntent: HermesResponseQueueIntent = {
        cancelClaimTimeout: true,
        claimGeneration: current.claimedAt.toISOString(),
        rearmParkTimeout: input.finalState === 'waiting_for_agent'
          ? {
              turnNumber: input.expectedTurnCount + 1,
              deadlineAt: new Date(now.getTime() + input.parkTimeoutMs).toISOString(),
              parkGeneration: receipt.receiptId,
              ...(continuationExecution
                ? {
                    continuation: {
                      priorTaskId: continuationExecution.taskId,
                      settlementId: continuationExecution.settlementId,
                      successorTaskId: continuationExecution.successorTaskId,
                      token: continuationExecution.token,
                      fence: continuationExecution.fence,
                    },
                  }
                : {}),
            }
          : null,
      };
      const outbox = { version: 1, receiptId: receipt.receiptId, queueIntent, createdAt: completedAt };
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object(
          'hermesResponseOutbox', ${JSON.stringify(outbox)}::jsonb
        )`,
        updatedAt: now,
      }).where(eq(schema.tasks.id, input.taskId));
      await fault('outbox');

      return { kind: 'committed', receipt, queueIntent, outboxDelivered: false } as const;
    });
  }

  /**
   * Find pending response queue outboxes for this exact selected agent/owner.
   * This recovery path deliberately needs no old raw run capability: the
   * response is already durably committed, and pickup re-authorizes the current
   * agent before invoking it. A bounded batch runs before any new work claim.
   */
  async getPendingHermesResponseOutboxes(
    agentId: string,
    ownerId: string,
    principal: NegotiationCredentialPrincipal,
  ): Promise<PendingHermesResponseOutbox[]> {
    if (
      principal.agentId !== agentId
      || !isDedicatedHermesNegotiationAudience(principal.audience)
    ) return [];
    const rows = await db.select({ id: schema.tasks.id, metadata: schema.tasks.metadata })
      .from(schema.tasks)
      .where(and(
        eq(schema.tasks.claimedByAgentId, agentId),
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        sql`(${schema.tasks.metadata}->>'sourceUserId' = ${ownerId} OR ${schema.tasks.metadata}->>'candidateUserId' = ${ownerId})`,
        sql`${schema.tasks.metadata}->'hermesResponseOutbox' IS NOT NULL`,
        sql`NOT (${schema.tasks.metadata}->'hermesResponseOutbox' ? 'deliveredAt')`,
      ))
      .orderBy(asc(schema.tasks.createdAt))
      .limit(25);
    return rows.map((task) => {
      const metadata = task.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata as Record<string, unknown>
        : null;
      const receipt = responseReceipt(metadata?.hermesResponseReceipt);
      const outbox = metadata?.hermesResponseOutbox && typeof metadata.hermesResponseOutbox === 'object'
        && !Array.isArray(metadata.hermesResponseOutbox)
        ? metadata.hermesResponseOutbox as Record<string, unknown>
        : null;
      const queueIntent = responseQueueIntent(outbox?.queueIntent);
      if (
        !receipt
        || receipt.taskId !== task.id
        || !outbox
        || outbox.receiptId !== receipt.receiptId
        || !queueIntent
      ) throw new Error('Pending Hermes response receipt/outbox is malformed');
      return {
        taskId: task.id,
        result: { kind: 'replay', receipt, queueIntent, outboxDelivered: false },
      };
    });
  }

  /** Read an immutable completed receipt so exact retries can repair its outbox. */
  async getHermesResponseReplay(
    taskId: string,
    principal: NegotiationCredentialPrincipal,
    authority: HermesRunMutationAuthority,
  ): Promise<Extract<AtomicHermesResponseResult, { kind: 'replay' }> | null> {
    const [task] = await db.select({ metadata: schema.tasks.metadata }).from(schema.tasks)
      .where(eq(schema.tasks.id, taskId)).limit(1);
    const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? task.metadata as Record<string, unknown>
      : null;
    const binding = parseHermesRunCapabilityBinding(metadata?.hermesRunCapability);
    if (
      !binding?.completedAt
      || binding.outcome !== authority.outcome
      || verifyHermesRunCapability(binding, {
        taskId,
        runId: authority.runId,
        capability: authority.capability,
        principal,
      }) !== 'replay'
    ) return null;
    const receipt = responseReceipt(metadata?.hermesResponseReceipt);
    const outbox = metadata?.hermesResponseOutbox && typeof metadata.hermesResponseOutbox === 'object'
      && !Array.isArray(metadata.hermesResponseOutbox)
      ? metadata.hermesResponseOutbox as Record<string, unknown>
      : null;
    const queueIntent = responseQueueIntent(outbox?.queueIntent);
    if (!receipt || !outbox || outbox.receiptId !== receipt.receiptId || !queueIntent) {
      throw new Error('Committed Hermes response receipt/outbox is malformed');
    }
    return {
      kind: 'replay',
      receipt,
      queueIntent,
      outboxDelivered: typeof outbox.deliveredAt === 'string',
    };
  }

  /** Mark exact post-commit queue intent delivered without reopening response mutation. */
  async markHermesResponseOutboxDelivered(taskId: string, receiptId: string): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [task] = await tx.select({ metadata: schema.tasks.metadata }).from(schema.tasks)
        .where(eq(schema.tasks.id, taskId)).limit(1).for('update');
      const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata as Record<string, unknown>
        : null;
      const receipt = responseReceipt(metadata?.hermesResponseReceipt);
      const outbox = metadata?.hermesResponseOutbox && typeof metadata.hermesResponseOutbox === 'object'
        && !Array.isArray(metadata.hermesResponseOutbox)
        ? metadata.hermesResponseOutbox as Record<string, unknown>
        : null;
      if (!receipt || receipt.receiptId !== receiptId || outbox?.receiptId !== receiptId) return false;
      if (typeof outbox.deliveredAt === 'string') return true;
      const deliveredAt = new Date().toISOString();
      const [updated] = await tx.update(schema.tasks).set({
        metadata: sql`jsonb_set(${schema.tasks.metadata}, '{hermesResponseOutbox,deliveredAt}', to_jsonb(${deliveredAt}::text), true)`,
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId)).returning({ id: schema.tasks.id });
      return Boolean(updated);
    });
  }

  async isHermesRunMutationReplay(
    taskId: string,
    principal: NegotiationCredentialPrincipal,
    authority: HermesRunMutationAuthority,
  ): Promise<boolean> {
    const [task] = await db.select({ metadata: schema.tasks.metadata }).from(schema.tasks)
      .where(eq(schema.tasks.id, taskId)).limit(1);
    const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
      ? task.metadata as Record<string, unknown>
      : null;
    const binding = parseHermesRunCapabilityBinding(metadata?.hermesRunCapability);
    return Boolean(binding?.completedAt && binding.outcome === authority.outcome && verifyHermesRunCapability(binding, {
      taskId,
      runId: authority.runId,
      capability: authority.capability,
      principal,
    }) === 'replay');
  }

  async markHermesRunResponseCompleted(
    taskId: string,
    principal: NegotiationCredentialPrincipal,
    authority: HermesRunMutationAuthority,
  ): Promise<boolean> {
    return db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, taskId)).limit(1).for('update');
      const metadata = task?.metadata && typeof task.metadata === 'object' && !Array.isArray(task.metadata)
        ? task.metadata as Record<string, unknown>
        : null;
      const binding = parseHermesRunCapabilityBinding(metadata?.hermesRunCapability);
      if (
        !task
        || !metadata
        || !binding
        || binding.outcome !== 'responded'
        || binding.completedAt
        || verifyHermesRunCapability(binding, {
          taskId,
          runId: authority.runId,
          capability: authority.capability,
          principal,
        }) !== 'replay'
      ) return false;
      const [updated] = await tx.update(schema.tasks).set({
        metadata: {
          ...metadata,
          hermesRunCapability: { ...binding, completedAt: new Date().toISOString() },
        },
      }).where(eq(schema.tasks.id, taskId)).returning({ id: schema.tasks.id });
      return Boolean(updated);
    });
  }

  /**
   * CAS an ordinary parked turn into system fallback ownership. The exact
   * persisted generation token and in-transaction turn count make pickup,
   * re-parking, and timeout mutually exclusive.
   */
  async transitionWaitingNegotiationToWorking(input: {
    taskId: string;
    parkGeneration: string;
    turnNumber: number;
  }): Promise<Task | null> {
    return db.transaction(async (tx) => {
      const [current] = await tx.select().from(schema.tasks).where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'waiting_for_agent'),
        sql`${schema.tasks.metadata}->>'negotiationParkGeneration' = ${input.parkGeneration}`,
        sql`COALESCE(${schema.tasks.metadata}->'continuationExecution'->>'status', '') <> 'parked'`,
      )).limit(1).for('update');
      if (!current) return null;
      // Match-scoped, matching how this turnNumber was armed.
      const turns = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: current.conversationId,
        metadata: metadataRecord(current.metadata),
      });
      if (turns.length !== input.turnNumber) return null;
      const now = new Date();
      const [task] = await tx.update(schema.tasks).set({
        state: 'working',
        claimedByAgentId: 'system:negotiation-timeout',
        claimedAt: now,
        updatedAt: now,
      }).where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'waiting_for_agent'),
        sql`${schema.tasks.metadata}->>'negotiationParkGeneration' = ${input.parkGeneration}`,
      )).returning();
      return task ?? null;
    });
  }

  /** Read the expiry coordinates that the pause transaction must revalidate. */
  async getClaimedNegotiationConsultationMaterial(input: {
    taskId: string;
    claimedByAgentId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    counterpartyUserId: string;
    counterpartyIntentId: string;
  }): Promise<{
    intentFingerprint: string;
    opportunityStatus: string;
    opportunityUpdatedAt: string;
    counterpartyUserId: string;
    counterpartyIntentId: string;
  } | null> {
    const [row] = await db.select({
      taskState: schema.tasks.state,
      claimedByAgentId: schema.tasks.claimedByAgentId,
      taskMetadata: schema.tasks.metadata,
      intentPayload: schema.intents.payload,
      intentSummary: schema.intents.summary,
      intentStatus: schema.intents.status,
      intentArchivedAt: schema.intents.archivedAt,
      opportunityStatus: opportunities.status,
      opportunityUpdatedAt: opportunities.updatedAt,
      actors: opportunities.actors,
    }).from(schema.tasks)
      .innerJoin(schema.intents, eq(schema.intents.id, input.recipientIntentId))
      .innerJoin(schema.intentNetworks, and(
        eq(schema.intentNetworks.intentId, schema.intents.id),
        eq(schema.intentNetworks.networkId, input.networkId),
      ))
      .innerJoin(opportunities, eq(opportunities.id, input.opportunityId))
      .where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'claimed'),
        eq(schema.tasks.claimedByAgentId, input.claimedByAgentId),
        eq(schema.intents.userId, input.recipientUserId),
        isNull(schema.intents.archivedAt),
        or(isNull(schema.intents.status), eq(schema.intents.status, 'ACTIVE')),
      ))
      .limit(1);
    const metadata = row?.taskMetadata as Record<string, unknown> | null;
    if (
      !row
      || metadata?.type !== 'negotiation'
      || metadata.opportunityId !== input.opportunityId
      || metadata.networkId !== input.networkId
      || row.opportunityStatus !== 'negotiating'
    ) return null;
    const boundCoordinates = externalConsultationCoordinatesFor(metadata, input.recipientUserId);
    if (
      !boundCoordinates
      || boundCoordinates.recipientIntentId !== input.recipientIntentId
      || boundCoordinates.counterpartyUserId !== input.counterpartyUserId
      || boundCoordinates.counterpartyIntentId !== input.counterpartyIntentId
      || !consultationActorSetMatchesBinding({
        actors: row.actors,
        recipientUserId: input.recipientUserId,
        recipientIntentId: input.recipientIntentId,
        networkId: input.networkId,
        counterpartyUserId: boundCoordinates.counterpartyUserId,
        counterpartyIntentId: boundCoordinates.counterpartyIntentId,
      })
    ) return null;
    const members = await db.select({ userId: schema.networkMembers.userId })
      .from(schema.networkMembers)
      .innerJoin(schema.networks, and(
        eq(schema.networks.id, schema.networkMembers.networkId),
        eq(schema.networks.isPersonal, false),
        isNull(schema.networks.deletedAt),
      ))
      .where(and(
        eq(schema.networkMembers.networkId, input.networkId),
        inArray(schema.networkMembers.userId, [input.recipientUserId, boundCoordinates.counterpartyUserId]),
        isNull(schema.networkMembers.deletedAt),
      ));
    if (new Set(members.map((member) => member.userId)).size !== 2) return null;
    return {
      intentFingerprint: computeIntentFingerprint(row.intentPayload, row.intentSummary),
      opportunityStatus: row.opportunityStatus,
      opportunityUpdatedAt: row.opportunityUpdatedAt.toISOString(),
      counterpartyUserId: boundCoordinates.counterpartyUserId,
      counterpartyIntentId: boundCoordinates.counterpartyIntentId,
    };
  }

  /**
   * Atomically pause one exact external claim for owner consultation. The task
   * row lock serializes consult/respond/timeout contenders; every lifecycle,
   * claimant, continuation, message-cardinality, and material-binding check is
   * repeated inside the winning transaction before the sole ask_user turn is
   * inserted and the task enters input_required.
   */
  async pauseClaimedNegotiationForConsultation(input: {
    taskId: string;
    claimedByAgentId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    settlementId: string;
    consultationAttemptId: string;
    expectedTurnCount: number;
    expectedMaterial: {
      intentFingerprint: string;
      opportunityStatus: string;
      opportunityUpdatedAt: string;
      counterpartyUserId: string;
      counterpartyIntentId: string;
    };
    safeAskUser: { disclosureSubject: string; draftQuestion?: string };
    consultationPolicyReason?: string;
    principal?: NegotiationCredentialPrincipal;
    runAuthority?: HermesRunMutationAuthority;
    continuationExecution?: ContinuationExecutionFence;
  }): Promise<{
    task: Task;
    binding: {
      version: 2;
      settlementId: string;
      consultationAttemptId: string;
      recipientUserId: string;
      recipientIntentId: string;
      opportunityId: string;
      networkId: string;
      intentFingerprint: string;
      opportunityStatus: string;
      opportunityUpdatedAt: string;
      counterpartyUserId: string;
      counterpartyIntentId: string;
    };
  } | null> {
    return db.transaction(async (tx) => {
      if (input.principal && !await authorizeNegotiationMutationInTransaction(
        tx as unknown as typeof db,
        input.recipientUserId,
        input.principal,
      )) return null;
      if (input.continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, input.continuationExecution);
      }
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId))
        .limit(1)
        .for('update');
      if (
        !task
        || task.state !== 'claimed'
        || task.claimedByAgentId !== input.claimedByAgentId
      ) return null;
      const metadata = task.metadata as Record<string, unknown> | null;
      if (
        metadata?.type !== 'negotiation'
        || metadata.opportunityId !== input.opportunityId
        || metadata.networkId !== input.networkId
      ) return null;
      const now = new Date();
      let mutationMetadata: Record<string, unknown> = metadata;
      if (input.principal && isDedicatedHermesNegotiationAudience(input.principal.audience)) {
        if (!input.runAuthority || input.runAuthority.outcome !== 'consulted') return null;
        const consumed = consumeHermesRunCapabilityMetadata({
          metadata,
          taskId: input.taskId,
          principal: input.principal,
          authority: input.runAuthority,
          now,
        });
        if (!consumed) return null;
        mutationMetadata = consumed;
      }
      const boundCoordinates = externalConsultationCoordinatesFor(metadata, input.recipientUserId);
      if (
        !boundCoordinates
        || boundCoordinates.recipientIntentId !== input.recipientIntentId
        || boundCoordinates.counterpartyUserId !== input.expectedMaterial.counterpartyUserId
        || boundCoordinates.counterpartyIntentId !== input.expectedMaterial.counterpartyIntentId
      ) return null;

      // Match-scoped: the caller derives `expectedTurnCount` from this
      // negotiation's messages.
      const turnRows = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: task.conversationId,
        metadata,
      });
      if (turnRows.length !== input.expectedTurnCount || input.expectedTurnCount < 1) return null;
      const [intent] = await tx.select({
        userId: schema.intents.userId,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        status: schema.intents.status,
        archivedAt: schema.intents.archivedAt,
      }).from(schema.intents)
        .innerJoin(schema.intentNetworks, and(
          eq(schema.intentNetworks.intentId, schema.intents.id),
          eq(schema.intentNetworks.networkId, input.networkId),
        ))
        .where(eq(schema.intents.id, input.recipientIntentId))
        .limit(1)
        .for('update');
      const [opportunity] = await tx.select({
        status: opportunities.status,
        updatedAt: opportunities.updatedAt,
        actors: opportunities.actors,
      }).from(opportunities)
        .where(eq(opportunities.id, input.opportunityId))
        .limit(1)
        .for('update');
      if (
        !intent
        || intent.userId !== input.recipientUserId
        || intent.archivedAt !== null
        || (intent.status !== null && intent.status !== 'ACTIVE')
        || !opportunity
        || opportunity.status !== 'negotiating'
      ) return null;

      if (!consultationActorSetMatchesBinding({
        actors: opportunity.actors,
        recipientUserId: input.recipientUserId,
        recipientIntentId: input.recipientIntentId,
        networkId: input.networkId,
        counterpartyUserId: boundCoordinates.counterpartyUserId,
        counterpartyIntentId: boundCoordinates.counterpartyIntentId,
      })) return null;
      const { counterpartyUserId, counterpartyIntentId } = boundCoordinates;
      const members = await tx.select({ userId: schema.networkMembers.userId })
        .from(schema.networkMembers)
        .innerJoin(schema.networks, and(
          eq(schema.networks.id, schema.networkMembers.networkId),
          eq(schema.networks.isPersonal, false),
          isNull(schema.networks.deletedAt),
        ))
        .where(and(
          eq(schema.networkMembers.networkId, input.networkId),
          inArray(schema.networkMembers.userId, [input.recipientUserId, counterpartyUserId]),
          isNull(schema.networkMembers.deletedAt),
        ));
      if (new Set(members.map((member) => member.userId)).size !== 2) return null;

      // The turn being paused after must belong to THIS negotiation: the last
      // message in the shared DM may be the tail of an entirely different match,
      // which would validate the counterparty check against the wrong exchange.
      const precedingTurns = await selectNegotiationTurnHistoryInTransaction(tx, {
        conversationId: task.conversationId,
        metadata,
      });
      const precedingMessage = precedingTurns[precedingTurns.length - 1];
      const precedingData = Array.isArray(precedingMessage?.parts)
        ? (precedingMessage.parts as Array<{ kind?: unknown; data?: unknown }>).find((part) => part.kind === 'data')?.data
        : null;
      const precedingTurn = precedingData && typeof precedingData === 'object' && !Array.isArray(precedingData)
        ? precedingData as Record<string, unknown>
        : null;
      const precedingAssessment = precedingTurn?.assessment && typeof precedingTurn.assessment === 'object' && !Array.isArray(precedingTurn.assessment)
        ? precedingTurn.assessment as Record<string, unknown>
        : null;
      const precedingRoles = precedingAssessment?.suggestedRoles && typeof precedingAssessment.suggestedRoles === 'object' && !Array.isArray(precedingAssessment.suggestedRoles)
        ? precedingAssessment.suggestedRoles as Record<string, unknown>
        : null;
      const validRole = (value: unknown): value is 'agent' | 'patient' | 'peer' =>
        value === 'agent' || value === 'patient' || value === 'peer';
      if (
        precedingMessage?.senderId !== `agent:${counterpartyUserId}`
        || (precedingTurn?.action !== 'counter' && precedingTurn?.action !== 'question')
        || !validRole(precedingRoles?.ownUser)
        || !validRole(precedingRoles?.otherUser)
      ) return null;

      const material = {
        intentFingerprint: computeIntentFingerprint(intent.payload, intent.summary),
        opportunityStatus: opportunity.status,
        opportunityUpdatedAt: opportunity.updatedAt.toISOString(),
        counterpartyUserId,
        counterpartyIntentId,
      };
      if (
        material.intentFingerprint !== input.expectedMaterial.intentFingerprint
        || material.opportunityStatus !== input.expectedMaterial.opportunityStatus
        || material.opportunityUpdatedAt !== input.expectedMaterial.opportunityUpdatedAt
        || material.counterpartyUserId !== input.expectedMaterial.counterpartyUserId
        || material.counterpartyIntentId !== input.expectedMaterial.counterpartyIntentId
      ) return null;
      const binding = {
        version: 2 as const,
        settlementId: input.settlementId,
        consultationAttemptId: input.consultationAttemptId,
        recipientUserId: input.recipientUserId,
        recipientIntentId: input.recipientIntentId,
        opportunityId: input.opportunityId,
        networkId: input.networkId,
        ...material,
      };
      const turnContext = mutationMetadata.turnContext && typeof mutationMetadata.turnContext === 'object' && !Array.isArray(mutationMetadata.turnContext)
        ? mutationMetadata.turnContext as Record<string, unknown>
        : {};
      const [pausedTask] = await tx.update(schema.tasks).set({
        state: 'input_required',
        metadata: { ...mutationMetadata, turnContext: {
          ...turnContext,
          askUserBinding: binding,
          ...(input.consultationPolicyReason ? { consultationPolicyReason: input.consultationPolicyReason } : {}),
        } },
        statusTimestamp: now,
        updatedAt: now,
      }).where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.state, 'claimed'),
        eq(schema.tasks.claimedByAgentId, input.claimedByAgentId),
      )).returning();
      if (!pausedTask) return null;

      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${task.conversationId}`}, 0)
        )
      `);
      const [existingSession] = await tx.select({ id: schema.conversationSessions.id })
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.taskId, task.id))
        .limit(1);
      const sessionId = existingSession?.id ?? crypto.randomUUID();
      if (existingSession) {
        await tx.update(schema.conversationSessions).set({ lastMessageAt: now })
          .where(eq(schema.conversationSessions.id, sessionId));
      } else {
        await tx.insert(schema.conversationSessions).values({
          id: sessionId,
          conversationId: task.conversationId,
          taskId: task.id,
          startedAt: now,
          lastMessageAt: now,
        });
      }
      await tx.insert(schema.messages).values({
        conversationId: task.conversationId,
        taskId: task.id,
        sessionId,
        senderId: `agent:${input.recipientUserId}`,
        role: 'agent',
        parts: [{ kind: 'data', data: {
          action: 'ask_user',
          message: null,
          assessment: {
            reasoning: 'Owner consultation requested by the external negotiation executor.',
            suggestedRoles: {
              ownUser: precedingRoles.otherUser,
              otherUser: precedingRoles.ownUser,
            },
          },
          askUser: input.safeAskUser,
        } }],
        createdAt: now,
      });
      await tx.update(schema.conversations)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(schema.conversations.id, task.conversationId));
      await tx.update(schema.conversationParticipants)
        .set({ hiddenAt: null })
        .where(and(
          eq(schema.conversationParticipants.conversationId, task.conversationId),
          eq(schema.conversationParticipants.participantId, `agent:${input.recipientUserId}`),
        ));
      return { task: pausedTask, binding };
    });
  }

  /**
   * Capture the exact ask-user material binding and persist it with the turn
   * context before the timeout is armed. The returned marker is the only
   * settlement coordinate accepted by timeout/answer continuation paths.
   */
  async captureNegotiationAskUserBinding(input: {
    taskId: string;
    turnContext: Record<string, unknown>;
    settlementId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    continuationExecution?: ContinuationExecutionFence;
  }): Promise<{
    version: 2;
    settlementId: string;
    recipientUserId: string;
    recipientIntentId: string;
    opportunityId: string;
    networkId: string;
    intentFingerprint: string;
    opportunityStatus: string;
    opportunityUpdatedAt: string;
    counterpartyUserId: string;
    counterpartyIntentId: string;
  }> {
    return db.transaction(async (tx) => {
      if (input.continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, input.continuationExecution);
      }
      const [task] = await tx.select({ metadata: schema.tasks.metadata }).from(schema.tasks)
        .where(and(eq(schema.tasks.id, input.taskId), eq(schema.tasks.state, 'working')))
        .limit(1).for('update');
      const [intent] = await tx.select({
        userId: schema.intents.userId,
        payload: schema.intents.payload,
        summary: schema.intents.summary,
        status: schema.intents.status,
        archivedAt: schema.intents.archivedAt,
      }).from(schema.intents)
        .innerJoin(schema.intentNetworks, and(
          eq(schema.intentNetworks.intentId, schema.intents.id),
          eq(schema.intentNetworks.networkId, input.networkId),
        ))
        .where(eq(schema.intents.id, input.recipientIntentId))
        .limit(1).for('update');
      const [opportunity] = await tx.select({
        status: opportunities.status,
        updatedAt: opportunities.updatedAt,
        actors: opportunities.actors,
      }).from(opportunities).where(eq(opportunities.id, input.opportunityId)).limit(1).for('update');
      if (
        !task
        || !intent
        || intent.userId !== input.recipientUserId
        || intent.archivedAt !== null
        || (intent.status !== null && intent.status !== 'ACTIVE')
        || !opportunity
      ) throw new Error('Ask-user material binding is no longer valid');

      const actors = opportunity.actors as Array<{ userId?: string; intent?: string; networkId?: string; role?: string }>;
      const recipient = actors.filter((actor) => actor.role !== 'introducer'
        && actor.userId === input.recipientUserId
        && actor.intent === input.recipientIntentId
        && actor.networkId === input.networkId);
      const counterparties = actors.filter((actor) => actor.role !== 'introducer'
        && actor.userId !== input.recipientUserId
        && actor.networkId === input.networkId
        && typeof actor.userId === 'string'
        && typeof actor.intent === 'string');
      if (recipient.length !== 1 || counterparties.length !== 1) {
        throw new Error('Ask-user opportunity actor binding is ambiguous');
      }
      const counterpartyUserId = counterparties[0].userId!;
      const counterpartyIntentId = counterparties[0].intent!;
      const members = await tx.select({ userId: schema.networkMembers.userId }).from(schema.networkMembers)
        .innerJoin(schema.networks, and(
          eq(schema.networks.id, schema.networkMembers.networkId),
          eq(schema.networks.isPersonal, false),
          isNull(schema.networks.deletedAt),
        ))
        .where(and(
          eq(schema.networkMembers.networkId, input.networkId),
          inArray(schema.networkMembers.userId, [input.recipientUserId, counterpartyUserId]),
          isNull(schema.networkMembers.deletedAt),
        ));
      if (new Set(members.map((member) => member.userId)).size !== 2) {
        throw new Error('Ask-user network membership binding is stale');
      }

      const binding = {
        version: 2 as const,
        settlementId: input.settlementId,
        recipientUserId: input.recipientUserId,
        recipientIntentId: input.recipientIntentId,
        opportunityId: input.opportunityId,
        networkId: input.networkId,
        intentFingerprint: computeIntentFingerprint(intent.payload, intent.summary),
        opportunityStatus: opportunity.status,
        opportunityUpdatedAt: opportunity.updatedAt.toISOString(),
        counterpartyUserId,
        counterpartyIntentId,
      };
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('turnContext', ${JSON.stringify({ ...input.turnContext, askUserBinding: binding })}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, input.taskId));
      return binding;
    });
  }

  /**
   * Merges a `turnContext` object into the task's metadata JSONB under the
   * `turnContext` key, preserving other metadata keys. Used when a negotiation
   * turn is parked for polling so the claiming agent sees the same context the
   * system agent would have run with.
   *
   * @param taskId - Task to update
   * @param turnContext - Absolute source/candidate view of negotiation context
   */
  async setTaskTurnContext(
    taskId: string,
    turnContext: Record<string, unknown>,
    continuationExecution?: ContinuationExecutionFence,
  ): Promise<void> {
    await db.transaction(async (tx) => {
      if (continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      }
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('turnContext', ${JSON.stringify(turnContext)}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId));
    });
  }

  /**
   * Merges a screen-gate decision (P2.1 shadow mode) into the task's metadata
   * JSONB under the `screenDecision` key, preserving other metadata keys.
   * Sibling of {@link setTaskTurnContext}.
   *
   * @param taskId - Task to update
   * @param screenDecision - ScreenDecisionRecord (decision, evidence, mode, timing)
   */
  async setTaskScreenDecision(taskId: string, screenDecision: Record<string, unknown>, continuationExecution?: ContinuationExecutionFence): Promise<void> {
    await db.transaction(async (tx) => {
      if (continuationExecution) await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('screenDecision', ${JSON.stringify(screenDecision)}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId));
    });
  }

  /**
   * Merges an applied deadlock→bargaining shift record (IND-428) into the
   * task's metadata JSONB under the `deadlockShift` key, preserving other
   * metadata keys. Sibling of {@link setTaskScreenDecision}. Internal
   * analytics only — no API surface projects this key.
   *
   * @param taskId - Task to update
   * @param deadlockShift - DeadlockShiftRecord (run length, threshold, turn, seat, timing)
   */
  async setTaskDeadlockShift(taskId: string, deadlockShift: Record<string, unknown>, continuationExecution?: ContinuationExecutionFence): Promise<void> {
    await db.transaction(async (tx) => {
      if (continuationExecution) await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('deadlockShift', ${JSON.stringify(deadlockShift)}::jsonb)`,
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId));
    });
  }

  /**
   * Retrieves a task by ID.
   * @param taskId - Task ID
   * @returns The task, or null if not found
   */
  async getTask(taskId: string): Promise<(Omit<Task, 'metadata'> & { metadata: Record<string, unknown> | null }) | null> {
    const [task] = await db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);

    if (!task) return null;
    return { ...task, metadata: (task.metadata as Record<string, unknown> | null) ?? null };
  }

  /**
   * Lists all tasks for a conversation.
   * @param conversationId - Conversation ID
   * @returns Ordered list of tasks
   */
  async getTasksByConversation(conversationId: string): Promise<Task[]> {
    return db
      .select()
      .from(schema.tasks)
      .where(eq(schema.tasks.conversationId, conversationId))
      .orderBy(schema.tasks.createdAt);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Artifacts
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Creates an artifact linked to a task.
   * @param data - Artifact payload
   * @returns The newly created artifact
   */
  async createArtifact(data: {
    taskId: string;
    name?: string;
    description?: string;
    parts: unknown[];
    metadata?: Record<string, unknown> | null;
    continuationExecution?: ContinuationExecutionFence;
  }): Promise<Artifact> {
    return db.transaction(async (tx) => {
      if (data.continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, data.continuationExecution);
      }
      const [artifact] = await tx.insert(schema.artifacts).values({
        taskId: data.taskId,
        name: data.name ?? null,
        description: data.description ?? null,
        parts: data.parts,
        metadata: data.metadata ?? null,
      }).returning();
      return artifact;
    });
  }

  /**
   * Lists all artifacts for a task.
   * @param taskId - Task ID
   * @returns Ordered list of artifacts
   */
  async getArtifacts(taskId: string): Promise<Artifact[]> {
    return db
      .select()
      .from(schema.artifacts)
      .where(eq(schema.artifacts.taskId, taskId))
      .orderBy(schema.artifacts.createdAt);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // NegotiationGraphDatabase query methods (used by negotiation MCP tools)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Lists negotiation tasks where the given user is source or candidate.
   * Matches sourceUserId or candidateUserId in task metadata JSON.
   * @param userId - The user ID to filter by
   * @param options - Optional state filter
   * @returns Array of task records with metadata
   */
  async getTasksForUser(userId: string, options?: { state?: string }): Promise<Array<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const conditions = [
      sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
      notArchivedNegotiationTaskWhere(),
      or(
        sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
        sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
      ),
    ];

    if (options?.state) {
      conditions.push(eq(schema.tasks.state, options.state as typeof schema.taskStateEnum.enumValues[number]));
    }

    const rows = await db
      .select()
      .from(schema.tasks)
      .where(and(...conditions))
      .orderBy(desc(schema.tasks.createdAt));

    return rows.map((r) => ({
      id: r.id,
      conversationId: r.conversationId,
      state: r.state as string,
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
      createdAt: r.createdAt,
      updatedAt: r.updatedAt,
    }));
  }

  /**
   * Builds the private Radar transcript projection for one owned intent.
   * Messages are joined through the exact opportunity negotiation task so
   * shared agent-pair conversations cannot leak turns across intents.
   */
  async getNegotiationActivityForIntent(userId: string, intentId: string): Promise<Array<{
    correspondentUserId: string;
    correspondentLabel: string;
    correspondentAvatar: string | null;
    messages: Array<{
      id: string;
      opportunityId: string;
      sender: 'yours' | 'theirs';
      parts: unknown[];
      createdAt: Date;
    }>;
  }> | null> {
    const [ownedIntent] = await db
      .select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    if (!ownedIntent) return null;

    const opportunityRows = await db
      .select({
        id: schema.opportunities.id,
        status: schema.opportunities.status,
        actors: schema.opportunities.actors,
      })
      .from(schema.opportunities)
      .where(and(
        eq(schema.opportunities.status, 'negotiating'),
        sql`${schema.opportunities.actors} @> ${JSON.stringify([{ userId, intent: intentId }])}::jsonb`,
      ));
    if (opportunityRows.length === 0) return [];

    const opportunityIds = opportunityRows.map((row) => row.id);
    const taskRows = await db
      .select({
        id: schema.tasks.id,
        opportunityId: sql<string>`${schema.tasks.metadata}->>'opportunityId'`,
      })
      .from(schema.tasks)
      .where(and(
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        notArchivedNegotiationTaskWhere(),
        inArray(sql`${schema.tasks.metadata}->>'opportunityId'`, opportunityIds),
      ));
    if (taskRows.length === 0) return [];

    const opportunityByTask = new Map(taskRows.map((task) => [task.id, task.opportunityId]));
    const messageRows = await db
      .select({
        id: schema.messages.id,
        taskId: schema.messages.taskId,
        senderId: schema.messages.senderId,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, taskRows.map((task) => task.id)))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

    const counterpartIds = [...new Set(opportunityRows.flatMap((row) =>
      row.actors.filter((actor) => actor.userId !== userId).map((actor) => actor.userId),
    ))];
    const counterpartRows = counterpartIds.length > 0
      ? await db
        .select({ id: schema.users.id, name: schema.users.name, avatar: schema.users.avatar })
        .from(schema.users)
        .where(inArray(schema.users.id, counterpartIds))
      : [];
    const counterpartById = new Map(counterpartRows.map((row) => [row.id, row]));
    return projectNegotiationActivity(
      userId,
      opportunityRows,
      opportunityByTask,
      messageRows.map((message) => ({ ...message, parts: (message.parts as unknown[]) ?? [] })),
      counterpartById,
    );
  }

  /**
   * Resolves the intent carried by the given user's actor for each opportunity.
   * Missing opportunities or actor intents remain null for fail-closed callers.
   *
   * @param opportunityIds - Opportunity IDs to inspect
   * @param userId - User whose actor intent should be resolved
   * @returns One intent ID (or null) per requested opportunity ID
   */
  async getIntentIdsForOpportunities(opportunityIds: string[], userId: string): Promise<Record<string, string | null>> {
    const ids = [...new Set(opportunityIds.map((id) => id.trim()).filter(Boolean))];
    const resolved = Object.fromEntries(ids.map((id) => [id, null as string | null]));
    if (ids.length === 0) return resolved;

    const rows = await db
      .select({ id: schema.opportunities.id, actors: schema.opportunities.actors })
      .from(schema.opportunities)
      .where(inArray(schema.opportunities.id, ids));

    for (const row of rows) {
      const actorIntent = row.actors.find(
        (actor) => actor.userId === userId && typeof actor.intent === 'string' && actor.intent.trim().length > 0,
      )?.intent?.trim();
      if (actorIntent) resolved[row.id] = actorIntent;
    }

    return resolved;
  }

  /**
   * Batch-loads the current opportunity lifecycle needed for truthful
   * negotiation narration. Opportunities that do not contain the authenticated
   * owner actor are omitted. The caller receives only whether they are the
   * persisted human acceptor; no actor or counterparty identity is projected.
   *
   * @param opportunityIds - Opportunity IDs referenced by negotiation tasks
   * @param ownerUserId - Authenticated owner receiving the narration
   * @returns Lifecycle evidence keyed by opportunity ID
   */
  async getOpportunityLifecyclesForNegotiations(
    opportunityIds: string[],
    ownerUserId: string,
  ): Promise<Record<string, {
    status: typeof schema.opportunityStatusEnum.enumValues[number];
    acceptedByOwner: boolean;
  }>> {
    const ids = [...new Set(opportunityIds.map((id) => id.trim()).filter(Boolean))];
    if (ids.length === 0) return {};

    const rows = await db
      .select({
        id: schema.opportunities.id,
        status: schema.opportunities.status,
        acceptedBy: schema.opportunities.acceptedBy,
        actors: schema.opportunities.actors,
      })
      .from(schema.opportunities)
      .where(inArray(schema.opportunities.id, ids));

    return Object.fromEntries(rows
      .filter((row) => row.actors.some((actor) => actor.userId === ownerUserId))
      .map((row) => [row.id, {
        status: row.status,
        acceptedByOwner: row.acceptedBy === ownerUserId,
      }]));
  }

  /**
   * Looks up the negotiation task attached to an opportunity, preferring the
   * most-recently-created row if multiple exist (shouldn't, but defensive).
   *
   * @param opportunityId - Opportunity id stored on task metadata
   * @returns The task record or null
   */
  async getNegotiationTaskForOpportunity(opportunityId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
        ),
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    const [row] = rows;
    if (!row) return null;

    return {
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Looks up every negotiation task attached to an opportunity, ordered from
   * oldest to newest so continuation provenance remains stable.
   *
   * @param opportunityId - Opportunity id stored on task metadata
   * @returns All matching task records, oldest first
   */
  async getNegotiationTasksForOpportunity(opportunityId: string): Promise<Array<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  }>> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
        ),
      )
      .orderBy(asc(schema.tasks.createdAt));

    return rows.map((row) => ({
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    }));
  }

  /**
   * Returns the most-recently-created negotiation task on a conversation,
   * regardless of opportunityId or direction. Used by the negotiation init
   * node's conversation-scoped initiator tie-break: symmetric concurrent
   * starts carry different opportunityIds, so the opportunity-scoped lookup
   * cannot see the competing task on the same agent-pair DM.
   *
   * @param conversationId - The agent-pair DM conversation id
   * @returns The task record or null
   */
  async getLatestNegotiationTaskForConversation(conversationId: string): Promise<{
    id: string;
    conversationId: string;
    state: string;
    metadata: Record<string, unknown> | null;
    createdAt: Date;
    updatedAt: Date;
  } | null> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          eq(schema.tasks.conversationId, conversationId),
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        ),
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);

    const [row] = rows;
    if (!row) return null;

    return {
      id: row.id,
      conversationId: row.conversationId,
      state: row.state as string,
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Returns user answers collected by the questioner for a given opportunity.
   * Reads `metadata.userAnswers` from the opportunities table.
   */
  async getOpportunityUserAnswers(opportunityId: string): Promise<Array<{
    questionId: string;
    selectedOptions: string[];
    freeText?: string;
    answeredAt: string;
  }>> {
    const [row] = await db
      .select({ metadata: opportunities.metadata })
      .from(opportunities)
      .where(eq(opportunities.id, opportunityId))
      .limit(1);
    if (!row?.metadata) return [];
    const meta = row.metadata as Record<string, unknown>;
    if (!Array.isArray(meta.userAnswers)) return [];
    return (meta.userAnswers as Record<string, unknown>[])
      .filter((a): a is Record<string, unknown> & { questionId: string; answeredAt: string } =>
        typeof a?.questionId === 'string' && typeof a?.answeredAt === 'string')
      .map((a) => ({
        questionId: a.questionId,
        selectedOptions: Array.isArray(a.selectedOptions) ? (a.selectedOptions as unknown[]).filter((o): o is string => typeof o === 'string') : [],
        ...(typeof a.freeText === 'string' && { freeText: a.freeText }),
        answeredAt: a.answeredAt,
      }));
  }

  /**
   * Gets all messages for a conversation, ordered by creation time (ascending).
   * Used by negotiation tools to reconstruct turn history.
   * @param conversationId - The conversation to fetch messages for
   * @returns Array of message records
   */
  async getMessagesForConversation(conversationId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
    taskId?: string | null;
  }>> {
    const rows = await db
      .select({
        id: schema.messages.id,
        senderId: schema.messages.senderId,
        role: schema.messages.role,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
        // IND-569: task attribution so the negotiation graph can label prior
        // dialogue per opportunity in continuation prompts.
        taskId: schema.messages.taskId,
      })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, conversationId))
      .orderBy(asc(schema.messages.createdAt));

    return rows.map((r) => ({
      ...r,
      parts: (r.parts as unknown[]) ?? [],
    }));
  }

  /**
   * Gets the messages belonging to ONE negotiation, ordered by creation time.
   *
   * Keyed on opportunity rather than task: an `ask_user` pause parks its task
   * and resumes into a pre-claimed successor, so a single negotiation spans
   * several tasks. Messages with no `taskId` — or whose task carries no
   * opportunityId — belong to no negotiation and are excluded; they remain
   * visible through `getMessagesForConversation` as context.
   *
   * Served by `tasks_metadata_opportunity_id_idx` (partial, on
   * `metadata->>'opportunityId'` where type = negotiation) and
   * `messages_task_id_idx`.
   *
   * @param opportunityId - The negotiation's opportunity
   * @returns Array of message records
   */
  async getNegotiationMessages(opportunityId: string): Promise<Array<{
    id: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    createdAt: Date;
    taskId?: string | null;
  }>> {
    const rows = await db
      .select({
        id: schema.messages.id,
        senderId: schema.messages.senderId,
        role: schema.messages.role,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
        taskId: schema.messages.taskId,
      })
      .from(schema.messages)
      .innerJoin(schema.tasks, eq(schema.messages.taskId, schema.tasks.id))
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
        ),
      )
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

    return rows.map((r) => ({
      ...r,
      parts: (r.parts as unknown[]) ?? [],
    }));
  }

  /**
   * Gets artifacts for a task (e.g. negotiation outcome).
   * Alias for getArtifacts with the interface name expected by NegotiationGraphDatabase.
   * @param taskId - The task to fetch artifacts for
   * @returns Array of artifact records
   */
  async getArtifactsForTask(taskId: string): Promise<Array<{
    id: string;
    name: string | null;
    parts: unknown[];
    metadata: Record<string, unknown> | null;
  }>> {
    const rows = await db
      .select({
        id: schema.artifacts.id,
        name: schema.artifacts.name,
        parts: schema.artifacts.parts,
        metadata: schema.artifacts.metadata,
      })
      .from(schema.artifacts)
      .where(eq(schema.artifacts.taskId, taskId))
      .orderBy(schema.artifacts.createdAt);

    return rows.map((r) => ({
      ...r,
      parts: (r.parts as unknown[]) ?? [],
      metadata: (r.metadata as Record<string, unknown> | null) ?? null,
    }));
  }

  /**
   * Retrieves messages for multiple tasks in a single query.
   * @param taskIds - Task IDs to fetch messages for
   * @returns Map of taskId to ordered messages
   */
  async getMessagesByTaskIds(taskIds: string[]): Promise<Map<string, Message[]>> {
    if (taskIds.length === 0) return new Map();

    const rows = await db
      .select()
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, taskIds))
      .orderBy(asc(schema.messages.createdAt));

    const map = new Map<string, Message[]>();
    for (const row of rows) {
      if (!row.taskId) continue;
      const list = map.get(row.taskId) ?? [];
      list.push(row);
      map.set(row.taskId, list);
    }
    return map;
  }

  /**
   * Retrieves negotiation tasks for a user, with their outcome artifacts.
   * @param userId - User to find negotiations for (as source or candidate)
   * @param opts - Optional pagination and mutual-only filtering
   * @returns Tasks with joined outcome artifacts, ordered by most recent first
   */
  async getNegotiationsByUser(
    userId: string,
    opts?: {
      limit?: number;
      offset?: number;
      mutualWithUserId?: string;
      result?: 'has_opportunity' | 'no_opportunity' | 'in_progress';
      since?: Date;
      unpaginated?: boolean;
      includeScreenedOut?: boolean;
    },
  ): Promise<Array<Task & { artifact: Artifact | null }>> {
    const limit = opts?.limit ?? 10;
    const offset = opts?.offset ?? 0;

    const userFilter = opts?.mutualWithUserId
      ? and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          notArchivedNegotiationTaskWhere(),
          or(
            and(
              sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
              sql`${schema.tasks.metadata}->>'candidateUserId' = ${opts.mutualWithUserId}`,
            ),
            and(
              sql`${schema.tasks.metadata}->>'sourceUserId' = ${opts.mutualWithUserId}`,
              sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
            ),
          ),
        )
      : and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          notArchivedNegotiationTaskWhere(),
          or(
            sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
            sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
          ),
        );

    const resultFilter = opts?.result === 'has_opportunity'
      ? sql`(${schema.artifacts.parts}->0->>'kind' = 'data' AND ((${schema.artifacts.parts}->0->'data'->>'hasOpportunity')::boolean = true OR (${schema.artifacts.parts}->0->'data'->>'consensus')::boolean = true))`
      : opts?.result === 'no_opportunity'
        ? sql`(${schema.artifacts.parts}->0->>'kind' = 'data' AND ((${schema.artifacts.parts}->0->'data'->>'hasOpportunity')::boolean = false OR (${schema.artifacts.parts}->0->'data'->>'consensus')::boolean = false))`
        : opts?.result === 'in_progress'
          ? and(isNull(schema.artifacts.id), inArray(schema.tasks.state, ['submitted', 'working', 'input_required']))
          : undefined;

    const sinceFilter = opts?.since
      ? sql`${schema.tasks.createdAt} >= ${opts.since.toISOString()}`
      : undefined;

    // P2.2: screened_out negotiations are the owner's private outreach-gate
    // decisions — zero turns, no counterparty involvement. They stay visible
    // to the owner (self view) but are excluded from the mutual (non-self
    // viewer) list so the counterparty never learns a gate decision was made.
    const screenedOutFilter = opts?.mutualWithUserId && !opts.includeScreenedOut
      ? or(
          isNull(schema.artifacts.id),
          sql`coalesce(${schema.artifacts.parts}->0->'data'->>'reason', '') <> 'screened_out'`,
        )
      : undefined;

    const allFilters = [userFilter, resultFilter, sinceFilter, screenedOutFilter].filter(Boolean);
    const combinedFilter = allFilters.length > 1 ? and(...allFilters) : allFilters[0];

    const query = db
      .select({
        task: schema.tasks,
        artifact: schema.artifacts,
      })
      .from(schema.tasks)
      .leftJoin(
        schema.artifacts,
        and(
          eq(schema.artifacts.taskId, schema.tasks.id),
          eq(schema.artifacts.name, 'negotiation-outcome'),
        ),
      )
      .where(combinedFilter)
      .orderBy(desc(schema.tasks.createdAt));

    // Thread pagination must see every continuation segment before grouping.
    // The ordinary row-oriented callers retain the existing SQL pagination.
    const rows = opts?.unpaginated
      ? await query
      : await query.limit(limit).offset(offset);

    return rows.map((r) => ({ ...r.task, artifact: r.artifact }));
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // Chat Session Methods (H2A conversations with system-agent participant)
  // Unified from former ChatDatabaseAdapter session/message/metadata methods.
  // ═══════════════════════════════════════════════════════════════════════════

  /**
   * Helper: read ChatConversationMeta from conversation_metadata for a conversation.
   */
  private async _getConvMeta(conversationId: string): Promise<ChatConversationMeta | null> {
    const [row] = await db
      .select({ metadata: schema.conversationMetadata.metadata })
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, conversationId))
      .limit(1);
    return (row?.metadata as ChatConversationMeta) ?? null;
  }

  /**
   * Helper: upsert ChatConversationMeta into conversation_metadata.
   */
  private async _upsertConvMeta(conversationId: string, patch: Partial<ChatConversationMeta>): Promise<void> {
    const existing = await this._getConvMeta(conversationId);
    const merged: ChatConversationMeta = { ...(existing ?? {}), ...patch };
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId, metadata: merged })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata: merged, updatedAt: new Date() },
      });
  }

  /**
   * Helper: convert a conversations row + metadata into a backward-compatible ChatSession.
   */
  private _toChatSession(
    conv: { id: string; createdAt: Date; updatedAt: Date; persona: string },
    userId: string,
    meta: ChatConversationMeta | null,
  ): ChatSession {
    const legacyNetworkId = meta?.networkId ?? null;
    const scopeType = this._normalizeScopeType(meta?.scopeType) ?? (legacyNetworkId ? 'network' : null);
    const scopeId = typeof meta?.scopeId === 'string' && meta.scopeId.trim()
      ? meta.scopeId.trim()
      : legacyNetworkId;
    return {
      id: conv.id,
      userId,
      title: meta?.title ?? null,
      persona: conv.persona,
      networkId: legacyNetworkId,
      scopeType,
      scopeId: scopeType ? scopeId : null,
      shareToken: meta?.shareToken ?? null,
      createdAt: conv.createdAt,
      updatedAt: conv.updatedAt,
    };
  }

  private _normalizeScopeType(value: unknown): ChatScopeType | null {
    return value === 'network' || value === 'intent' ? value : null;
  }

  /**
   * Create a new chat session (H2A conversation with system-agent participant).
   * Creates a conversation, adds user + system-agent as participants,
   * and stores title/indexId in conversation_metadata.
   */
  async createChatSession(data: CreateSessionInput): Promise<void> {
    const now = new Date();
    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({
        id: data.id,
        persona: data.persona,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.conversationParticipants).values([
        { conversationId: data.id, participantId: data.userId, participantType: 'user' as const },
        { conversationId: data.id, participantId: SYSTEM_AGENT_ID, participantType: 'agent' as const },
      ]);

      // Store title and canonical scope in conversation_metadata.
      const normalizedScopeType = this._normalizeScopeType(data.scopeType);
      const normalizedScopeId = data.scopeId?.trim() || undefined;
      const networkId = normalizedScopeType === 'network'
        ? normalizedScopeId
        : data.networkId?.trim() || undefined;
      const meta: ChatConversationMeta = {};
      if (data.title) meta.title = data.title;
      if (networkId) meta.networkId = networkId;
      if (normalizedScopeType && normalizedScopeId) {
        meta.scopeType = normalizedScopeType;
        meta.scopeId = normalizedScopeId;
      } else if (networkId) {
        meta.scopeType = 'network';
        meta.scopeId = networkId;
      }
      if (Object.keys(meta).length > 0) {
        await tx.insert(schema.conversationMetadata).values({
          conversationId: data.id,
          metadata: meta,
        });
      }

      if (normalizedScopeType === 'intent' && normalizedScopeId) {
        await tx.insert(schema.chatSessionScopes).values({
          conversationId: data.id,
          userId: data.userId,
          scopeType: intentRegistryScopeType(data.persona),
          scopeId: normalizedScopeId,
          createdAt: now,
          updatedAt: now,
        });
      }
    });
  }

  /**
   * Get chat session by ID.
   * Queries conversations + conversation_metadata and returns backward-compatible ChatSession.
   */
  async getChatSession(sessionId: string): Promise<ChatSession | null> {
    const [conv] = await db.select()
      .from(schema.conversations)
      .where(eq(schema.conversations.id, sessionId))
      .limit(1);

    if (!conv) return null;

    // Find the user participant (not the agent)
    const [userParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantType, 'user'),
        ),
      )
      .limit(1);

    const userId = userParticipant?.participantId ?? '';
    const meta = await this._getConvMeta(sessionId);
    return this._toChatSession(conv, userId, meta);
  }

  /**
   * Get persona-filtered chat sessions for a user, ordered by most recent.
   * Queries conversation_participants to find conversations with system-agent.
   *
   * @param userId - The user whose sessions to list
   * @param limit - Maximum number of sessions to return
   * @param persona - Allowed persona or personas (required)
   * @returns Matching chat sessions ordered by recency
   */
  async getUserChatSessions(
    userId: string,
    limit: number,
    persona: string | readonly string[],
  ): Promise<ChatSession[]> {
    const personas = typeof persona === 'string' ? [persona] : [...persona];
    if (personas.length === 0) return [];

    // Subquery: conversation IDs that include the system agent (i.e. chat sessions, not DMs)
    const chatSessionIds = db
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      );

    const rows = await db
      .select({
        id: schema.conversations.id,
        persona: schema.conversations.persona,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
          isNull(schema.conversationParticipants.hiddenAt),
          inArray(schema.conversations.id, chatSessionIds),
          inArray(schema.conversations.persona, personas),
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    if (rows.length === 0) return [];

    // Batch-fetch metadata for chat conversations
    const chatConvIdList = rows.map((r) => r.id);
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(inArray(schema.conversationMetadata.conversationId, chatConvIdList));
    const metaMap = new Map<string, ChatConversationMeta>(metaRows.map((m) => [m.conversationId, m.metadata as ChatConversationMeta]));

    return rows.map((conv) => this._toChatSession(conv, userId, metaMap.get(conv.id) ?? null));
  }

  /**
   * List chat session summaries for a user, ordered by most recent activity.
   * Mirrors `getUserChatSessions` but returns the `ChatSessionSummary` shape
   * expected by `ChatSessionReader`.
   *
   * @param userId - The user whose sessions to list
   * @param limit - Maximum number of sessions to return (default 25)
   * @param persona - Exact persona to expose to the generic reader
   * @returns Array of chat session summaries
   */
  async listChatSessionSummaries(
    userId: string,
    limit = 25,
    persona: string,
  ): Promise<Array<{ sessionId: string; title: string | null; messageCount: number; lastMessageAt: Date | null; createdAt: Date }>> {
    // Subquery: conversation IDs that include the system agent
    const chatSessionIds = db
      .select({ conversationId: schema.conversationParticipants.conversationId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      );

    const rows = await db
      .select({
        id: schema.conversations.id,
        lastMessageAt: schema.conversations.lastMessageAt,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversationParticipants)
      .innerJoin(
        schema.conversations,
        eq(schema.conversationParticipants.conversationId, schema.conversations.id),
      )
      .where(
        and(
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
          or(
            isNull(schema.conversationParticipants.hiddenAt),
            gt(schema.conversations.lastMessageAt, schema.conversationParticipants.hiddenAt),
          ),
          inArray(schema.conversations.id, chatSessionIds),
          // Generic history consumers are orchestrator-only. Signal and
          // negotiator each have dedicated product surfaces.
          eq(schema.conversations.persona, persona),
        ),
      )
      .orderBy(desc(schema.conversations.updatedAt))
      .limit(limit);

    if (rows.length === 0) return [];

    const convIds = rows.map((r) => r.id);

    // Batch-fetch metadata (titles)
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(inArray(schema.conversationMetadata.conversationId, convIds));
    const metaMap = new Map<string, ChatConversationMeta>(
      metaRows.map((m) => [m.conversationId, m.metadata as ChatConversationMeta]),
    );

    // Batch-fetch message counts
    const countRows = await db
      .select({
        conversationId: schema.messages.conversationId,
        cnt: count(schema.messages.id),
      })
      .from(schema.messages)
      .where(inArray(schema.messages.conversationId, convIds))
      .groupBy(schema.messages.conversationId);
    const countMap = new Map<string, number>(countRows.map((r) => [r.conversationId, Number(r.cnt)]));

    return rows.map((conv) => ({
      sessionId: conv.id,
      title: (metaMap.get(conv.id)?.title) ?? null,
      messageCount: countMap.get(conv.id) ?? 0,
      lastMessageAt: conv.lastMessageAt ?? conv.updatedAt,
      createdAt: conv.createdAt,
    }));
  }

  /**
   * Get full detail for a single chat session, including messages.
   * Returns null if the user does not participate or it is not a chat session.
   *
   * @param userId - The requesting user
   * @param sessionId - The conversation ID
   * @param messageLimit - Maximum messages to return (default 50)
   * @returns Session detail or null
   */
  async getChatSessionDetail(
    userId: string,
    sessionId: string,
    messageLimit = 50,
    persona: string,
  ): Promise<{
    sessionId: string;
    title: string | null;
    messageCount: number;
    lastMessageAt: Date | null;
    createdAt: Date;
    messages: Array<{ role: string; content: string; createdAt: Date }>;
  } | null> {
    // Verify user participation
    const [userParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantId, userId),
          eq(schema.conversationParticipants.participantType, 'user'),
        ),
      )
      .limit(1);

    if (!userParticipant) return null;

    // Verify system agent participation (i.e. it's a chat session, not a DM)
    const [agentParticipant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, sessionId),
          eq(schema.conversationParticipants.participantId, SYSTEM_AGENT_ID),
          eq(schema.conversationParticipants.participantType, 'agent'),
        ),
      )
      .limit(1);

    if (!agentParticipant) return null;

    // Fetch conversation row
    const [conv] = await db
      .select({
        id: schema.conversations.id,
        lastMessageAt: schema.conversations.lastMessageAt,
        createdAt: schema.conversations.createdAt,
        updatedAt: schema.conversations.updatedAt,
      })
      .from(schema.conversations)
      .where(and(
        eq(schema.conversations.id, sessionId),
        eq(schema.conversations.persona, persona),
      ))
      .limit(1);

    if (!conv) return null;

    // Fetch metadata
    const meta = await this._getConvMeta(sessionId);

    // Fetch messages (limited)
    const msgRows = await db
      .select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(desc(schema.messages.createdAt))
      .limit(messageLimit);

    const messages = msgRows.reverse().map((msg) => {
      const parts = msg.parts as Array<{ type?: string; text?: string }>;
      const content =
        parts?.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
        ?? parts?.find((p) => typeof p?.text === 'string')?.text
        ?? '';
      const role = msg.role === 'agent' ? 'assistant' : msg.role;
      return { role, content, createdAt: msg.createdAt };
    });

    // Count all messages (not limited)
    const [{ totalCount }] = await db
      .select({ totalCount: count(schema.messages.id) })
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId));

    return {
      sessionId: conv.id,
      title: meta?.title ?? null,
      messageCount: Number(totalCount),
      lastMessageAt: conv.lastMessageAt ?? conv.updatedAt,
      createdAt: conv.createdAt,
      messages,
    };
  }

  /**
   * Find the user's negotiator session pinned to a specific intent, if any
   * (P4.2/IND-403).
   */
  async getNegotiatorIntentChatSession(userId: string, intentId: string): Promise<ChatSession | null> {
    const normalizedIntentId = intentId.trim();
    if (!normalizedIntentId) return null;
    const [row] = await db
      .select({ conversationId: schema.chatSessionScopes.conversationId })
      .from(schema.chatSessionScopes)
      .where(
        and(
          eq(schema.chatSessionScopes.userId, userId),
          eq(schema.chatSessionScopes.scopeType, NEGOTIATOR_INTENT_SCOPE_TYPE),
          eq(schema.chatSessionScopes.scopeId, normalizedIntentId),
        ),
      )
      .limit(1);
    return row ? this.getChatSession(row.conversationId) : null;
  }

  /**
   * Create a negotiator session pinned to one of the user's intents
   * (one per user+intent, P4.2/IND-403).
   *
   * Same transaction shape as {@link createChatSession}, but the
   * registry row is keyed ('negotiator-intent', intentId) and the
   * conversation metadata carries the canonical intent scope so the session
   * behaves like any intent-scoped chat (graph seeding, scope echo on load)
   * while staying a distinct conversation from the orchestrator's session
   * for the same intent.
   */
  async createNegotiatorIntentChatSession(data: {
    id: string;
    userId: string;
    intentId: string;
    title?: string;
  }): Promise<void> {
    const now = new Date();
    const intentId = data.intentId.trim();
    await db.transaction(async (tx) => {
      await tx.insert(schema.conversations).values({
        id: data.id,
        persona: NEGOTIATOR_PERSONA,
        createdAt: now,
        updatedAt: now,
      });

      await tx.insert(schema.conversationParticipants).values([
        { conversationId: data.id, participantId: data.userId, participantType: 'user' as const },
        { conversationId: data.id, participantId: SYSTEM_AGENT_ID, participantType: 'agent' as const },
      ]);

      const meta: ChatConversationMeta = { scopeType: 'intent', scopeId: intentId };
      if (data.title) meta.title = data.title;
      await tx.insert(schema.conversationMetadata).values({
        conversationId: data.id,
        metadata: meta,
      });

      await tx.insert(schema.chatSessionScopes).values({
        conversationId: data.id,
        userId: data.userId,
        scopeType: NEGOTIATOR_INTENT_SCOPE_TYPE,
        scopeId: intentId,
        createdAt: now,
        updatedAt: now,
      });
    });
  }

  /**
   * Find a stable H2A chat session by canonical scope.
   */
  async getChatSessionByScope(
    userId: string,
    scopeType: ChatScopeType,
    scopeId: string,
    persona: string,
  ): Promise<ChatSession | null> {
    const normalizedScopeId = scopeId.trim();
    if (!normalizedScopeId) return null;

    if (scopeType === 'intent') {
      const [row] = await db
        .select({ conversationId: schema.chatSessionScopes.conversationId })
        .from(schema.chatSessionScopes)
        .where(
          and(
            eq(schema.chatSessionScopes.userId, userId),
            eq(schema.chatSessionScopes.scopeType, intentRegistryScopeType(persona)),
            eq(schema.chatSessionScopes.scopeId, normalizedScopeId),
          ),
        )
        .limit(1);
      if (!row) return null;
      const session = await this.getChatSession(row.conversationId);
      return session?.userId === userId && session.persona === persona ? session : null;
    }

    // Network-scoped sessions predate chat_session_scopes; look them up through metadata.
    const rows = await db
      .select({ conversationId: schema.conversationMetadata.conversationId })
      .from(schema.conversationMetadata)
      .where(
        sql`(${schema.conversationMetadata.metadata}->>'scopeType' = ${scopeType} AND ${schema.conversationMetadata.metadata}->>'scopeId' = ${normalizedScopeId}) OR ${schema.conversationMetadata.metadata}->>'networkId' = ${normalizedScopeId}`,
      )
      .limit(10);

    for (const row of rows) {
      const session = await this.getChatSession(row.conversationId);
      if (session?.userId === userId && session.persona === persona) return session;
    }
    return null;
  }

  /**
   * Update chat session canonical scope metadata.
   * Intent scope also upserts the stable scope mapping used by the resolver.
   */
  async updateChatSessionScope(
    sessionId: string,
    userId: string,
    scopeType: ChatScopeType | null,
    scopeId: string | null,
    persona: string,
  ): Promise<void> {
    const normalizedScopeId = scopeId?.trim() || null;
    const networkId = scopeType === 'network' ? normalizedScopeId : null;
    await this._upsertConvMeta(sessionId, { scopeType, scopeId: normalizedScopeId, networkId });

    await db.delete(schema.chatSessionScopes).where(eq(schema.chatSessionScopes.conversationId, sessionId));
    if (scopeType === 'intent' && normalizedScopeId) {
      const now = new Date();
      await db.insert(schema.chatSessionScopes).values({
        conversationId: sessionId,
        userId,
        scopeType: intentRegistryScopeType(persona),
        scopeId: normalizedScopeId,
        createdAt: now,
        updatedAt: now,
      });
    }

    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Update chat session network scope.
   */
  async updateChatSessionIndex(sessionId: string, networkId: string | null): Promise<void> {
    await this._upsertConvMeta(sessionId, {
      networkId,
      scopeType: networkId ? 'network' : null,
      scopeId: networkId,
    });
    await db.delete(schema.chatSessionScopes).where(eq(schema.chatSessionScopes.conversationId, sessionId));
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Update chat session title.
   */
  async updateChatSessionTitle(sessionId: string, title: string): Promise<void> {
    await this._upsertConvMeta(sessionId, { title });
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Update chat session timestamp.
   */
  async updateChatSessionTimestamp(sessionId: string): Promise<void> {
    await db.update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Delete a chat session (FK cascades delete participants, messages, metadata).
   */
  async deleteChatSession(sessionId: string): Promise<void> {
    await db.delete(schema.conversations)
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Set or clear the share token for a chat session.
   */
  async setChatShareToken(sessionId: string, token: string | null): Promise<void> {
    await this._upsertConvMeta(sessionId, { shareToken: token });
    await db
      .update(schema.conversations)
      .set({ updatedAt: new Date() })
      .where(eq(schema.conversations.id, sessionId));
  }

  /**
   * Find a chat session by its share token.
   */
  async getChatSessionByShareToken(token: string): Promise<ChatSession | null> {
    const metaRows = await db
      .select()
      .from(schema.conversationMetadata)
      .where(sql`${schema.conversationMetadata.metadata}->>'shareToken' = ${token}`)
      .limit(1);

    if (metaRows.length === 0) return null;

    const convId = metaRows[0].conversationId;
    return this.getChatSession(convId);
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat Message Methods (H2A message CRUD with role mapping)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Create a chat message in the messages table.
   * Maps role: 'assistant'|'system' -> role: 'agent', senderId: SYSTEM_AGENT_ID.
   * Maps role: 'user' -> role: 'user', senderId looked up from conversation_participants.
   * Stores routingDecision/subgraphResults/tokenCount in messages.metadata.
   */
  async createChatMessage(data: CreateMessageInput): Promise<void> {
    const isAgent = data.role === 'assistant' || data.role === 'system';
    let senderId: string;

    if (isAgent) {
      senderId = SYSTEM_AGENT_ID;
    } else {
      // Look up the user participant for this conversation
      const [participant] = await db
        .select({ participantId: schema.conversationParticipants.participantId })
        .from(schema.conversationParticipants)
        .where(
          and(
            eq(schema.conversationParticipants.conversationId, data.sessionId),
            eq(schema.conversationParticipants.participantType, 'user'),
          ),
        )
        .limit(1);
      if (!participant?.participantId) {
        throw new Error(`Conversation participant not found for session ${data.sessionId}`);
      }
      senderId = participant.participantId;
    }

    // Build metadata from non-null optional fields
    const msgMeta: ChatMessageMeta = {};
    if (data.routingDecision) msgMeta.routingDecision = data.routingDecision;
    if (data.subgraphResults) msgMeta.subgraphResults = data.subgraphResults;
    if (data.tokenCount !== undefined) msgMeta.tokenCount = data.tokenCount;
    if (data.interrupted) msgMeta.interrupted = true;

    await this.insertMessageWithConversationSession({
      id: data.id,
      conversationId: data.sessionId,
      senderId,
      role: isAgent ? 'agent' : 'user',
      parts: [{ type: 'text', text: data.content }],
      taskId: null,
      metadata: Object.keys(msgMeta).length > 0 ? msgMeta : null,
      extensions: null,
      referenceTaskIds: null,
    });
  }

  /**
   * Get chat messages for a conversation in chronological order.
   *
   * @param sessionId - Conversation identifier retained for the legacy chat-session API.
   * @param limit - Maximum number of messages to return from the beginning of the conversation.
   * @returns Chronologically ordered chat messages.
   */
  async getChatSessionMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    const query = db.select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));

    const rows = limit ? await query.limit(limit) : await query;

    return this.toChatMessages(sessionId, rows);
  }

  /**
   * Get the latest chat messages for model context while returning them in
   * chronological order. This deliberately does not share UI pagination reads:
   * loading older history must never alter the model's context window.
   *
   * @param sessionId - Conversation identifier retained for the legacy chat-session API.
   * @param limit - Maximum number of most-recent messages to return.
   * @returns Chronologically ordered latest chat messages.
   */
  async getLatestChatSessionMessages(sessionId: string, limit: number): Promise<ChatMessage[]> {
    const [latestSession] = await db
      .select({ id: schema.conversationSessions.id })
      .from(schema.conversationSessions)
      .where(eq(schema.conversationSessions.conversationId, sessionId))
      .orderBy(
        desc(schema.conversationSessions.lastMessageAt),
        desc(schema.conversationSessions.startedAt),
        desc(schema.conversationSessions.id),
      )
      .limit(1);
    if (!latestSession) return [];

    const rows = await db.select()
      .from(schema.messages)
      .where(eq(schema.messages.sessionId, latestSession.id))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(limit);

    return this.toChatMessages(sessionId, rows.reverse());
  }

  /**
   * Load one durable session for a chat conversation in the legacy chat-message shape.
   *
   * @param conversationId - Chat conversation identifier.
   * @param opts - Optional earlier-session cursor.
   * @returns The selected durable session, mapped messages, and prior-session signal.
   */
  async getChatConversationSessionHistory(
    conversationId: string,
    opts?: { beforeSessionId?: string },
  ): Promise<{
    session: ConversationSession | null;
    messages: ChatMessage[];
    hasPreviousSession: boolean;
  }> {
    const history = await this.getConversationSessionHistory(conversationId, opts);
    return {
      session: history.session,
      messages: this.toChatMessages(conversationId, history.messages),
      hasPreviousSession: history.hasPreviousSession,
    };
  }

  /**
   * Reconstruct the backward-compatible ChatMessage shape from message rows.
   *
   * @param sessionId - Conversation identifier for the compatibility shape.
   * @param rows - Persisted message rows in display order.
   * @returns Compatibility chat messages.
   */
  private toChatMessages(
    sessionId: string,
    rows: Array<typeof schema.messages.$inferSelect>,
  ): ChatMessage[] {
    return rows.map((msg) => {
      const parts = msg.parts as Array<{ type?: string; text?: string }>;
      const content =
        parts?.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
        ?? parts?.find((p) => typeof p?.text === 'string')?.text
        ?? '';
      const meta = (msg.metadata ?? {}) as ChatMessageMeta;

      // Map role back: 'agent' -> 'assistant'
      const role: 'user' | 'assistant' | 'system' = msg.role === 'agent' ? 'assistant' : 'user';

      return {
        id: msg.id,
        sessionId,
        role,
        content,
        routingDecision: (meta.routingDecision as Record<string, unknown>) ?? null,
        subgraphResults: (meta.subgraphResults as Record<string, unknown>) ?? null,
        tokenCount: typeof meta.tokenCount === 'number' ? meta.tokenCount : null,
        interrupted: meta.interrupted ?? null,
        createdAt: msg.createdAt,
      };
    });
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Chat Metadata Methods (trace events, debug meta, session metadata)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Verify that a message belongs to a conversation the user participates in.
   */
  async verifyChatMessageOwnership(messageId: string, userId: string): Promise<boolean> {
    const [row] = await db
      .select({ conversationId: schema.messages.conversationId })
      .from(schema.messages)
      .where(eq(schema.messages.id, messageId))
      .limit(1);

    if (!row) return false;

    const [participant] = await db
      .select({ participantId: schema.conversationParticipants.participantId })
      .from(schema.conversationParticipants)
      .where(
        and(
          eq(schema.conversationParticipants.conversationId, row.conversationId),
          eq(schema.conversationParticipants.participantId, userId),
        ),
      )
      .limit(1);

    return !!participant;
  }

  /**
   * Upsert message metadata (traceEvents, debugMeta) into the message's metadata JSONB column.
   */
  async upsertChatMessageMetadata(params: {
    id: string;
    messageId: string;
    traceEvents?: unknown;
    debugMeta?: unknown;
    streamingDrafts?: unknown;
  }): Promise<void> {
    if (
      params.traceEvents === undefined &&
      params.debugMeta === undefined &&
      params.streamingDrafts === undefined
    ) return;

    const [msg] = await db
      .select({ metadata: schema.messages.metadata })
      .from(schema.messages)
      .where(eq(schema.messages.id, params.messageId))
      .limit(1);

    if (!msg) return;

    const existing = (msg.metadata ?? {}) as ChatMessageMeta;
    const merged: ChatMessageMeta = { ...existing };
    if (params.traceEvents !== undefined) merged.traceEvents = params.traceEvents;
    if (params.debugMeta !== undefined) merged.debugMeta = params.debugMeta;
    if (params.streamingDrafts !== undefined) merged.streamingDrafts = params.streamingDrafts;

    await db
      .update(schema.messages)
      .set({ metadata: merged })
      .where(eq(schema.messages.id, params.messageId));
  }

  /**
   * Get message metadata (traceEvents, debugMeta) for a list of message IDs.
   */
  async getChatMessageMetadataByIds(messageIds: string[]): Promise<Array<{ id: string; messageId: string; traceEvents: unknown; debugMeta: unknown; streamingDrafts: unknown; discoveries: unknown; createdAt: Date }>> {
    if (messageIds.length === 0) return [];
    const rows = await db
      .select({ id: schema.messages.id, metadata: schema.messages.metadata, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(inArray(schema.messages.id, messageIds));

    return rows.map((r) => {
      const meta = (r.metadata ?? {}) as ChatMessageMeta;
      return {
        id: r.id,
        messageId: r.id,
        traceEvents: meta.traceEvents ?? null,
        debugMeta: meta.debugMeta ?? null,
        streamingDrafts: meta.streamingDrafts ?? null,
        discoveries: meta.discoveries ?? null,
        createdAt: r.createdAt,
      };
    });
  }

  /**
   * Upsert session-level metadata into conversation_metadata.
   */
  async upsertChatSessionMetadata(params: {
    id: string;
    sessionId: string;
    metadata: unknown;
  }): Promise<void> {
    const existing = await this._getConvMeta(params.sessionId);
    const merged: ChatConversationMeta = {
      ...(existing ?? {}),
      _sessionMeta: params.metadata,
    };
    await db
      .insert(schema.conversationMetadata)
      .values({ conversationId: params.sessionId, metadata: merged })
      .onConflictDoUpdate({
        target: schema.conversationMetadata.conversationId,
        set: { metadata: merged, updatedAt: new Date() },
      });
  }

  /**
   * Retrieve session metadata by session ID.
   */
  async getChatSessionMetadata(sessionId: string): Promise<{ id: string; sessionId: string; metadata: unknown; createdAt: Date; updatedAt: Date } | undefined> {
    const [row] = await db
      .select()
      .from(schema.conversationMetadata)
      .where(eq(schema.conversationMetadata.conversationId, sessionId))
      .limit(1);

    if (!row) return undefined;

    const meta = (row.metadata ?? {}) as ChatConversationMeta;
    return {
      id: row.conversationId,
      sessionId: row.conversationId,
      metadata: meta._sessionMeta ?? null,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
    };
  }

  /**
   * Update the status of an opportunity. Used by the negotiation graph/timeout queues
   * to advance the opportunity lifecycle (negotiating → pending/rejected/stalled).
   * @param id - Opportunity ID
   * @param status - New status
   * @returns The updated opportunity id+status, or null if not found
   */
  async updateOpportunityStatus(
    id: string,
    status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
    continuationExecution?: ContinuationExecutionFence,
  ): Promise<{ id: string; status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' } | null> {
    if (status === 'accepted' && !acceptedBy) throw new Error('acceptedBy is required when status is accepted');
    const row = await db.transaction(async (tx) => {
      if (continuationExecution) {
        await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      }
      const updates: Record<string, unknown> = { status, updatedAt: new Date() };
      updates.acceptedBy = status === 'accepted' ? acceptedBy : null;
      const [updated] = await tx.update(opportunities).set(updates)
        .where(eq(opportunities.id, id))
        .returning({ id: opportunities.id, status: opportunities.status });
      return updated ?? null;
    });
    if (row) emitOpportunityLifecycleBestEffort(row);
    return row;
  }

}

/** Singleton instance of the conversation database adapter. */

let _convDbInstance: ConversationDatabaseAdapter | null = null;
export function _convDb(): ConversationDatabaseAdapter {
  if (!_convDbInstance) _convDbInstance = new ConversationDatabaseAdapter();
  return _convDbInstance;
}

/**
 * Database adapter for Chat Graph and its subgraphs.
 * Session/message methods delegate to ConversationDatabaseAdapter (unified adapter).
 */
