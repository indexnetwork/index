/**
 * Locally aligned mirror of the protocol's `NegotiationCounterpartyBinding`.
 * Adapters must not import from `@indexnetwork/protocol` (see the lint rule);
 * structural compatibility is verified at the composition root via duck
 * typing, which is why this is a mirror rather than an import.
 */
type NegotiationCounterpartyBinding =
  | { kind: 'intent'; id: string }
  | { kind: 'premise'; id: string };

/**
 * Locally aligned mirrors of the protocol's `NegotiationTaskMetadata` /
 * `NegotiationTaskRow` (see `NegotiationCounterpartyBinding` above for why
 * these are duck-typed mirrors, not imports).
 */
type NegotiationTaskMetadataMirror = {
  type: 'negotiation';
  opportunityId: string;
  sourceUserId: string;
  candidateUserId: string;
  initiatorUserId: string;
  networkId: string;
  intentId: string;
  round: number;
  pause?: { reason: 'counterparty_silent' | 'needs_principal' | 'ready_for_verdict'; payload?: unknown } | null;
};

type NegotiationTaskRowMirror = {
  id: string;
  conversationId: string;
  state: 'working' | 'paused' | 'completed';
  brief: string;
  metadata: NegotiationTaskMetadataMirror;
  createdAt: Date;
  updatedAt: Date;
};

