/**
 * Locally aligned mirror of the protocol's `NEGOTIATION_PAUSE_REASONS`.
 *
 * Adapters may not import from `@indexnetwork/protocol` (see the lint rule),
 * so this list is a copy — and a copy that silently loses a member is how a
 * real pause reason reached the web rendered as its opposite. The drift is
 * pinned by `tests/negotiation-pause-reason.mirror.spec.ts`, which compares
 * this array against the protocol's own.
 */
export const NEGOTIATION_PAUSE_REASONS = [
  'counterparty_silent',
  'needs_principal',
  'ready_for_verdict',
  'turn_cap',
  'open_failed',
] as const;
export type NegotiationPauseReason = (typeof NEGOTIATION_PAUSE_REASONS)[number];

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
  /** One binding per seat, keyed by intent id — the protocol's `seats`. */
  seats: Record<string, { userId: string; batchId: string | null }>;
  pause?: { reason: NegotiationPauseReason; payload?: unknown; pausedBy?: string; failure?: string; failureDetail?: string } | null;
};

type NegotiationTaskRowMirror = {
  id: string;
  conversationId: string;
  state: 'submitted' | 'working' | 'paused' | 'completed';
  briefs: Record<string, string>;
  metadata: NegotiationTaskMetadataMirror;
  createdAt: Date;
  updatedAt: Date;
};

