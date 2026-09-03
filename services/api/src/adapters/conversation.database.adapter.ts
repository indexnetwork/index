import { buildProfileFromUser, schema, ChatConversationMeta, ChatMessage, ChatMessageMeta, ChatScopeType, ChatSession, Conversation, ConversationParticipant, ConversationSession, ConversationSummary, CreateMessageInput, CreateSessionInput, Message, ResolvedParticipant, SYSTEM_AGENT_ID, and, asc, count, db, desc, eq, gt, inArray, intents, isNull, lt, ne, opportunities, or, sql, toOpportunityRow, type OpportunityRow } from './database.shared';
import { emitOpportunityLifecycleBestEffort, emitOpportunityTransitionBestEffort } from '../events/opportunity.event';
import { publishConversationMessageEvent } from '../lib/conversation-events';
import { log } from '../lib/log';

const logger = log.lib.from('conversation-database');

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
    return { id: userId, text, embedding: [] as number[], generatedAt: new Date() };
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
   * @returns Summaries with participant lists
   */
  async getConversationsForUser(
    participantId: string,
    viewerUserId = participantId,
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
    // sidebar's critical path (GET /conversations).
    const [
      convs,
      allParticipants,
      negotiatorRow,
      lastMessages,
      allMeta,
      unreadRows,
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

    const participantsByConv = new Map<string, ResolvedParticipant[]>();
    for (const p of allParticipants) {
      const list = participantsByConv.get(p.conversationId) ?? [];
      if (p.participantType === 'agent' && p.participantId.startsWith('agent:')) {
        const ownerId = p.participantId.slice('agent:'.length);
        const ownerInfo = userMap.get(ownerId);
        list.push({
          participantId: p.participantId,
          participantType: p.participantType,
          name: systemNegotiatorName,
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


    return convs.map((c) => ({
      ...c,
      participants: participantsByConv.get(c.id) ?? [],
      lastMessage: lastMessageByConv.get(c.id) ?? null,
      metadata: metaByConv.get(c.id) ?? null,
      via: viaByConv.get(c.id) ?? [],
      unreadCount: unreadCountByConv.get(c.id) ?? 0,
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
   * The owner's single agent DM, created on first use.
   *
   * One conversation per owner, not one per signal: an untagged message is how
   * the owner says something that holds for every signal, which only works if
   * they all share a thread. `dm_pair` is unique, so a concurrent first use
   * loses the insert and re-reads the winner.
   *
   * @param userId - The owner.
   * @returns Their agent DM.
   */
  async getOrCreateAgentDm(userId: string): Promise<Conversation> {
    const dmPair = `agent-dm:${userId}`;

    const [existing] = await db
      .select()
      .from(schema.conversations)
      .where(eq(schema.conversations.dmPair, dmPair))
      .limit(1);
    if (existing) return existing;

    try {
      return await this.createConversationWithDmPair(
        [
          { participantId: userId, participantType: 'user' },
          { participantId: SYSTEM_AGENT_ID, participantType: 'agent' },
        ],
        dmPair,
      );
    } catch (err: unknown) {
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
   * Deletes a conversation (cascades to participants, sessions, messages).
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
    metadata?: Record<string, unknown> | null;
    extensions?: string[];
  }): Promise<Message> {
    const message = await this.insertMessageWithConversationSession({
      id: crypto.randomUUID(),
      conversationId: data.conversationId,
      senderId: data.senderId,
      role: data.role,
      parts: data.parts,
      metadata: data.metadata ?? null,
      extensions: data.extensions ?? null,
    });

    // All message writers converge here. Publish only after persistence, and
    // only to authenticated owners represented by the stored participant rows.
    try {
      const senderUserId = data.senderId.startsWith('agent:')
        ? data.senderId.slice('agent:'.length)
        : data.senderId;
      // The owner's agent has no `users` row, so it needs its name spelled out;
      // this is what the agent DM notification is titled with.
      const [sender] = senderUserId === SYSTEM_AGENT_ID ? [] : await db
        .select({ name: schema.users.name, avatar: schema.users.avatar })
        .from(schema.users)
        .where(eq(schema.users.id, senderUserId))
        .limit(1);
      const senderName = senderUserId === SYSTEM_AGENT_ID ? 'Your agent' : sender?.name?.trim();
      await publishConversationMessageEvent(
        {
          ...message,
          ...(senderName ? { senderName } : {}),
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
   * Persist a message under the durable session selected for the
   * conversation's activity window.
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
    metadata: Record<string, unknown> | null;
    extensions: string[] | null;
  }): Promise<Message> {
    return db.transaction(async (tx) => {
      await tx.execute(sql`
        SELECT pg_advisory_xact_lock(
          hashtextextended(${`conversation-session:${data.conversationId}`}, 0)
        )
      `);

      const now = new Date();
      let sessionId: string;

      const [currentSession] = await tx
        .select()
        .from(schema.conversationSessions)
        .where(eq(schema.conversationSessions.conversationId, data.conversationId))
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
   * Retrieves messages for a conversation, ordered by creation time ascending.
   * @param conversationId - Conversation ID
   * @param opts - Optional limit, cursor (before), or intent filter
   * @returns Ordered list of messages
   */
  async getMessages(
    conversationId: string,
    opts?: { limit?: number; before?: string; userId?: string; intentId?: string },
  ): Promise<Message[]> {
    const conditions = [eq(schema.messages.conversationId, conversationId)];

    // The agent DM is one conversation carrying every signal's questions, so a
    // message belongs to the signal it is tagged with and to no other.
    if (opts?.intentId) {
      conditions.push(sql`${schema.messages.metadata}->>'intentId' = ${opts.intentId}`);
    }

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
   * @param opts - Visibility and prior-session cursor constraints.
   * @returns Exactly one session (when present), its messages, and whether an earlier session exists.
   */
  async getConversationSessionHistory(
    conversationId: string,
    opts?: { beforeSessionId?: string; userId?: string },
  ): Promise<{
    session: ConversationSession | null;
    messages: Message[];
    hasPreviousSession: boolean;
  }> {
    const conditions = [eq(schema.conversationSessions.conversationId, conversationId)];
    if (opts?.beforeSessionId) {
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
        return { session: null, messages: [], hasPreviousSession: false };
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
    if (!session) return { session: null, messages: [], hasPreviousSession: false };

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
    const previousSessionCondition = or(
      lt(schema.conversationSessions.startedAt, session.startedAt),
      and(
        eq(schema.conversationSessions.startedAt, session.startedAt),
        lt(schema.conversationSessions.id, session.id),
      ),
    );
    if (previousSessionCondition) previousConditions.push(previousSessionCondition);
    const [previous] = await db
      .select({ id: schema.conversationSessions.id })
      .from(schema.conversationSessions)
      .where(and(...previousConditions))
      .limit(1);

    return { session, messages, hasPreviousSession: Boolean(previous) };
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
   * @param persona - Exact persona the caller may read
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
   * Update chat session network scope.
   */
  async updateChatSessionIndex(sessionId: string, networkId: string | null): Promise<void> {
    await this._upsertConvMeta(sessionId, {
      networkId,
      scopeType: networkId ? 'network' : null,
      scopeId: networkId,
    });
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
      metadata: Object.keys(msgMeta).length > 0 ? msgMeta : null,
      extensions: null,
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
   * to advance the opportunity lifecycle (negotiating → pending/rejected).
   * @param id - Opportunity ID
   * @param status - New status
   * @returns The updated opportunity id+status, or null if not found
   */
  async updateOpportunityStatus(
    id: string,
    status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired',
    acceptedBy?: string,
  ): Promise<{ id: string; status: 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired' } | null> {
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