function toNegotiationTaskRow(row: {
  id: string;
  conversationId: string;
  state: string;
  brief: string | null;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): NegotiationTaskRowMirror {
  return {
    id: row.id,
    conversationId: row.conversationId,
    state: row.state as NegotiationTaskRowMirror['state'],
    brief: row.brief ?? '',
    metadata: row.metadata as NegotiationTaskMetadataMirror,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
import { projectOwnerScreenDecision } from './negotiation-lifecycle.projection';
import { selectRepresentedNegotiationSession } from './negotiation-session-rollup.projection';
import { buildHermesResponseMetadataSql, buildNegotiationParkMetadataSql } from './conversation-hermes-metadata.sql';
import { buildProfileFromUser, schema, Artifact, ChatConversationMeta, ChatMessage, ChatMessageMeta, ChatScopeType, ChatSession, Conversation, ConversationParticipant, ConversationSession, ConversationSummary, CreateMessageInput, CreateSessionInput, Message, ResolvedParticipant, SYSTEM_AGENT_ID, Task, and, asc, count, db, desc, eq, gt, gte, inArray, intents, isNull, lt, ne, opportunities, or, sql, toOpportunityRow, type OpportunityRow } from './database.shared';
import { emitOpportunityLifecycleBestEffort, emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { publishConversationMessageEvent } from '../lib/conversation-events';
import { computeIntentFingerprint } from '../lib/intent/intent.fingerprint';
import { log } from '../lib/log';
import { projectNegotiationActivity } from '../lib/negotiation-activity';
import { assertContinuationExecutionEffect, completeContinuationExecutionInTransaction, parkContinuationExecutionInTransaction, readClaimedContinuationExecutionForTimeoutInTransaction, readClaimedContinuationExecutionInTransaction, rotateClaimedContinuationExecutionForTimeoutInTransaction } from './negotiation-continuation.atomic';
import type { ContinuationExecutionFence, ContinuationReceipt } from './negotiation-continuation.atomic';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { expectedNegotiationSpeaker, negotiationScopeKey } from '../lib/negotiation/expected-speaker';
import { acquireNegotiationAttemptLock, acquireNegotiationPairLock, notArchivedNegotiationTaskWhere, qualifyingNegotiationAttemptTaskWhere, qualifyingPairNegotiationTaskWhere, type NegotiationAttemptTransaction } from './negotiation-attempt.atomic';

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

function metadataRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

/**
 * The chat-visible text of a stored message: chat writes a single text part,
 * so this is the one place that flattens `parts` back to a string for every
 * chat read.
 */
function chatMessageText(parts: unknown): string {
  const list = parts as Array<{ type?: string; text?: string }> | null | undefined;
  return list?.find((part) => part?.type === 'text' && typeof part.text === 'string')?.text
    ?? list?.find((part) => typeof part?.text === 'string')?.text
    ?? '';
}

/** Inactivity gap that opens a new durable H2A/H2H conversation session. */
const CHAT_SESSION_GAP_MS = 24 * 60 * 60 * 1000;

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

// 'stalled' admits the post-stall retry: answering a parked negotiation's
// question re-enters through negotiate-existing, which reads the current
// opportunity row and passes its status as `expectedStatus`. The exact
// status + updatedAt CAS below still applies, so only a caller that observed
// the stalled row claims the attempt; terminal statuses stay refused.
const NEGOTIATION_START_STATUSES = new Set<PersistedOpportunityStatus>([
  'latent',
  'draft',
  'pending',
  'negotiating',
  'stalled',
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
  async getUserContext(userId: string, _networkId: string | null) {
    const profile = await buildProfileFromUser(userId);
    if (!profile) return null;
    const text = [profile.identity.bio, profile.identity.name, profile.identity.location]
      .map((s) => s?.trim()).filter(Boolean).join(' ');
    if (!text) return null;
    return { id: userId, text, embedding: [] as number[], premiseHash: '', generatedAt: new Date() };
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
      negotiationTasks,
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
          taskId: schema.messages.taskId,
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
      // All negotiation task rows are fetched in one batch: the represented
      // session per conversation (`negotiation`) is chosen from them by
      // liveness, and each viewer-visible opportunity links to its own durable
      // session. This intentionally avoids loading task history per rail row.
      includeNegotiationLifecycle
        ? db
          .select({
            conversationId: schema.tasks.conversationId,
            taskId: schema.tasks.id,
            state: schema.tasks.state,
            statusTimestamp: schema.tasks.statusTimestamp,
            metadata: schema.tasks.metadata,
            updatedAt: schema.tasks.updatedAt,
            createdAt: schema.tasks.createdAt,
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

    const lastMessageByConv = new Map<string, { parts: unknown[]; senderId: string; createdAt: Date; taskId: string | null }>();
    for (const r of lastMessages) {
      const hiddenAt = hiddenAtByConv.get(r.conversationId);
      if (hiddenAt && r.createdAt <= hiddenAt) continue;
      lastMessageByConv.set(r.conversationId, {
        parts: r.parts as unknown[],
        senderId: r.senderId,
        createdAt: r.createdAt,
        taskId: r.taskId,
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

    // One row per conversation. A durable A2A conversation carries a task
    // session per opportunity the pair negotiated; the session that represents
    // it to this viewer is the most alive one, not the newest one — see
    // negotiation-session-rollup.projection.ts. A screened-out outreach gate
    // is private to the client that initiated it and is never the represented
    // session for the counterparty (the same module applies that rule before
    // ranking).
    const candidatesByConv = new Map<string, Array<typeof negotiationTasks[number] & {
      metadata: Record<string, unknown>;
      outcome: ReturnType<typeof readNegotiationOutcome>;
    }>>();
    for (const row of negotiationTasks) {
      const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const candidates = candidatesByConv.get(row.conversationId) ?? [];
      candidates.push({ ...row, metadata, outcome: readNegotiationOutcome(row.artifactParts) });
      candidatesByConv.set(row.conversationId, candidates);
    }
    const negotiationByConv = new Map<string, NonNullable<ConversationSummary['negotiation']>>();
    for (const [conversationId, candidates] of candidatesByConv) {
      const row = selectRepresentedNegotiationSession(candidates, viewerUserId);
      if (!row) continue;
      const { metadata, outcome } = row;
      const priorTurnCount = typeof metadata.priorTurnCount === 'number' && Number.isFinite(metadata.priorTurnCount)
        ? metadata.priorTurnCount
        : 0;
      const maxTurns = typeof metadata.maxTurns === 'number' && Number.isFinite(metadata.maxTurns)
        ? metadata.maxTurns
        : null;
      negotiationByConv.set(conversationId, {
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

    // One durable A2A conversation can carry many task sessions. Project only
    // opportunities already visible to this viewer through match provenance,
    // then choose the newest task for each opportunity as its session target.
    const negotiationOpportunitiesByConv = new Map<string, NonNullable<ConversationSummary['negotiationOpportunities']>>();
    const latestTaskByOpportunity = new Map<string, typeof negotiationTasks[number]>();
    for (const row of negotiationTasks) {
      const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const opportunityId = typeof metadata.opportunityId === 'string' ? metadata.opportunityId : null;
      if (!opportunityId) continue;
      const key = `${row.conversationId}:${opportunityId}`;
      if (!latestTaskByOpportunity.has(key)) latestTaskByOpportunity.set(key, row);
    }
    // Older negotiations may predate durable match provenance. Recover only
    // the viewer's own signal from the opportunity record so their sidebar
    // still names the actual signal, never the counterpart's private one.
    const fallbackOpportunityIds = [...new Set([...latestTaskByOpportunity.values()].flatMap((row) => {
      const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
        ? row.metadata as Record<string, unknown>
        : {};
      const opportunityId = typeof metadata.opportunityId === 'string' ? metadata.opportunityId : null;
      return opportunityId ? [opportunityId] : [];
    }))];
    const fallbackOpportunityRows = fallbackOpportunityIds.length > 0
      ? await db.select({ id: opportunities.id, detection: opportunities.detection, actors: opportunities.actors })
        .from(opportunities).where(inArray(opportunities.id, fallbackOpportunityIds))
      : [];
    const fallbackIntentIds = new Set<string>();
    for (const opportunity of fallbackOpportunityRows) {
      if (opportunity.detection.triggeredBy) fallbackIntentIds.add(opportunity.detection.triggeredBy);
      for (const actor of opportunity.actors) {
        if (actor.userId === viewerUserId && actor.intent) fallbackIntentIds.add(actor.intent);
      }
    }
    const fallbackIntentRows = fallbackIntentIds.size > 0
      ? await db.select({ id: schema.intents.id, payload: schema.intents.payload, summary: schema.intents.summary })
        .from(schema.intents).where(and(inArray(schema.intents.id, [...fallbackIntentIds]), eq(schema.intents.userId, viewerUserId)))
      : [];
    const fallbackTitles = new Map(fallbackIntentRows.map((intent) => [intent.id, intent.summary?.trim() || intent.payload]));
    const fallbackViaByOpportunity = new Map<string, { intentId: string; title: string }>();
    for (const opportunity of fallbackOpportunityRows) {
      const intentId = opportunity.actors.find((actor) => actor.userId === viewerUserId && actor.intent)?.intent
        ?? opportunity.detection.triggeredBy;
      const title = intentId ? fallbackTitles.get(intentId) : undefined;
      if (intentId && title) fallbackViaByOpportunity.set(opportunity.id, { intentId, title });
    }
    for (const conversation of convs) {
      const visibleByOpportunity = new Map(
        (viaByConv.get(conversation.id) ?? []).map((entry) => [entry.opportunityId, entry]),
      );
      for (const row of latestTaskByOpportunity.values()) {
        if (row.conversationId !== conversation.id) continue;
        const metadata = typeof row.metadata === 'object' && row.metadata !== null && !Array.isArray(row.metadata)
          ? row.metadata as Record<string, unknown>
          : {};
        const opportunityId = typeof metadata.opportunityId === 'string' ? metadata.opportunityId : null;
        const fallback = opportunityId ? fallbackViaByOpportunity.get(opportunityId) : undefined;
        if (opportunityId && fallback && !visibleByOpportunity.has(opportunityId)) {
          visibleByOpportunity.set(opportunityId, { opportunityId, ...fallback });
        }
      }
      const projected = [...visibleByOpportunity.values()].flatMap((via) => {
        const row = latestTaskByOpportunity.get(`${conversation.id}:${via.opportunityId}`);
        if (!row) return [];
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
        return [{
          ...via,
          taskId: row.taskId,
          state: row.state,
          opportunityStatus: row.opportunityStatus,
          acceptedByViewer: row.opportunityAcceptedBy === viewerUserId,
          turnCount: priorTurnCount + (outcome?.turnCount ?? Number(row.currentTurnCount)),
          maxTurns,
          signalCount: readNegotiationSignalCount(metadata),
          outcome: outcome ? { hasOpportunity: outcome.hasOpportunity, reason: outcome.reason } : null,
          updatedAt: row.updatedAt,
        }];
      });
      negotiationOpportunitiesByConv.set(conversation.id, projected);
    }

    return convs.map((c) => ({
      ...c,
      participants: participantsByConv.get(c.id) ?? [],
      lastMessage: lastMessageByConv.get(c.id) ?? null,
      metadata: metaByConv.get(c.id) ?? null,
      via: viaByConv.get(c.id) ?? [],
      unreadCount: unreadCountByConv.get(c.id) ?? 0,
      ...(includeNegotiationLifecycle ? { negotiation: negotiationByConv.get(c.id) ?? null } : {}),
      ...(includeNegotiationLifecycle ? { negotiationOpportunities: negotiationOpportunitiesByConv.get(c.id) ?? [] } : {}),
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
      return this.insertMessageInTransaction(tx, data);
    });
  }

  /**
   * The session-scoped insert itself, on a caller-supplied transaction. Never
   * opens its own `db.transaction` — a caller that already holds this
   * conversation's advisory lock (e.g. `createNegotiationMessage`'s CAS) must
   * reuse its own connection here, since a second `db.transaction` would pin
   * a second pool connection and self-deadlock re-requesting the same
   * session-scoped lock the first one is still holding.
   */
  private async insertMessageInTransaction(tx: DrizzleDB, data: {
    id: string;
    conversationId: string;
    senderId: string;
    role: 'user' | 'agent';
    parts: unknown[];
    taskId: string | null;
    metadata: Record<string, unknown> | null;
    extensions: string[] | null;
    referenceTaskIds: string[] | null;
  }): Promise<Message> {
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
          || now.getTime() - currentSession.lastMessageAt.getTime() > CHAT_SESSION_GAP_MS;
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
   * Stamps `metadata.watchdogAttempts` on a stale task, CAS-guarded by the
   * watchdog's own read of `updatedAt` (same fence as
   * `transitionNegotiationTaskForWatchdog`) — the sweep only counts an
   * attempt against the exact row it decided to act on. State is left
   * untouched; the subsequent pause invoke (success or failure) may still
   * change it separately.
   */
  async recordNegotiationWatchdogAttempt(input: {
    taskId: string;
    expectedUpdatedAt: Date;
    attempts: number;
  }): Promise<Task | null> {
    const [current] = await db
      .select({ metadata: schema.tasks.metadata, updatedAt: schema.tasks.updatedAt })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, input.taskId))
      .limit(1);
    if (!current || current.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()) return null;
    const currentMetadata = (current.metadata ?? {}) as Record<string, unknown>;

    const [task] = await db
      .update(schema.tasks)
      .set({
        metadata: { ...currentMetadata, watchdogAttempts: input.attempts },
        updatedAt: new Date(),
      })
      .where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.updatedAt, input.expectedUpdatedAt),
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
    counterpartyBinding: NegotiationCounterpartyBinding;
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

      const actors = opportunity.actors as Array<{ userId?: string; intent?: string; premise?: string; networkId?: string; role?: string }>;
      const recipient = actors.filter((actor) => actor.role !== 'introducer'
        && actor.userId === input.recipientUserId
        && actor.intent === input.recipientIntentId
        && actor.networkId === input.networkId);
      // A counterparty actor is bound EITHER by a stated intent or by a
      // premise — premise discovery produces the second kind, and in dev it
      // produces most of them. Requiring `intent` here threw "ambiguous" for
      // every premise-matched counterparty, which failed the turn and ended the
      // negotiation as a withdrawal: asking was the one move that could not be
      // made against most of the pool. The recipient side is unchanged — the
      // person being asked is always bound to the intent under negotiation.
      const counterparties = actors.filter((actor) => actor.role !== 'introducer'
        && actor.userId !== input.recipientUserId
        && actor.networkId === input.networkId
        && typeof actor.userId === 'string'
        && (typeof actor.intent === 'string' || typeof actor.premise === 'string'));
      if (recipient.length !== 1 || counterparties.length !== 1) {
        throw new Error('Ask-user opportunity actor binding is ambiguous');
      }
      const counterpartyUserId = counterparties[0].userId!;
      // A premise-matched actor's `intent` key names the intent it matched
      // against (the recipient's), never its own material — so a present
      // `premise` is the binding, and `intent` binds only in its absence.
      const counterpartyBinding: NegotiationCounterpartyBinding = typeof counterparties[0].premise === 'string'
        ? { kind: 'premise', id: counterparties[0].premise }
        : { kind: 'intent', id: counterparties[0].intent! };
      const members = await tx.select({ userId: schema.networkMembers.userId }).from(schema.networkMembers)
        .innerJoin(schema.networks, and(
          eq(schema.networks.id, schema.networkMembers.networkId),
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
        counterpartyBinding,
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
   * Merges an applied deadlock→bargaining shift record (IND-428) into the
   * task's metadata JSONB under the `deadlockShift` key, preserving other
   * metadata keys. Sibling of {@link setTaskTurnContext}. Internal
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
   * Replaces the task's `metadata.failedTurns` with the graph's capped
   * failure trace, preserving other metadata keys. Sibling of
   * {@link setTaskDeadlockShift}. Internal diagnostics only — no API surface
   * projects this key.
   *
   * @param taskId - Task to update
   * @param failedTurns - NegotiationTurnFailure records (at, seat, turnIndex, error)
   */
  async setTaskFailedTurns(taskId: string, failedTurns: Array<Record<string, unknown>>, continuationExecution?: ContinuationExecutionFence): Promise<void> {
    await db.transaction(async (tx) => {
      if (continuationExecution) await assertContinuationExecutionEffect(tx as unknown as typeof db, continuationExecution);
      await tx.update(schema.tasks).set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('failedTurns', ${JSON.stringify(failedTurns)}::jsonb)`,
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

  // ─────────────────────────────────────────────────────────────────────────
  // NegotiationGraph (rewrite, #1494) — implements the protocol's
  // `NegotiationGraphDatabase` port by duck typing (adapters must not import
  // from `@indexnetwork/protocol`; see the file-top note on
  // `NegotiationCounterpartyBinding`). A negotiation is one `tasks` row, its
  // own `conversations` row (never pair-shared), and its own messages —
  // there is no continuation chain any more.
  // ─────────────────────────────────────────────────────────────────────────

  /** `NegotiationGraphDatabase`'s opportunity read — mirrors `OpportunityDatabaseAdapter.getOpportunity`. */
  async getOpportunity(id: string): Promise<OpportunityRow | null> {
    const [row] = await db.select().from(opportunities).where(eq(opportunities.id, id)).limit(1);
    return row ? toOpportunityRow(row) : null;
  }

  /** `NegotiationGraphDatabase`'s intent read — mirrors `ChatDatabaseAdapter.getIntent`. */
  async getIntent(intentId: string) {
    const rows = await db
      .select({
        id: intents.id,
        payload: intents.payload,
        summary: intents.summary,
        isIncognito: intents.isIncognito,
        createdAt: intents.createdAt,
        updatedAt: intents.updatedAt,
        userId: intents.userId,
        archivedAt: intents.archivedAt,
        embedding: intents.embedding,
        sourceType: intents.sourceType,
        sourceId: intents.sourceId,
        status: intents.status,
      })
      .from(intents)
      .where(eq(intents.id, intentId))
      .limit(1);
    const row = rows[0];
    if (!row) return null;
    const emb = row.embedding;
    const embedding: number[] | null =
      emb == null
        ? null
        : Array.isArray(emb) && emb.length > 0 && Array.isArray(emb[0])
          ? (emb[0] as number[])
          : Array.isArray(emb)
            ? (emb as number[])
            : null;
    return {
      id: row.id,
      payload: row.payload,
      summary: row.summary,
      isIncognito: row.isIncognito,
      createdAt: row.createdAt,
      updatedAt: row.updatedAt,
      userId: row.userId,
      archivedAt: row.archivedAt,
      embedding: embedding ?? undefined,
      sourceType: row.sourceType ?? undefined,
      sourceId: row.sourceId ?? undefined,
      status: row.status,
    };
  }

  /** Creates the negotiation's own conversation — never a pair-shared DM. */
  async createNegotiationConversation(sourceUserId: string, candidateUserId: string): Promise<{ id: string }> {
    const conversation = await this.createConversation([
      { participantId: sourceUserId, participantType: 'agent' },
      { participantId: candidateUserId, participantType: 'agent' },
    ]);
    return { id: conversation.id };
  }

  /** Creates the negotiation task. Called once, at open. */
  async createNegotiationTask(input: {
    conversationId: string;
    brief: string;
    metadata: NegotiationTaskMetadataMirror;
  }): Promise<NegotiationTaskRowMirror> {
    const [row] = await db
      .insert(schema.tasks)
      .values({
        conversationId: input.conversationId,
        state: 'working',
        brief: input.brief,
        metadata: input.metadata,
      })
      .returning();
    return toNegotiationTaskRow(row);
  }

  /**
   * The one open (non-completed) negotiation task for an opportunity, if any.
   */
  async getNegotiationTaskForOpportunity(opportunityId: string): Promise<NegotiationTaskRowMirror | null> {
    const [row] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
          ne(schema.tasks.state, 'completed'),
        ),
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);
    if (!row) return null;
    return toNegotiationTaskRow(row);
  }

  async getNegotiationTask(taskId: string): Promise<NegotiationTaskRowMirror | null> {
    const [row] = await db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId)).limit(1);
    if (!row) return null;
    return toNegotiationTaskRow(row);
  }

  /** Every negotiation task where the given user is source or candidate. */
  async getNegotiationTasksForUser(userId: string): Promise<NegotiationTaskRowMirror[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          or(
            sql`${schema.tasks.metadata}->>'sourceUserId' = ${userId}`,
            sql`${schema.tasks.metadata}->>'candidateUserId' = ${userId}`,
          ),
        ),
      )
      .orderBy(desc(schema.tasks.createdAt));
    return rows.map(toNegotiationTaskRow);
  }

  /**
   * Transitions state and, for `paused`, records the reason/payload. Merges
   * into metadata; other keys are untouched.
   */
  async updateNegotiationTaskState(
    taskId: string,
    state: 'working' | 'paused' | 'completed',
    pause?: NegotiationTaskMetadataMirror['pause'],
  ): Promise<NegotiationTaskRowMirror> {
    const [current] = await db
      .select({ metadata: schema.tasks.metadata })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);
    const currentMetadata = (current?.metadata as NegotiationTaskMetadataMirror | null) ?? undefined;
    const nextMetadata = pause !== undefined ? { ...currentMetadata, pause: pause ?? null } : currentMetadata;

    const [row] = await db
      .update(schema.tasks)
      .set({ state, ...(nextMetadata !== undefined ? { metadata: nextMetadata } : {}), updatedAt: new Date() })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    return toNegotiationTaskRow(row);
  }

  /** Overwrites the brief at resume. */
  async setNegotiationBrief(taskId: string, brief: string): Promise<void> {
    await db.update(schema.tasks).set({ brief, updatedAt: new Date() }).where(eq(schema.tasks.id, taskId));
  }

  /** Stamps metadata.round when an open re-targets an existing task into a freshly bumped round. */
  async setNegotiationRound(taskId: string, round: number): Promise<void> {
    const [current] = await db
      .select({ metadata: schema.tasks.metadata })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, taskId))
      .limit(1);
    const currentMetadata = (current?.metadata as NegotiationTaskMetadataMirror | null) ?? {};
    await db.update(schema.tasks).set({
      metadata: { ...currentMetadata, round },
      updatedAt: new Date(),
    }).where(eq(schema.tasks.id, taskId));
  }

  /**
   * Persists one turn, fenced against a concurrent duplicate submission: the
   * insert only proceeds if the task's current message count still equals
   * `expectedMessageCount` (what `apply` read immediately before deciding
   * what to persist). Everything — the count check and the insert itself —
   * runs on this single transaction/connection: `insertMessageInTransaction`
   * takes `tx` directly rather than opening its own `db.transaction`, since a
   * second pooled connection re-requesting the advisory lock this one
   * already holds would self-deadlock (the first connection can't release it
   * until this call resolves).
   */
  async createNegotiationMessage(input: {
    conversationId: string;
    taskId: string;
    senderId: string;
    parts: unknown[];
    expectedMessageCount: number;
  }): Promise<{ id: string; senderId: string; parts: unknown[]; createdAt: Date } | null> {
    const message = await db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${input.conversationId}`}, 0)
        )
      `);
      const [{ count }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(schema.messages)
        .where(eq(schema.messages.taskId, input.taskId));
      if (count !== input.expectedMessageCount) return null;

      return this.insertMessageInTransaction(tx, {
        id: crypto.randomUUID(),
        conversationId: input.conversationId,
        senderId: input.senderId,
        role: 'agent',
        parts: input.parts,
        taskId: input.taskId,
        metadata: null,
        extensions: null,
        referenceTaskIds: null,
      });
    });
    if (!message) return null;

    // Same SSE publish `createMessage` does for every other writer, run
    // after commit since the negotiation graph's own transaction is done.
    try {
      const senderUserId = input.senderId.startsWith('agent:')
        ? input.senderId.slice('agent:'.length)
        : input.senderId;
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
        await this.getParticipants(input.conversationId),
      );
    } catch (error) {
      logger.error('Failed to publish conversation SSE event', {
        conversationId: input.conversationId,
        error: error instanceof Error ? error.message : String(error),
      });
    }

    return { id: message.id, senderId: message.senderId, parts: message.parts as unknown[], createdAt: message.createdAt };
  }

  /** This negotiation's own turns, oldest first. */
  async getNegotiationMessages(taskId: string): Promise<Array<{
    id: string;
    senderId: string;
    parts: unknown[];
    createdAt: Date;
  }>> {
    const rows = await db
      .select({
        id: schema.messages.id,
        senderId: schema.messages.senderId,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
      })
      .from(schema.messages)
      .where(eq(schema.messages.taskId, taskId))
      .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id));
    return rows.map((r) => ({ ...r, parts: (r.parts as unknown[]) ?? [] }));
  }

  /** Persists the resolve outcome artifact. */
  async createNegotiationOutcomeArtifact(taskId: string, outcome: { verdict: 'pending' | 'reject'; reasoning?: string }): Promise<void> {
    await db.insert(schema.artifacts).values({
      taskId,
      name: 'negotiation_outcome',
      parts: [{ kind: 'data', data: outcome }],
    });
  }

  /** Bumps `intents.negotiation_round` for `intentId` and returns the new value. Called once per kickoff. */
  async bumpIntentNegotiationRound(intentId: string): Promise<number> {
    const [row] = await db
      .update(schema.intents)
      .set({ negotiationRound: sql`${schema.intents.negotiationRound} + 1` })
      .where(eq(schema.intents.id, intentId))
      .returning({ negotiationRound: schema.intents.negotiationRound });
    return row?.negotiationRound ?? 0;
  }

  /** Count of this intent's round-`round` negotiations not yet `paused` or `completed`. */
  async countActiveNegotiationsForRound(intentId: string, round: number): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'intentId' = ${intentId}`,
          sql`(${schema.tasks.metadata}->>'round')::int = ${round}`,
          eq(schema.tasks.state, 'working'),
        ),
      );
    return row?.value ?? 0;
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

    // `screened_out` negotiations are the owner's own private refusal before
    // any contact — zero turns, no counterparty involvement. They stay visible
    // to the owner (self view) but are excluded from the mutual (non-self
    // viewer) list so the counterparty never learns the match existed. Covers
    // both the live route (an opening-turn withdraw) and rows stamped by the
    // removed outreach gate.
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
    if (data.options?.length) msgMeta.options = data.options;

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
   * The newest message in a chat conversation, by the same (createdAt, id)
   * order every conversation read uses, or null when it has none. This is the
   * edit-rule anchor read: the question-message regeneration job uses it to
   * decide between rewriting the open question-message and appending a fresh
   * one.
   *
   * @param sessionId - Conversation identifier retained for the legacy chat-session API.
   * @returns The newest chat message, or null for an empty conversation.
   */
  async getNewestChatMessage(sessionId: string): Promise<ChatMessage | null> {
    const [row] = await db.select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
      .limit(1);
    return row ? this.toChatMessages(sessionId, [row])[0] : null;
  }

  /**
   * The newest agent-authored message in each of the user's
   * ('negotiator-intent', intentId) DMs — one row per signal that has one.
   *
   * The anchor read behind the notification snapshot's question frames: an
   * open question-message is the newest agent message in the signal's DM whose
   * block still references a parked negotiation, and this returns the first
   * half of that. Deliberately no body filtering here — parsing the question
   * block and re-deriving the parked set are the caller's job, so this stays
   * one indexed read instead of a per-signal fan-out.
   *
   * @param userId - The signal owner
   * @returns Newest agent message per negotiator-intent DM, content flattened
   */
  async getNewestAgentMessagesForNegotiatorIntents(
    userId: string,
  ): Promise<Array<{ intentId: string; sessionId: string; messageId: string; content: string }>> {
    if (!userId) return [];
    const rows = await db
      .selectDistinctOn([schema.chatSessionScopes.scopeId], {
        intentId: schema.chatSessionScopes.scopeId,
        sessionId: schema.messages.conversationId,
        messageId: schema.messages.id,
        parts: schema.messages.parts,
      })
      .from(schema.chatSessionScopes)
      .innerJoin(
        schema.messages,
        eq(schema.messages.conversationId, schema.chatSessionScopes.conversationId),
      )
      .where(and(
        eq(schema.chatSessionScopes.userId, userId),
        eq(schema.chatSessionScopes.scopeType, NEGOTIATOR_INTENT_SCOPE_TYPE),
        eq(schema.messages.role, 'agent'),
      ))
      .orderBy(
        schema.chatSessionScopes.scopeId,
        desc(schema.messages.createdAt),
        desc(schema.messages.id),
      );
    return rows.map((row) => ({
      intentId: row.intentId,
      sessionId: row.sessionId,
      messageId: row.messageId,
      content: chatMessageText(row.parts),
    }));
  }

  /**
   * Content update for the question-message edit rule (conversational
   * questions): rewrite one agent-authored message inside the caller's
   * ('negotiator-intent', intentId) session, but only while it is still the
   * newest message in its conversation.
   *
   * All three guards — agent-authored, negotiator-intent scope, still-newest —
   * live in the UPDATE statement itself, so a user reply racing the
   * regeneration wins: once the reply row is visible, the newest check fails,
   * the statement no-ops, and the caller falls back to appending a fresh
   * message instead of rewriting text above an answer.
   *
   * @returns Whether the update was applied.
   */
  async updateNewestAgentQuestionMessage(params: {
    userId: string;
    intentId: string;
    messageId: string;
    content: string;
    regeneratedAt: Date;
  }): Promise<boolean> {
    const regeneratedMeta = JSON.stringify({ regeneratedAt: params.regeneratedAt.toISOString() });
    const updated = await db
      .update(schema.messages)
      .set({
        parts: [{ type: 'text', text: params.content }],
        metadata: sql`coalesce(${schema.messages.metadata}, '{}'::jsonb) || ${regeneratedMeta}::jsonb`,
      })
      .where(and(
        eq(schema.messages.id, params.messageId),
        eq(schema.messages.role, 'agent'),
        sql`EXISTS (
          SELECT 1 FROM ${schema.chatSessionScopes}
          WHERE ${schema.chatSessionScopes.conversationId} = ${schema.messages.conversationId}
            AND ${schema.chatSessionScopes.userId} = ${params.userId}
            AND ${schema.chatSessionScopes.scopeType} = ${NEGOTIATOR_INTENT_SCOPE_TYPE}
            AND ${schema.chatSessionScopes.scopeId} = ${params.intentId}
        )`,
        // The alias hides the inner table, so the qualified "messages" columns
        // inside resolve to the UPDATE target: newer-than-this-row.
        sql`NOT EXISTS (
          SELECT 1 FROM ${schema.messages} newer
          WHERE newer.conversation_id = ${schema.messages.conversationId}
            AND (newer.created_at, newer.id) > (${schema.messages.createdAt}, ${schema.messages.id})
        )`,
      ))
      .returning({ id: schema.messages.id });
    return updated.length > 0;
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
      const content = chatMessageText(msg.parts);
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
        options: Array.isArray(meta.options) ? meta.options.filter((o): o is string => typeof o === 'string') : null,
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
    if (row) {
      emitOpportunityLifecycleBestEffort(row);
      emitOpportunityTransitionBestEffort(row);
    }
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