function toNegotiationTaskRow(row: {
  id: string;
  conversationId: string;
  state: string;
  briefs: unknown;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
}): NegotiationTaskRowMirror {
  return {
    id: row.id,
    conversationId: row.conversationId,
    state: row.state as NegotiationTaskRowMirror['state'],
    briefs: (row.briefs ?? {}) as Record<string, string>,
    metadata: row.metadata as NegotiationTaskMetadataMirror,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}
import { projectOwnerScreenDecision } from './negotiation-lifecycle.projection';
import { buildProfileFromUser, schema, Artifact, ChatConversationMeta, ChatMessage, ChatMessageMeta, ChatScopeType, ChatSession, Conversation, ConversationParticipant, ConversationSession, ConversationSummary, CreateMessageInput, CreateSessionInput, Message, ResolvedParticipant, SYSTEM_AGENT_ID, Task, and, asc, count, db, desc, eq, gt, inArray, intents, isNull, lt, ne, notInArray, opportunities, or, sql, toOpportunityRow, type OpportunityRow } from './database.shared';
import { emitOpportunityLifecycleBestEffort, emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { publishConversationMessageEvent, publishIntentInvalidationEvent } from '../lib/conversation-events';
import { log } from '../lib/log';
import type { DrizzleDB } from '../lib/drizzle/drizzle';
import { acquireNegotiationAttemptLock, notArchivedNegotiationTaskWhere, qualifyingNegotiationAttemptTaskWhere, rewriteEraNegotiationTaskWhere, type NegotiationAttemptTransaction } from './negotiation-attempt.atomic';

/** Extracts only the public portion of the latest persisted A2A turn. */
function intentCycleLatestActivity(
  parts: unknown[],
  senderId: string,
  ownerUserId: string,
  createdAt: Date,
): { actor: 'yours' | 'theirs'; verb: string | null; text: string | null; createdAt: Date } {
  let verb: string | null = null;
  let text: string | null = null;
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) text = record.text.trim();
    if (record.kind !== 'data' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue;
    const turn = record.data as Record<string, unknown>;
    if (typeof turn.verb === 'string') verb = turn.verb;
    // Pause payloads are seat-private. Their prose is deliberately absent
    // even when a malformed historic row happened to include a message field.
    if (verb !== 'pause' && typeof turn.message === 'string' && turn.message.trim()) text = turn.message.trim();
  }
  return { actor: senderId === `agent:${ownerUserId}` ? 'yours' : 'theirs', verb, text: verb === 'pause' ? null : text, createdAt };
}

function intentCyclePauseReason(value: unknown): NegotiationPauseReason | null {
  return typeof value === 'string' && NEGOTIATION_PAUSE_REASONS.includes(value as NegotiationPauseReason)
    ? value as NegotiationPauseReason
    : null;
}

/** One transcript row, stripping another seat's private pause payload. */
function intentCycleTranscriptTurn(
  row: { id: string; senderId: string; parts: unknown; createdAt: Date },
  ownerUserId: string,
): {
  id: string;
  actor: 'yours' | 'theirs';
  verb: string | null;
  pause: { reason: NegotiationPauseReason; payload?: unknown } | null;
  text: string | null;
  createdAt: Date;
} {
  const parts = Array.isArray(row.parts) ? row.parts : [];
  const own = row.senderId === `agent:${ownerUserId}`;
  let verb: string | null = null;
  let reason: NegotiationPauseReason | null = null;
  let payload: unknown;
  let text: string | null = null;
  for (const part of parts) {
    if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === 'string' && record.text.trim()) text = record.text.trim();
    if (record.kind !== 'data' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue;
    const turn = record.data as Record<string, unknown>;
    if (typeof turn.verb === 'string') verb = turn.verb;
    if (verb === 'pause') {
      reason = intentCyclePauseReason(turn.reason);
      if (own && turn.payload !== undefined) payload = turn.payload;
    } else if (typeof turn.message === 'string' && turn.message.trim()) {
      text = turn.message.trim();
    }
  }
  return {
    id: row.id,
    actor: own ? 'yours' : 'theirs',
    verb,
    pause: reason ? { reason, ...(own && payload !== undefined ? { payload } : {}) } : null,
    text: verb === 'pause' ? null : text,
    createdAt: row.createdAt,
  };
}

function intentCycleOwnOutcome(
  artifacts: Array<{ name: string | null; parts: unknown; metadata: unknown }>,
  ownerUserId: string,
): { verdict: 'pending' | 'reject'; reasoning: string | null } | null {
  for (const artifact of artifacts) {
    if (artifact.name !== 'negotiation_outcome') continue;
    const metadata = artifact.metadata && typeof artifact.metadata === 'object' && !Array.isArray(artifact.metadata)
      ? artifact.metadata as Record<string, unknown>
      : null;
    if (metadata?.resolvedByUserId !== ownerUserId) continue;
    for (const part of Array.isArray(artifact.parts) ? artifact.parts : []) {
      if (!part || typeof part !== 'object' || Array.isArray(part)) continue;
      const record = part as Record<string, unknown>;
      if (record.kind !== 'data' || !record.data || typeof record.data !== 'object' || Array.isArray(record.data)) continue;
      const outcome = record.data as Record<string, unknown>;
      if (outcome.resolvedByUserId !== ownerUserId || (outcome.verdict !== 'pending' && outcome.verdict !== 'reject')) continue;
      return { verdict: outcome.verdict, reasoning: typeof outcome.reasoning === 'string' ? outcome.reasoning : null };
    }
  }
  return null;
}

/** Persona literal mirrored locally so the data layer stays protocol-agnostic. */
const PERSONAL_AGENT_PERSONA = 'personal';
const logger = log.lib.from('conversation-database');

/**
 * Registry scope_type for intent-pinned PersonalAgent sessions — the signal's
 * DM. Keyed ('personal-intent', intentId) in the `chat_session_scopes` unique
 * index; the retired 'signal-intent'/'negotiator-intent' keys were folded into
 * it by migration. This value is deliberately outside the `ChatScopeType`
 * ('network' | 'intent') envelope and never appears in it —
 * `_normalizeScopeType` ignores it, and conversation_metadata still says
 * scopeType 'intent' so scope-driven behavior (graph seeding, session load)
 * is identical to any intent-scoped session. The bare 'intent' key is
 * retired: it belonged to the removed orchestrator persona, whose rows are
 * retained read-only.
 */
const PERSONAL_INTENT_SCOPE_TYPE = 'personal-intent';

/**
 * The ONE builder for "this conversation is a signal's DM": the user's
 * ('personal-intent', *) registry rows, as a subquery for the listing and
 * detail reads that must exclude DMs. User-scoped so it always hits the
 * (user_id, scope_type, scope_id) unique index.
 */
function intentPinnedConversationIds(userId: string) {
  return db
    .select({ conversationId: schema.chatSessionScopes.conversationId })
    .from(schema.chatSessionScopes)
    .where(and(
      eq(schema.chatSessionScopes.userId, userId),
      eq(schema.chatSessionScopes.scopeType, PERSONAL_INTENT_SCOPE_TYPE),
    ));
}

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

/**
 * Projects `metadata.pause` for one viewer: the payload is private to the
 * seat that paused (`pausedBy`) — every other viewer sees the reason only.
 * Same rule as `negotiation.tools.ts`'s `pauseFor` on the A2A side.
 */
function readNegotiationPause(
  metadata: unknown,
  viewerUserId: string,
  state: string,
): { reason: NegotiationPauseReason; payload?: unknown } | null {
  // Same gate `toResult` applies graph-side: a non-paused task's
  // metadata.pause is stale/answered, not current, even if a caller failed to
  // clear it on resume.
  if (state !== 'paused') return null;
  if (typeof metadata !== 'object' || metadata === null || Array.isArray(metadata)) return null;
  const pause = (metadata as Record<string, unknown>).pause;
  if (typeof pause !== 'object' || pause === null || Array.isArray(pause)) return null;
  const record = pause as { reason?: unknown; payload?: unknown; pausedBy?: unknown };
  if (typeof record.reason !== 'string') return null;
  // Validated, not cast: an unknown reason coming back from the database is
  // a value every downstream union would mis-render, and silently narrowing
  // it to a member of this union is how `open_failed` reached the web as
  // "the negotiator recommends a decision".
  if (!(NEGOTIATION_PAUSE_REASONS as readonly string[]).includes(record.reason)) return null;
  const reason = record.reason as NegotiationPauseReason;
  return record.pausedBy === viewerUserId ? { reason, payload: record.payload } : { reason };
}

type PersistedOpportunity = typeof opportunities.$inferSelect;
type PersistedOpportunityStatus = PersistedOpportunity['status'];

// `pending` belongs to the principal's decision lane.
const NEGOTIATION_OPEN_STATUSES = new Set<PersistedOpportunityStatus>([
  'negotiating',
  'stalled',
]);

// `stalled` remains openable for a later graph-driven retry. The exact
// status + updatedAt CAS below still applies, so only a caller that observed
// the stalled row claims the attempt; terminal statuses stay refused.
const NEGOTIATION_START_STATUSES = new Set<PersistedOpportunityStatus>([
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
  state: 'submitted' | 'working' | 'paused' | 'completed';
  createdAt: Date;
  updatedAt: Date;
  metadata: Record<string, unknown> | null;
}

/**
 * Claim an exact eligible opportunity state, promote it to negotiating, and
 * insert its task while the opportunity attempt and row locks are held.
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
    })
    .from(opportunities)
    .where(eq(opportunities.id, input.opportunityId))
    .for('update');
  if (!opportunity) return null;

  if (
    opportunity.status !== input.expectedStatus
    || !NEGOTIATION_START_STATUSES.has(opportunity.status)
    || opportunity.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
  ) {
    return null;
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

    // One negotiation task owns one A2A conversation under NegotiationGraph.
    // Historical multi-task conversations remain readable via their newest task.
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
      const row = candidates.sort((left, right) => right.createdAt.getTime() - left.createdAt.getTime())[0];
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
        pause: readNegotiationPause(metadata, viewerUserId, row.state),
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
    });

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
  }): Promise<Message> {
    return db.transaction((tx) => this.insertMessageInTransaction(tx, data));
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

  /** Stale active tasks plus durable paused states that require watchdog recovery. */
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
        rewriteEraNegotiationTaskWhere(),
        or(
          and(eq(schema.tasks.state, 'submitted'), lt(schema.tasks.createdAt, submittedCutoff)),
          and(eq(schema.tasks.state, 'working'), lt(schema.tasks.updatedAt, workingCutoff)),
          and(
            inArray(schema.tasks.state, ['submitted', 'working']),
            sql`EXISTS (
              SELECT 1 FROM ${opportunities}
              WHERE ${opportunities.id} = ${schema.tasks.metadata}->>'opportunityId'
                AND ${opportunities.status} IN ('accepted', 'rejected', 'expired')
            )`,
          ),
          and(
            eq(schema.tasks.state, 'paused'),
            inArray(sql`${schema.tasks.metadata}->'pause'->>'reason'`, ['needs_principal', 'counterparty_silent']),
            lt(schema.tasks.updatedAt, workingCutoff),
          ),
          and(
            eq(schema.tasks.state, 'paused'),
            sql`${schema.tasks.metadata}->'pause'->>'reason' = 'ready_for_verdict'`,
          ),
          and(
            eq(schema.tasks.state, 'completed'),
            sql`${schema.tasks.metadata}->>'watchdogReflectPending' = 'true'`,
          ),
        ),
      ))
      .orderBy(
        asc(sql`coalesce(${schema.tasks.metadata}->>'watchdogRecoveryCheckedAt', '')`),
        asc(schema.tasks.createdAt),
      )
      .limit(Math.max(1, Math.floor(limit)));

    return rows.map((row) => ({
      ...row,
      state: row.state as 'submitted' | 'working' | 'paused' | 'completed',
      metadata: (row.metadata as Record<string, unknown> | null) ?? null,
    }));
  }

  /**
   * Stamps `metadata.watchdogAttempts` on a stale task, CAS-guarded by the
   * watchdog's own read of `updatedAt` — the sweep only counts an
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
   * Moves a durable recovery check behind never-checked rows, so one bounded
   * sweep cannot starve newer candidates indefinitely.
   * `updatedAt` deliberately stays unchanged: this is watchdog bookkeeping,
   * not a negotiation lifecycle transition.
   */
  async recordNegotiationWatchdogRecoveryCheck(input: {
    taskId: string;
    expectedUpdatedAt: Date;
    checkedAt: Date;
  }): Promise<boolean> {
    const [task] = await db
      .update(schema.tasks)
      .set({
        metadata: sql`jsonb_set(
          coalesce(${schema.tasks.metadata}, '{}'::jsonb),
          '{watchdogRecoveryCheckedAt}',
          ${JSON.stringify(input.checkedAt.toISOString())}::jsonb,
          true
        )`,
      })
      .where(and(
        eq(schema.tasks.id, input.taskId),
        eq(schema.tasks.updatedAt, input.expectedUpdatedAt),
      ))
      .returning({ id: schema.tasks.id });
    return Boolean(task);
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
  ): Promise<Task> {
    return db.transaction(async (tx) => {
      const [task] = await tx.update(schema.tasks).set({
        state: state as typeof schema.taskStateEnum.enumValues[number],
        statusMessage: statusMessage ?? null,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
      }).where(eq(schema.tasks.id, taskId)).returning();
      if (!task) throw new Error(`Task ${taskId} not found`);
      return task;
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
  }): Promise<Artifact> {
    return db.transaction(async (tx) => {
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
   * The intent-scoped operator view. It deliberately projects task state and
   * only the latest shared A2A turn: a seat's brief, intent and private pause
   * payload never leave the graph boundary through this read.
   */
  async getIntentCycleForIntent(userId: string, intentId: string): Promise<{
    batch: { id: string | null; active: number; paused: number };
    negotiations: Array<{
      taskId: string;
      conversationId: string;
      opportunityId: string;
      opportunityStatus: string;
      counterpartLabel: string;
      batchId: string | null;
      state: string;
      pause: { reason: NegotiationPauseReason; by: 'yours' | 'theirs' | null } | null;
      latestActivity: { actor: 'yours' | 'theirs'; verb: string | null; text: string | null; createdAt: Date } | null;
      updatedAt: Date;
    }> } | null> {
    const [ownedIntent] = await db
      .select({
        id: schema.intents.id,
        batchId: schema.intents.negotiationBatchId,
      })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    if (!ownedIntent) return null;

    const taskRows = await db
      .select({
        id: schema.tasks.id,
        conversationId: schema.tasks.conversationId,
        state: schema.tasks.state,
        metadata: schema.tasks.metadata,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        sql`${schema.tasks.metadata}->'seats' ? ${intentId}`,
        notArchivedNegotiationTaskWhere(),
        rewriteEraNegotiationTaskWhere(),
      ));

    const tasks = taskRows.flatMap((row) => {
      const metadata = row.metadata as NegotiationTaskMetadataMirror;
      const seat = metadata?.seats?.[intentId];
      if (!metadata?.opportunityId || !seat) return [];
      return [{ ...row, metadata, seat }];
    });
    const opportunityIds = [...new Set(tasks.map((task) => task.metadata.opportunityId))];
    const opportunityRows = opportunityIds.length === 0 ? [] : await db
      .select({ id: schema.opportunities.id, status: schema.opportunities.status, actors: schema.opportunities.actors })
      .from(schema.opportunities)
      .where(inArray(schema.opportunities.id, opportunityIds));
    const opportunityById = new Map(opportunityRows.map((row) => [row.id, row]));

    const counterpartIds = [...new Set(opportunityRows.flatMap((row) =>
      row.actors.filter((actor) => actor.userId !== userId).map((actor) => actor.userId),
    ))];
    const counterpartRows = counterpartIds.length === 0 ? [] : await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, counterpartIds));
    const counterpartById = new Map(counterpartRows.map((row) => [row.id, row]));

    const messageRows = tasks.length === 0 ? [] : await db
      .select({ taskId: schema.messages.taskId, senderId: schema.messages.senderId, parts: schema.messages.parts, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, tasks.map((task) => task.id)))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id));
    const latestByTask = new Map<string, typeof messageRows[number]>();
    for (const message of messageRows) {
      if (message.taskId && !latestByTask.has(message.taskId)) latestByTask.set(message.taskId, message);
    }

    const negotiations = tasks.flatMap((task) => {
      const opportunity = opportunityById.get(task.metadata.opportunityId);
      if (!opportunity) return [];
      const counterpartId = opportunity.actors.find((actor) => actor.userId !== userId)?.userId;
      const latest = latestByTask.get(task.id);
      const latestTurn = latest ? intentCycleLatestActivity(latest.parts as unknown[], latest.senderId, userId, latest.createdAt) : null;
      const pausedBy = task.metadata.pause?.pausedBy;
      const pauseReason = intentCyclePauseReason(task.metadata.pause?.reason);
      const pauseBy: 'yours' | 'theirs' | null = pausedBy
        ? (pausedBy === userId ? 'yours' : 'theirs')
        : null;
      return [{
        taskId: task.id,
        conversationId: task.conversationId,
        opportunityId: opportunity.id,
        opportunityStatus: opportunity.status,
        counterpartLabel: counterpartById.get(counterpartId ?? '')?.name?.trim() || 'Unknown counterpart',
        batchId: task.seat.batchId,
        state: task.state,
        pause: pauseReason
          ? { reason: pauseReason, by: pauseBy }
          : null,
        latestActivity: latestTurn,
        updatedAt: task.updatedAt,
      }];
    }).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.taskId.localeCompare(right.taskId));

    const currentBatch = negotiations.filter((negotiation) => negotiation.batchId === ownedIntent.batchId);
    return {
      batch: {
        id: ownedIntent.batchId,
        active: currentBatch.filter((negotiation) => negotiation.state === 'submitted' || negotiation.state === 'working').length,
        paused: currentBatch.filter((negotiation) => negotiation.state === 'paused').length,
      },
      negotiations,
    };
  }

  /** Every negotiation seat bound to this owner, one row per intent/task. */
  async getNegotiationTaskIndex(userId: string): Promise<Array<{
    intentId: string;
    intentLabel: string;
    taskId: string;
    conversationId: string;
    opportunityId: string;
    opportunityStatus: string;
    counterpartLabel: string;
    batchId: string | null;
    state: string;
    pause: { reason: NegotiationPauseReason; by: 'yours' | 'theirs' | null } | null;
    latestActivity: { actor: 'yours' | 'theirs'; verb: string | null; createdAt: Date | null };
    updatedAt: Date;
  }>> {
    const taskRows = await db
      .select({
        id: schema.tasks.id,
        conversationId: schema.tasks.conversationId,
        state: schema.tasks.state,
        metadata: schema.tasks.metadata,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        sql`exists (select 1 from jsonb_each(${schema.tasks.metadata}->'seats') as seat where seat.value->>'userId' = ${userId})`,
        notArchivedNegotiationTaskWhere(),
        rewriteEraNegotiationTaskWhere(),
      ));
    const seats = taskRows.flatMap((task) => {
      const metadata = task.metadata as NegotiationTaskMetadataMirror;
      if (!metadata?.opportunityId) return [];
      return Object.entries(metadata.seats ?? {})
        .filter(([, seat]) => seat.userId === userId)
        .map(([intentId, seat]) => ({ ...task, metadata, intentId, seat }));
    });
    const intentIds = [...new Set(seats.map((seat) => seat.intentId))];
    const intentRows = intentIds.length === 0 ? [] : await db
      .select({ id: schema.intents.id, payload: schema.intents.payload, summary: schema.intents.summary })
      .from(schema.intents)
      .where(and(eq(schema.intents.userId, userId), inArray(schema.intents.id, intentIds)));
    const intentById = new Map(intentRows.map((intent) => [intent.id, intent]));

    const opportunityIds = [...new Set(seats.map((seat) => seat.metadata.opportunityId))];
    const opportunityRows = opportunityIds.length === 0 ? [] : await db
      .select({ id: schema.opportunities.id, status: schema.opportunities.status, actors: schema.opportunities.actors })
      .from(schema.opportunities)
      .where(inArray(schema.opportunities.id, opportunityIds));
    const opportunityById = new Map(opportunityRows.map((opportunity) => [opportunity.id, opportunity]));
    const counterpartIds = [...new Set(opportunityRows.flatMap((opportunity) =>
      opportunity.actors.filter((actor) => actor.userId !== userId).map((actor) => actor.userId),
    ))];
    const counterpartRows = counterpartIds.length === 0 ? [] : await db
      .select({ id: schema.users.id, name: schema.users.name })
      .from(schema.users)
      .where(inArray(schema.users.id, counterpartIds));
    const counterpartById = new Map(counterpartRows.map((counterpart) => [counterpart.id, counterpart]));

    const messageRows = seats.length === 0 ? [] : await db
      .select({ taskId: schema.messages.taskId, senderId: schema.messages.senderId, parts: schema.messages.parts, createdAt: schema.messages.createdAt })
      .from(schema.messages)
      .where(inArray(schema.messages.taskId, [...new Set(seats.map((seat) => seat.id))]))
      .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id));
    const latestByTask = new Map<string, typeof messageRows[number]>();
    for (const message of messageRows) {
      if (message.taskId && !latestByTask.has(message.taskId)) latestByTask.set(message.taskId, message);
    }

    return seats.flatMap((seat) => {
      const intent = intentById.get(seat.intentId);
      const opportunity = opportunityById.get(seat.metadata.opportunityId);
      if (!intent || !opportunity) return [];
      const counterpartId = opportunity.actors.find((actor) => actor.userId !== userId)?.userId;
      const pausedBy = seat.metadata.pause?.pausedBy;
      const pauseReason = intentCyclePauseReason(seat.metadata.pause?.reason);
      const pauseBy: 'yours' | 'theirs' | null = pausedBy
        ? (pausedBy === userId ? 'yours' : 'theirs')
        : null;
      const latest = latestByTask.get(seat.id);
      const latestActivity = latest ? intentCycleLatestActivity(latest.parts as unknown[], latest.senderId, userId, latest.createdAt) : null;
      return [{
        intentId: intent.id,
        intentLabel: intent.summary?.trim() || intent.payload,
        taskId: seat.id,
        conversationId: seat.conversationId,
        opportunityId: opportunity.id,
        opportunityStatus: opportunity.status,
        counterpartLabel: counterpartById.get(counterpartId ?? '')?.name?.trim() || 'Unknown counterpart',
        batchId: seat.seat.batchId,
        state: seat.state,
        pause: pauseReason
          ? { reason: pauseReason, by: pauseBy }
          : null,
        latestActivity: latestActivity
          ? { actor: latestActivity.actor, verb: latestActivity.verb, createdAt: latestActivity.createdAt }
          : { actor: 'yours' as const, verb: null, createdAt: null },
        updatedAt: seat.updatedAt,
      }];
    }).sort((left, right) => right.updatedAt.getTime() - left.updatedAt.getTime() || left.taskId.localeCompare(right.taskId));
  }

  /**
   * Recent durable IS-A effects. The ledger is append-only and records the
   * event that woke the agent with each effect it actually executed; it does
   * not claim a strategy/reflect phase where no corresponding act exists.
   */
  async getIntentCycleTimelineForIntent(userId: string, intentId: string): Promise<Array<{
    id: string;
    event: Record<string, unknown>;
    act: Record<string, unknown>;
    createdAt: Date;
  }> | null> {
    const [ownedIntent] = await db
      .select({ id: schema.intents.id })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    if (!ownedIntent) return null;

    const rows = await db
      .select({
        id: schema.intentAgentActs.id,
        event: schema.intentAgentActs.event,
        act: schema.intentAgentActs.act,
        createdAt: schema.intentAgentActs.createdAt,
      })
      .from(schema.intentAgentActs)
      .where(and(eq(schema.intentAgentActs.userId, userId), eq(schema.intentAgentActs.intentId, intentId)))
      .orderBy(desc(schema.intentAgentActs.createdAt), desc(schema.intentAgentActs.id))
      .limit(100);
    return rows.reverse().map((row) => ({
      id: row.id,
      event: row.event ?? {},
      act: row.act ?? {},
      createdAt: row.createdAt,
    }));
  }

  /** The owner-only detail read behind the cycle inspector's task rows. */
  async getIntentCycleNegotiationForIntent(userId: string, intentId: string, taskId: string): Promise<{
    intent: { id: string; payload: string };
    task: {
      id: string;
      conversationId: string;
      opportunityId: string;
      batchId: string | null;
      state: string;
      brief: string | null;
      updatedAt: Date;
      pause: { reason: NegotiationPauseReason; by: 'yours' | 'theirs' | null; payload?: unknown } | null;
    };
    transcript: Array<{
      id: string;
      actor: 'yours' | 'theirs';
      verb: string | null;
      pause: { reason: NegotiationPauseReason; payload?: unknown } | null;
      text: string | null;
      createdAt: Date;
    }>;
    outcome: { verdict: 'pending' | 'reject'; reasoning: string | null } | null;
  } | null> {
    const [intent] = await db
      .select({ id: schema.intents.id, payload: schema.intents.payload })
      .from(schema.intents)
      .where(and(eq(schema.intents.id, intentId), eq(schema.intents.userId, userId)))
      .limit(1);
    if (!intent) return null;

    const [task] = await db
      .select({
        id: schema.tasks.id,
        conversationId: schema.tasks.conversationId,
        state: schema.tasks.state,
        briefs: schema.tasks.briefs,
        metadata: schema.tasks.metadata,
        updatedAt: schema.tasks.updatedAt,
      })
      .from(schema.tasks)
      .where(and(
        eq(schema.tasks.id, taskId),
        sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
        sql`${schema.tasks.metadata}->'seats' ? ${intentId}`,
        notArchivedNegotiationTaskWhere(),
        rewriteEraNegotiationTaskWhere(),
      ))
      .limit(1);
    if (!task) return null;
    const metadata = task.metadata as NegotiationTaskMetadataMirror;
    const seat = metadata.seats?.[intentId];
    if (!seat || seat.userId !== userId || !metadata.opportunityId) return null;

    const [messageRows, artifactRows] = await Promise.all([
      db.select({ id: schema.messages.id, senderId: schema.messages.senderId, parts: schema.messages.parts, createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(eq(schema.messages.taskId, task.id))
        .orderBy(asc(schema.messages.createdAt), asc(schema.messages.id)),
      db.select({ name: schema.artifacts.name, parts: schema.artifacts.parts, metadata: schema.artifacts.metadata })
        .from(schema.artifacts)
        .where(eq(schema.artifacts.taskId, task.id))
        .orderBy(schema.artifacts.createdAt),
    ]);
    const taskPause = metadata.pause ?? null;
    const pausedBy = taskPause?.pausedBy;
    const pauseReason = intentCyclePauseReason(taskPause?.reason);
    const pauseBy: 'yours' | 'theirs' | null = pausedBy
      ? (pausedBy === userId ? 'yours' : 'theirs')
      : null;
    const pause = pauseReason
      ? {
          reason: pauseReason,
          by: pauseBy,
          ...(pauseBy === 'yours' && taskPause?.payload !== undefined ? { payload: taskPause.payload } : {}),
        }
      : null;

    return {
      intent,
      task: {
        id: task.id,
        conversationId: task.conversationId,
        opportunityId: metadata.opportunityId,
        batchId: seat.batchId,
        state: task.state,
        updatedAt: task.updatedAt,
        brief: typeof (task.briefs as Record<string, unknown> | null)?.[userId] === 'string'
          ? (task.briefs as Record<string, string>)[userId]
          : null,
        pause,
      },
      transcript: messageRows.map((message) => intentCycleTranscriptTurn(message, userId)),
      outcome: intentCycleOwnOutcome(artifactRows, userId),
    };
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
  // own `conversations` row (never pair-shared), and its own messages.
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

  /**
   * The graph's open write boundary. The transaction-scoped opportunity lock
   * makes a concurrent/retried opener observe the task the winner inserted.
   * The disposition says whether that task was already observed by this
   * caller, so a real re-kick can take a turn while a race loser cannot author
   * a second opening turn.
   */
  async openNegotiationTask(input: {
    opportunityId: string;
    sourceUserId: string;
    candidateUserId: string;
    brief: string;
    seats: Record<string, { userId: string; batchId: string | null }>;
    networkId: string;
    knownTaskId?: string;
  }): Promise<{ task: NegotiationTaskRowMirror; disposition: 'created' | 'existing' | 'raced' } | null> {
    const opened = await db.transaction(async (tx) => {
      await acquireNegotiationAttemptLock(tx, input.opportunityId);

      const [opportunity] = await tx
        .select({ status: opportunities.status, actors: opportunities.actors })
        .from(opportunities)
        .where(eq(opportunities.id, input.opportunityId))
        .for('update');
      if (!opportunity || !NEGOTIATION_OPEN_STATUSES.has(opportunity.status)) return null;

      const actors = opportunity.actors;
      if (
        !actors.some((actor) => actor.userId === input.sourceUserId && actor.networkId === input.networkId)
        || !actors.some((actor) => actor.userId === input.candidateUserId)
        || !Object.values(input.seats).some((seat) => seat.userId === input.sourceUserId)
        || !Object.values(input.seats).some((seat) => seat.userId === input.candidateUserId)
      ) return null;

      const [existing] = await tx
        .select()
        .from(schema.tasks)
        .where(and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${input.opportunityId}`,
          ne(schema.tasks.state, 'completed'),
          notArchivedNegotiationTaskWhere(),
          rewriteEraNegotiationTaskWhere(),
        ))
        .orderBy(desc(schema.tasks.createdAt))
        .limit(1);
      if (existing) {
        const disposition: 'existing' | 'raced' = existing.id === input.knownTaskId ? 'existing' : 'raced';
        return {
          task: toNegotiationTaskRow(existing),
          disposition,
        };
      }

      const conversationId = crypto.randomUUID();
      const now = new Date();
      await tx.insert(schema.conversations).values({ id: conversationId, createdAt: now, updatedAt: now });
      await tx.insert(schema.conversationParticipants).values([
        { conversationId, participantId: input.sourceUserId, participantType: 'agent' },
        { conversationId, participantId: input.candidateUserId, participantType: 'agent' },
      ]);
      const [task] = await tx.insert(schema.tasks).values({
        conversationId,
        state: 'working',
        briefs: { [input.sourceUserId]: input.brief },
        metadata: {
          type: 'negotiation',
          opportunityId: input.opportunityId,
          sourceUserId: input.sourceUserId,
          candidateUserId: input.candidateUserId,
          initiatorUserId: input.sourceUserId,
          networkId: input.networkId,
          seats: input.seats,
        },
      }).returning();
      if (!task) throw new Error('Failed to create negotiation task');

      if (opportunity.status !== 'negotiating') {
        await tx.update(opportunities)
          .set({ status: 'negotiating', updatedAt: now })
          .where(eq(opportunities.id, input.opportunityId));
      }
      return { task: toNegotiationTaskRow(task), disposition: 'created' as const };
    });
    // The old graph path called updateOpportunityStatus after creating its
    // task. Keep its committed lifecycle/transition emission without moving a
    // non-atomic status write back outside this transaction.
    if (opened?.disposition === 'created') {
      emitOpportunityLifecycleBestEffort({ id: input.opportunityId, status: 'negotiating' });
      emitOpportunityTransitionBestEffort({ id: input.opportunityId, status: 'negotiating' });
    }
    return opened;
  }

  /**
   * The one open (non-completed) rewrite-era negotiation task for an
   * opportunity, if any. A pre-rewrite row never qualifies, so kickoff opens
   * a fresh task for the opportunity instead of resuming an orphan.
   */
  async getNegotiationTaskForOpportunity(
    opportunityId: string,
    options?: { includeCompleted?: boolean },
  ): Promise<NegotiationTaskRowMirror | null> {
    const [row] = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->>'opportunityId' = ${opportunityId}`,
          ...(options?.includeCompleted ? [] : [ne(schema.tasks.state, 'completed')]),
          notArchivedNegotiationTaskWhere(),
          rewriteEraNegotiationTaskWhere(),
        ),
      )
      .orderBy(desc(schema.tasks.createdAt))
      .limit(1);
    if (!row) return null;
    return toNegotiationTaskRow(row);
  }

  /**
   * A rewrite-era negotiation task by id. Pre-rewrite rows read back as null:
   * this is the graph's only entry for read, resume, turn, pause, and verdict,
   * so an orphaned legacy row is inert to the whole lifecycle.
   */
  async getNegotiationTask(taskId: string): Promise<NegotiationTaskRowMirror | null> {
    const [row] = await db
      .select()
      .from(schema.tasks)
      .where(and(eq(schema.tasks.id, taskId), rewriteEraNegotiationTaskWhere()))
      .limit(1);
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
          notArchivedNegotiationTaskWhere(),
          // Pre-rewrite rows are inert: the graph reads them back as null, so
          // listing them would offer a negotiation that errors when opened.
          rewriteEraNegotiationTaskWhere(),
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
  /**
   * A single-statement jsonb_set, not a read-then-write: the old
   * select-metadata-then-spread-then-update shape had a lost-update race
   * between any two concurrent callers (a pause clear racing a round stamp,
   * a watchdog attempt racing a resume — whichever wrote second silently
   * discarded the other's change). jsonb_set merges the one key server-side,
   * so two concurrent callers touching different keys both land.
   */
  async updateNegotiationTaskState(
    taskId: string,
    state: 'working' | 'paused' | 'completed',
    pause?: NegotiationTaskMetadataMirror['pause'],
  ): Promise<NegotiationTaskRowMirror> {
    const [row] = await db
      .update(schema.tasks)
      .set({
        state,
        ...(state === 'working' ? {
          metadata: sql`jsonb_set(coalesce(${schema.tasks.metadata}, '{}'::jsonb), '{pause}', 'null'::jsonb, true)`,
        } : pause !== undefined ? {
          metadata: sql`jsonb_set(coalesce(${schema.tasks.metadata}, '{}'::jsonb), '{pause}', ${JSON.stringify(pause ?? null)}::jsonb, true)`,
        } : {}),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();
    if (!row) throw new Error(`Negotiation task ${taskId} not found`);
    return toNegotiationTaskRow(row);
  }

  async completeNegotiation(input: {
    taskId: string;
  } & (
    | {
      kind: 'pause_verdict' | 'owner_verdict';
      verdict: 'pending' | 'reject';
      reasoning?: string;
      resolvedByUserId: string;
    }
    | { kind: 'opportunity_expired' }
  )): Promise<NegotiationTaskRowMirror | null> {
    const result = await db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).for('update');
      if (!task || task.state === 'completed') return null;

      const metadata = task.metadata as NegotiationTaskMetadataMirror | null;
      if (!metadata || metadata.type !== 'negotiation') return null;
      if (input.kind !== 'opportunity_expired') {
        const isSeat = Object.values(metadata.seats).some((seat) => seat.userId === input.resolvedByUserId)
          || metadata.sourceUserId === input.resolvedByUserId
          || metadata.candidateUserId === input.resolvedByUserId;
        if (!isSeat) return null;
        if (input.kind === 'pause_verdict' && (
          task.state !== 'paused'
          || metadata.pause?.reason !== 'ready_for_verdict'
          || metadata.pause.pausedBy !== input.resolvedByUserId
        )) return null;
      }

      const [opportunity] = await tx.select({ status: opportunities.status }).from(opportunities)
        .where(eq(opportunities.id, metadata.opportunityId)).for('update');
      if (!opportunity) return null;
      const terminal = ['accepted', 'rejected', 'expired'].includes(opportunity.status);
      if (input.kind === 'owner_verdict' && !terminal) return null;
      if (input.kind === 'opportunity_expired' && opportunity.status !== 'expired') return null;

      if (input.kind !== 'opportunity_expired') {
        await tx.insert(schema.artifacts).values({
          taskId: task.id,
          name: 'negotiation_outcome',
          parts: [{ kind: 'data', data: {
            verdict: input.verdict,
            reasoning: input.reasoning,
            resolvedByUserId: input.resolvedByUserId,
          } }],
          metadata: { resolvedByUserId: input.resolvedByUserId },
        });
      }
      const now = new Date();
      const [completed] = await tx.update(schema.tasks)
        .set({
          state: 'completed',
          metadata: sql`jsonb_set(
            coalesce(${schema.tasks.metadata}, '{}'::jsonb),
            '{watchdogReflectPending}',
            'true'::jsonb,
            true
          )`,
          updatedAt: now,
        })
        .where(eq(schema.tasks.id, task.id))
        .returning();
      if (!completed) throw new Error(`Negotiation task ${task.id} not found`);

      let opportunityUpdatedTo: 'pending' | 'rejected' | null = null;
      if (input.kind === 'pause_verdict' && !terminal) {
        opportunityUpdatedTo = input.verdict === 'pending' ? 'pending' : 'rejected';
        await tx.update(opportunities)
          .set({ status: opportunityUpdatedTo, acceptedBy: null, updatedAt: now })
          .where(eq(opportunities.id, metadata.opportunityId));
      }
      return { task: toNegotiationTaskRow(completed), opportunityUpdatedTo };
    });

    if (result?.opportunityUpdatedTo) {
      const event = { id: result.task.metadata.opportunityId, status: result.opportunityUpdatedTo };
      emitOpportunityLifecycleBestEffort(event);
      emitOpportunityTransitionBestEffort(event);
    }
    return result?.task ?? null;
  }

  async clearNegotiationReflectPending(taskId: string): Promise<void> {
    await db.update(schema.tasks)
      .set({
        metadata: sql`jsonb_set(
          coalesce(${schema.tasks.metadata}, '{}'::jsonb),
          '{watchdogReflectPending}',
          'false'::jsonb,
          true
        )`,
      })
      .where(eq(schema.tasks.id, taskId));
  }

  async expirePausedNegotiation(input: {
    taskId: string;
    expectedUpdatedAt: Date;
    reason: 'counterparty_silent' | 'needs_principal';
  }): Promise<NegotiationTaskRowMirror | null> {
    const result = await db.transaction(async (tx) => {
      const [task] = await tx.select().from(schema.tasks)
        .where(eq(schema.tasks.id, input.taskId)).for('update');
      if (
        !task
        || task.state !== 'paused'
        || task.updatedAt.getTime() !== input.expectedUpdatedAt.getTime()
        || (task.metadata as NegotiationTaskMetadataMirror | null)?.pause?.reason !== input.reason
      ) return null;

      const metadata = task.metadata as NegotiationTaskMetadataMirror;
      const [opportunity] = await tx.select({ status: opportunities.status }).from(opportunities)
        .where(eq(opportunities.id, metadata.opportunityId)).for('update');
      if (!opportunity) return null;

      const now = new Date();
      const [completed] = await tx.update(schema.tasks).set({ state: 'completed', updatedAt: now })
        .where(eq(schema.tasks.id, task.id)).returning();
      if (!completed) throw new Error(`Negotiation task ${task.id} not found`);
      const opportunityExpired = !['accepted', 'rejected', 'expired'].includes(opportunity.status);
      if (opportunityExpired) {
        await tx.update(opportunities).set({ status: 'expired', updatedAt: now })
          .where(eq(opportunities.id, metadata.opportunityId));
      }
      return { task: toNegotiationTaskRow(completed), opportunityExpired };
    });
    if (result?.opportunityExpired) {
      emitOpportunityLifecycleBestEffort({ id: result.task.metadata.opportunityId, status: 'expired' });
      emitOpportunityTransitionBestEffort({ id: result.task.metadata.opportunityId, status: 'expired' });
    }
    if (result) {
      await Promise.all(Object.entries(result.task.metadata.seats).map(async ([intentId, seat]) => {
        try {
          await publishIntentInvalidationEvent({ userId: seat.userId, intentId });
        } catch (error) {
          logger.error('Failed to publish negotiation expiry intent invalidation', {
            taskId: result.task.id,
            intentId,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }));
    }
    return result?.task ?? null;
  }

  /**
   * Writes ONE seat's brief. A single-statement `jsonb_set`, like
   * `setNegotiationRound`: read-modify-write would let two seats authoring at
   * once clobber each other's, which is the whole property this column has.
   */
  async setNegotiationBrief(taskId: string, userId: string, brief: string): Promise<void> {
    await db.update(schema.tasks).set({
      briefs: sql`jsonb_set(coalesce(${schema.tasks.briefs}, '{}'::jsonb), ARRAY[${userId}], ${JSON.stringify(brief)}::jsonb, true)`,
      updatedAt: new Date(),
    }).where(eq(schema.tasks.id, taskId));
  }

  /**
   * Binds ONE seat's signal and round, leaving every other seat's untouched.
   * Single-statement `jsonb_set` for the same reason `setNegotiationBrief` is:
   * both sides write here, and a read-modify-write would let one seat's
   * kickoff clobber the other's binding — the very thing per-seat exists to
   * make impossible.
   */
  async bindNegotiationSeat(taskId: string, intentId: string, binding: { userId: string; batchId: string | null }): Promise<void> {
    await db.update(schema.tasks).set({
      metadata: sql`jsonb_set(
        jsonb_set(coalesce(${schema.tasks.metadata}, '{}'::jsonb), '{seats}', coalesce(${schema.tasks.metadata}->'seats', '{}'::jsonb), true),
        ARRAY['seats', ${intentId}],
        ${JSON.stringify(binding)}::jsonb,
        true
      )`,
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

  /**
   * Every PAUSED, unresolved negotiation of one signal, whatever round it
   * belongs to. Deliberately not round-scoped: a negotiation a later kickoff
   * left behind keeps its old round, and a round-scoped read would hide it
   * from every future verdict.
   */
  async getPausedNegotiationTasksForIntent(intentId: string): Promise<NegotiationTaskRowMirror[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->'seats' ? ${intentId}`,
          eq(schema.tasks.state, 'paused'),
          notArchivedNegotiationTaskWhere(),
          rewriteEraNegotiationTaskWhere(),
        ),
      )
      .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));
    return rows.map((row) => toNegotiationTaskRow(row));
  }

  /**
   * Opens a new round: bumps the counter, clears the size stamp and marks the
   * kickoff as begun, in ONE write. Only kickoff bumps a round, so the bump is
   * the beginning of a kickoff and there is no window in which a crash could
   * leave a round begun-but-unmarked.
   */
  async bumpIntentNegotiationBatch(intentId: string): Promise<{ batchId: string }> {
    const batchId = crypto.randomUUID();
    await db
      .update(schema.intents)
      .set({ negotiationBatchId: batchId })
      .where(eq(schema.intents.id, intentId));
    return { batchId };
  }

  /**
   * The intent's current kickoff batch id, or null if no kickoff has ever run
   * for this signal (including every intent that predates this column).
   */
  async getIntentNegotiationBatch(intentId: string): Promise<{ batchId: string | null }> {
    const [row] = await db
      .select({ batchId: schema.intents.negotiationBatchId })
      .from(schema.intents)
      .where(eq(schema.intents.id, intentId));
    return { batchId: row?.batchId ?? null };
  }

  /**
   * Signals whose current batch began but never finished settling — a
   * kickoff that was interrupted (crash, restart) before it could append its
   * `opening_complete` round-log marker. A batch with no events at all yet
   * (crashed before its first `opened` event landed) is excluded: there is no
   * event timestamp to judge staleness by, and that window is narrow (opens
   * follow the bump within the same turn). `runKickoff`'s own
   * `interruptedBatch` repair already knows how to settle these; it just
   * needs a fresh wake to run it, which is what this list is for.
   */
  async getIntentsWithInterruptedKickoff(staleBeforeMs: number): Promise<Array<{ id: string; userId: string }>> {
    const cutoff = new Date(Date.now() - staleBeforeMs);
    const result = await db.execute(sql`
      SELECT i.id, i.user_id AS "userId"
      FROM intents i
      WHERE i.status = 'ACTIVE'
        AND i.negotiation_batch_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1 FROM negotiation_round_log_events e
          WHERE e.intent_id = i.id AND e.batch_id = i.negotiation_batch_id AND e.kind = 'opening_complete'
        )
        AND EXISTS (
          SELECT 1 FROM negotiation_round_log_events e2
          WHERE e2.intent_id = i.id AND e2.batch_id = i.negotiation_batch_id
          HAVING max(e2.created_at) < ${cutoff}
        )
    `);
    return result as unknown as Array<{ id: string; userId: string }>;
  }

  /**
   * Every negotiation task of one intent's batch, whatever its state — what
   * reflect reads. The `batchId` key is also the rewrite-era predicate: a
   * pre-rewrite task has no `batchId` in its metadata and can never match.
   */
  async getNegotiationTasksForIntentBatch(intentId: string, batchId: string): Promise<NegotiationTaskRowMirror[]> {
    const rows = await db
      .select()
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->'seats'->${intentId}->>'batchId' = ${batchId}`,
          notArchivedNegotiationTaskWhere(),
        ),
      )
      .orderBy(asc(schema.tasks.createdAt), asc(schema.tasks.id));
    return rows.map((row) => toNegotiationTaskRow(row));
  }

  /** Count of this intent's batch-`batchId` negotiations not yet `paused` or `completed`. */
  async countActiveNegotiationsForBatch(intentId: string, batchId: string): Promise<number> {
    const [row] = await db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
          sql`${schema.tasks.metadata}->'seats'->${intentId}->>'batchId' = ${batchId}`,
          notInArray(schema.tasks.state, ['paused', 'completed']),
          // The same predicate `getNegotiationTasksForIntentBatch` applies:
          // an archived task stuck in an active state would hold this count above
          // zero forever, stalling the signal's cycle, while being invisible
          // in the paused set the agent actually reasons over.
          notArchivedNegotiationTaskWhere(),
        ),
      );
    return row?.value ?? 0;
  }

  /**
   * Looks up every negotiation task attached to an opportunity, ordered from
   * oldest to newest.
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
        // Task attribution keeps negotiation turns scoped to their task.
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
          ? and(isNull(schema.artifacts.id), inArray(schema.tasks.state, ['submitted', 'working', 'paused']))
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

    // Thread pagination must see every task segment before grouping.
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
          scopeType: PERSONAL_INTENT_SCOPE_TYPE,
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
    opts: { excludeIntentPinned?: boolean } = {},
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
          // Intent-pinned sessions (a signal's DM) are reached through their
          // signal; the home history list never shows them.
          ...(opts.excludeIntentPinned
            ? [notInArray(schema.conversations.id, intentPinnedConversationIds(userId))]
            : []),
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
   * @param opts - Set excludeIntentPinned to keep a signal's DM out of the listing
   * @returns Array of chat session summaries
   */
  async listChatSessionSummaries(
    userId: string,
    limit = 25,
    persona: string,
    opts: { excludeIntentPinned?: boolean } = {},
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
          eq(schema.conversations.persona, persona),
          // A signal's DM belongs to its signal surface, never to a generic
          // session listing.
          ...(opts.excludeIntentPinned
            ? [notInArray(schema.conversations.id, intentPinnedConversationIds(userId))]
            : []),
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
   * @param persona - Exact persona the caller may read
   * @param opts - Set excludeIntentPinned to refuse a signal's DM transcript
   * @returns Session detail or null
   */
  async getChatSessionDetail(
    userId: string,
    sessionId: string,
    messageLimit = 50,
    persona: string,
    opts: { excludeIntentPinned?: boolean } = {},
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

    // Fetch conversation row. A signal's DM is read through its signal
    // surface; generic detail readers must not expose its transcript.
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
        ...(opts.excludeIntentPinned
          ? [notInArray(schema.conversations.id, intentPinnedConversationIds(userId))]
          : []),
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
   * The canonical DM's conversation id for (user, intent) — one indexed
   * registry select, no session rehydration. The guards that ask "is this
   * session THE DM?" compare against this.
   */
  async getPersonalIntentConversationId(userId: string, intentId: string): Promise<string | null> {
    const normalizedIntentId = intentId.trim();
    if (!normalizedIntentId) return null;
    const [row] = await db
      .select({ conversationId: schema.chatSessionScopes.conversationId })
      .from(schema.chatSessionScopes)
      .where(
        and(
          eq(schema.chatSessionScopes.userId, userId),
          eq(schema.chatSessionScopes.scopeType, PERSONAL_INTENT_SCOPE_TYPE),
          eq(schema.chatSessionScopes.scopeId, normalizedIntentId),
        ),
      )
      .limit(1);
    return row?.conversationId ?? null;
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
          eq(schema.chatSessionScopes.scopeType, PERSONAL_INTENT_SCOPE_TYPE),
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
   * registry row is keyed ('personal-intent', intentId) and the
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
        persona: PERSONAL_AGENT_PERSONA,
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
        scopeType: PERSONAL_INTENT_SCOPE_TYPE,
        scopeId: intentId,
        createdAt: now,
        updatedAt: now,
      });
    });
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
    if (data.questions?.length) msgMeta.decisionQuestions = data.questions;

    const message = await this.insertMessageWithConversationSession({
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

    // Chat-session writers include background A2H replies. Publish only after
    // their durable write, using stored participants as the privacy boundary.
    try {
      await publishConversationMessageEvent(message, await this.getParticipants(data.sessionId));
    } catch (error) {
      logger.error('Failed to publish chat-session SSE event', {
        conversationId: data.sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
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
        decisionQuestions: Array.isArray(meta.decisionQuestions) ? meta.decisionQuestions : null,
        decisionQuestionsSubmitted: meta.decisionQuestionsSubmitted ?? null,
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
   * Records an explicit principal submission for structured questions.  This
   * deliberately lives on the question message rather than being inferred
   * from later transcript traffic: background agent updates are not answers.
   */
  async markDecisionQuestionsSubmitted(
    conversationId: string,
    messageIds: string[],
  ): Promise<boolean> {
    const uniqueIds = [...new Set(messageIds)];
    if (uniqueIds.length === 0) return false;

    return db.transaction(async (tx) => {
      const rows = await tx
        .select({ id: schema.messages.id, role: schema.messages.role, metadata: schema.messages.metadata })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.conversationId, conversationId),
          inArray(schema.messages.id, uniqueIds),
        ))
        .for('update');

      if (rows.length !== uniqueIds.length) return false;

      const updates = rows.map((row) => {
        const metadata = (row.metadata ?? {}) as ChatMessageMeta;
        if (
          row.role !== 'agent'
          || !Array.isArray(metadata.decisionQuestions)
          || metadata.decisionQuestions.length === 0
          || metadata.decisionQuestionsSubmitted
        ) return null;
        return { id: row.id, metadata: { ...metadata, decisionQuestionsSubmitted: true } };
      });
      if (updates.some((update) => update === null)) return false;

      for (const update of updates) {
        await tx
          .update(schema.messages)
          .set({ metadata: update!.metadata })
          .where(eq(schema.messages.id, update!.id));
      }
      return true;
    });
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
    status: 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<{ id: string; status: 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' } | null> {
    if (status === 'accepted' && !acceptedBy) throw new Error('acceptedBy is required when status is accepted');
    const row = await db.transaction(async (tx) => {
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
