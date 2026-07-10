import { readUserContext, schema, Artifact, ChatConversationMeta, ChatMessage, ChatMessageMeta, ChatScopeType, ChatSession, Conversation, ConversationParticipant, ConversationSummary, CreateMessageInput, CreateSessionInput, Message, ResolvedParticipant, SYSTEM_AGENT_ID, Task, and, asc, count, db, desc, eq, gt, inArray, isNull, lt, ne, opportunities, or, sql } from './database.shared';

/**
 * Persona value for the user's negotiator DM session (P4.1 / IND-402).
 * Mirrors `NEGOTIATOR_PERSONA_ID` in @indexnetwork/protocol; kept as a local
 * literal so the data layer does not import the protocol package.
 */
const NEGOTIATOR_PERSONA = 'negotiator';

/**
 * Stable-session registry key for the negotiator DM in `chat_session_scopes`.
 * The table's `(user_id, scope_type, scope_id)` unique index is what makes
 * get-or-create race-safe. `scope_type='persona'` is deliberately outside the
 * `ChatScopeType` ('network' | 'intent') envelope: `_normalizeScopeType`
 * ignores it, so the negotiator session presents as an unscoped chat session.
 */
const NEGOTIATOR_SCOPE = { scopeType: 'persona', scopeId: NEGOTIATOR_PERSONA } as const;

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

    return { id, dmPair: null, persona: 'orchestrator', lastMessageAt: null, createdAt: now, updatedAt: now };
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
   * @param userId - The user whose conversations to list
   * @returns Summaries with participant lists
   */
  async getConversationsForUser(userId: string): Promise<ConversationSummary[]> {
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
          eq(schema.conversationParticipants.participantId, userId),
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

    const convs = await db
      .select()
      .from(schema.conversations)
      .where(inArray(schema.conversations.id, ids))
      .orderBy(sql`${schema.conversations.lastMessageAt} DESC NULLS LAST`);

    const allParticipants = await db
      .select()
      .from(schema.conversationParticipants)
      .where(inArray(schema.conversationParticipants.conversationId, ids));

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

    // Resolve the system negotiator agent name (used as the fallback label when no
    // personal agent drove any turn on a user's side). Well-known UUID from
    // agent.database.adapter.ts SYSTEM_AGENT_IDS.negotiator.
    let systemNegotiatorName = 'Index Negotiator';
    const negotiatorRow = await db
      .select({ name: schema.agents.name })
      .from(schema.agents)
      .where(eq(schema.agents.id, '00000000-0000-0000-0000-000000000002'))
      .limit(1);
    if (negotiatorRow.length > 0) {
      systemNegotiatorName = negotiatorRow[0].name;
    }

    // Resolve the *actual* agent that drove each user's side. For polling-backed turns,
    // tasks.claimed_by_agent_id is set to the personal agent that picked the turn up.
    // Fall back to the system negotiator when no claim exists (sync system-driven turns).
    // Map: conversationId → (ownerUserId → agent { id, name, avatar })
    const claimedAgentByConv = new Map<string, Map<string, { name: string; avatar: string | null }>>();
    if (ids.length > 0) {
      const claimRows = await db
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
        // Deterministic ordering so that if a conversation ever has claims
        // from multiple external (poller) agents for the same owner, the displayed
        // agent name is stable across requests. Most recent claim wins.
        .orderBy(desc(schema.tasks.claimedAt), asc(schema.agents.id));
      for (const r of claimRows) {
        if (!r.ownerId) continue;
        const convMap = claimedAgentByConv.get(r.conversationId) ?? new Map();
        // First row wins after deterministic ordering — most recent claim per owner.
        if (!convMap.has(r.ownerId)) {
          convMap.set(r.ownerId, { name: r.agentName, avatar: r.avatar });
        }
        claimedAgentByConv.set(r.conversationId, convMap);
      }
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

    // Fetch last message per conversation efficiently using DISTINCT ON
    const lastMessageByConv = new Map<string, { parts: unknown[]; senderId: string; createdAt: Date }>();
    if (ids.length > 0) {
      const lastMessages = await db
        .selectDistinctOn([schema.messages.conversationId], {
          conversationId: schema.messages.conversationId,
          parts: schema.messages.parts,
          senderId: schema.messages.senderId,
          createdAt: schema.messages.createdAt,
        })
        .from(schema.messages)
        .where(inArray(schema.messages.conversationId, ids))
        .orderBy(schema.messages.conversationId, desc(schema.messages.createdAt));

      for (const r of lastMessages) {
        const hiddenAt = hiddenAtByConv.get(r.conversationId);
        if (hiddenAt && r.createdAt <= hiddenAt) continue;
        lastMessageByConv.set(r.conversationId, {
          parts: r.parts as unknown[],
          senderId: r.senderId,
          createdAt: r.createdAt,
        });
      }
    }

    // Fetch metadata per conversation
    const allMeta = ids.length > 0
      ? await db
          .select()
          .from(schema.conversationMetadata)
          .where(inArray(schema.conversationMetadata.conversationId, ids))
      : [];

    const metaByConv = new Map<string, Record<string, unknown>>();
    for (const m of allMeta) {
      metaByConv.set(m.conversationId, m.metadata as Record<string, unknown>);
    }

    return convs.map((c) => ({
      ...c,
      participants: participantsByConv.get(c.id) ?? [],
      lastMessage: lastMessageByConv.get(c.id) ?? null,
      metadata: metaByConv.get(c.id) ?? null,
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

    return { id, dmPair, persona: 'orchestrator', lastMessageAt: null, createdAt: now, updatedAt: now };
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
   * Creates a message and updates the conversation's lastMessageAt.
   * @param data - Message payload
   * @returns The inserted message row
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
    const id = crypto.randomUUID();

    const [msg] = await db
      .insert(schema.messages)
      .values({
        id,
        conversationId: data.conversationId,
        senderId: data.senderId,
        role: data.role,
        parts: data.parts,
        taskId: data.taskId ?? null,
        metadata: data.metadata ?? null,
        extensions: data.extensions ?? null,
        referenceTaskIds: data.referenceTaskIds ?? null,
      })
      .returning();

    await this.updateLastMessageAt(data.conversationId);

    // Clear hiddenAt for the sender so conversation reappears in their list
    await db
      .update(schema.conversationParticipants)
      .set({ hiddenAt: null })
      .where(and(
        eq(schema.conversationParticipants.conversationId, data.conversationId),
        eq(schema.conversationParticipants.participantId, data.senderId),
      ));

    return msg;
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
        .select({ createdAt: schema.messages.createdAt })
        .from(schema.messages)
        .where(and(
          eq(schema.messages.id, opts.before),
          eq(schema.messages.conversationId, conversationId),
        ))
        .limit(1);

      if (ref) {
        conditions.push(lt(schema.messages.createdAt, ref.createdAt));
      }
    }

    // Query newest messages first (DESC), then reverse for chronological order.
    // This ensures limit returns the LATEST N messages, not the oldest.
    let query = db
      .select()
      .from(schema.messages)
      .where(and(...conditions))
      .orderBy(desc(schema.messages.createdAt));

    if (opts?.limit) {
      query = query.limit(opts.limit) as typeof query;
    }

    const rows = await query;
    return rows.reverse();
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
   * Hides a conversation for a specific user by setting hiddenAt.
   * @param userId - The user hiding the conversation
   * @param conversationId - Conversation ID
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

  // ─────────────────────────────────────────────────────────────────────────
  // Users (for ghost invite emails)
  // ─────────────────────────────────────────────────────────────────────────

  /**
   * Looks up a user by ID.
   * @param userId - User ID
   * @returns Core user fields, or null if not found
   */
  async getUser(userId: string): Promise<{ id: string; name: string | null; email: string | null; isGhost: boolean; deletedAt: Date | null } | null> {
    const [row] = await db
      .select({
        id: schema.users.id,
        name: schema.users.name,
        email: schema.users.email,
        isGhost: schema.users.isGhost,
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
   * Transitions a task to a new state.
   * @param taskId - Task ID
   * @param state - New task state
   * @param statusMessage - Optional status message payload
   * @returns The updated task
   * @throws If the task is not found
   */
  async updateTaskState(taskId: string, state: string, statusMessage?: unknown): Promise<Task> {
    const [task] = await db
      .update(schema.tasks)
      .set({
        state: state as typeof schema.taskStateEnum.enumValues[number],
        statusMessage: statusMessage ?? null,
        statusTimestamp: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId))
      .returning();

    if (!task) throw new Error(`Task ${taskId} not found`);
    return task;
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
  async setTaskTurnContext(taskId: string, turnContext: Record<string, unknown>): Promise<void> {
    await db
      .update(schema.tasks)
      .set({
        metadata: sql`COALESCE(${schema.tasks.metadata}, '{}'::jsonb) || jsonb_build_object('turnContext', ${JSON.stringify(turnContext)}::jsonb)`,
        updatedAt: new Date(),
      })
      .where(eq(schema.tasks.id, taskId));
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
    const [artifact] = await db
      .insert(schema.artifacts)
      .values({
        taskId: data.taskId,
        name: data.name ?? null,
        description: data.description ?? null,
        parts: data.parts,
        metadata: data.metadata ?? null,
      })
      .returning();

    return artifact;
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
  }>> {
    const rows = await db
      .select({
        id: schema.messages.id,
        senderId: schema.messages.senderId,
        role: schema.messages.role,
        parts: schema.messages.parts,
        createdAt: schema.messages.createdAt,
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
    opts?: { limit?: number; offset?: number; mutualWithUserId?: string; result?: 'has_opportunity' | 'no_opportunity' | 'in_progress'; since?: Date },
  ): Promise<Array<Task & { artifact: Artifact | null }>> {
    const limit = opts?.limit ?? 10;
    const offset = opts?.offset ?? 0;

    const userFilter = opts?.mutualWithUserId
      ? and(
          sql`${schema.tasks.metadata}->>'type' = 'negotiation'`,
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

    const allFilters = [userFilter, resultFilter, sinceFilter].filter(Boolean);
    const combinedFilter = allFilters.length > 1 ? and(...allFilters) : allFilters[0];

    const rows = await db
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
      .orderBy(desc(schema.tasks.createdAt))
      .limit(limit)
      .offset(offset);

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
        ...(data.persona ? { persona: data.persona } : {}),
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
          scopeType: normalizedScopeType,
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
   * Get all chat sessions for a user, ordered by most recent.
   * Queries conversation_participants to find conversations with system-agent.
   */
  async getUserChatSessions(
    userId: string,
    limit: number,
    persona?: string,
    excludePersona?: string,
  ): Promise<ChatSession[]> {
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
          ...(persona ? [eq(schema.conversations.persona, persona)] : []),
          ...(excludePersona ? [ne(schema.conversations.persona, excludePersona)] : []),
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
   * @returns Array of chat session summaries
   */
  async listChatSessionSummaries(
    userId: string,
    limit = 25,
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
          // The negotiator DM is a private persona surface — keep it out of
          // generic chat-history summaries (MCP listSessions, chat summary).
          ne(schema.conversations.persona, NEGOTIATOR_PERSONA),
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
      .where(eq(schema.conversations.id, sessionId))
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
   * Find the user's stable negotiator DM session, if provisioned.
   */
  async getNegotiatorChatSession(userId: string): Promise<ChatSession | null> {
    const [row] = await db
      .select({ conversationId: schema.chatSessionScopes.conversationId })
      .from(schema.chatSessionScopes)
      .where(
        and(
          eq(schema.chatSessionScopes.userId, userId),
          eq(schema.chatSessionScopes.scopeType, NEGOTIATOR_SCOPE.scopeType),
          eq(schema.chatSessionScopes.scopeId, NEGOTIATOR_SCOPE.scopeId),
        ),
      )
      .limit(1);
    return row ? this.getChatSession(row.conversationId) : null;
  }

  /**
   * Create the user's stable negotiator DM session (one per user).
   *
   * Same transaction shape as {@link createChatSession} (conversation +
   * user/system-agent participants + title metadata) plus the
   * `chat_session_scopes` registry row whose unique index guarantees at most
   * one negotiator session per user — concurrent creates lose with a 23505
   * unique violation the caller resolves by re-reading.
   */
  async createNegotiatorChatSession(data: { id: string; userId: string; title?: string }): Promise<void> {
    const now = new Date();
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

      if (data.title) {
        await tx.insert(schema.conversationMetadata).values({
          conversationId: data.id,
          metadata: { title: data.title } satisfies ChatConversationMeta,
        });
      }

      await tx.insert(schema.chatSessionScopes).values({
        conversationId: data.id,
        userId: data.userId,
        scopeType: NEGOTIATOR_SCOPE.scopeType,
        scopeId: NEGOTIATOR_SCOPE.scopeId,
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
            eq(schema.chatSessionScopes.scopeType, scopeType),
            eq(schema.chatSessionScopes.scopeId, normalizedScopeId),
          ),
        )
        .limit(1);
      return row ? this.getChatSession(row.conversationId) : null;
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
      if (session?.userId === userId) return session;
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
        scopeType,
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

    await db.insert(schema.messages).values({
      id: data.id,
      conversationId: data.sessionId,
      senderId,
      role: isAgent ? 'agent' : 'user',
      parts: [{ type: 'text', text: data.content }],
      metadata: Object.keys(msgMeta).length > 0 ? msgMeta : null,
      createdAt: new Date(),
    });

    // Update conversation.lastMessageAt
    await db
      .update(schema.conversations)
      .set({ lastMessageAt: new Date() })
      .where(eq(schema.conversations.id, data.sessionId));
  }

  /**
   * Get chat messages for a session, reconstructing the backward-compatible ChatMessage shape.
   */
  async getChatSessionMessages(sessionId: string, limit?: number): Promise<ChatMessage[]> {
    const query = db.select()
      .from(schema.messages)
      .where(eq(schema.messages.conversationId, sessionId))
      .orderBy(asc(schema.messages.createdAt));

    const rows = limit ? await query.limit(limit) : await query;

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
  async getChatMessageMetadataByIds(messageIds: string[]): Promise<Array<{ id: string; messageId: string; traceEvents: unknown; debugMeta: unknown; streamingDrafts: unknown; createdAt: Date }>> {
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
  ): Promise<{ id: string; status: 'latent' | 'draft' | 'negotiating' | 'pending' | 'stalled' | 'accepted' | 'rejected' | 'expired' } | null> {
    if (status === 'accepted' && !acceptedBy) {
      throw new Error('acceptedBy is required when status is accepted');
    }
    const updates: Record<string, unknown> = { status, updatedAt: new Date() };
    if (status === 'accepted') {
      updates.acceptedBy = acceptedBy;
    } else {
      updates.acceptedBy = null;
    }
    const [row] = await db
      .update(opportunities)
      .set(updates)
      .where(eq(opportunities.id, id))
      .returning({ id: opportunities.id, status: opportunities.status });
    return row ?? null;
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
