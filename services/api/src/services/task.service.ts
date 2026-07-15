import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

type NegotiationResult = 'has_opportunity' | 'no_opportunity' | 'in_progress';
type NegotiationRow = Awaited<ReturnType<ConversationDatabaseAdapter['getNegotiationsByUser']>>[number];
type NegotiationOutcomePart = { kind?: string; data?: { hasOpportunity?: boolean; consensus?: boolean; reason?: string } };

/** A negotiation's newest task plus every task segment in that opportunity thread. */
export interface NegotiationThread {
  current: NegotiationRow;
  segmentRows: NegotiationRow[];
}

function getOpportunityId(row: NegotiationRow): string | null {
  const opportunityId = (row.metadata as { opportunityId?: unknown } | null)?.opportunityId;
  return typeof opportunityId === 'string' && opportunityId.trim() ? opportunityId.trim() : null;
}

function getOutcomeData(row: NegotiationRow): NegotiationOutcomePart['data'] | undefined {
  return (row.artifact?.parts as NegotiationOutcomePart[] | null)?.find((part) => part.kind === 'data')?.data;
}

function isScreenedOut(row: NegotiationRow): boolean {
  return getOutcomeData(row)?.reason === 'screened_out';
}

function matchesResult(row: NegotiationRow, result: NegotiationResult | undefined): boolean {
  if (!result) return true;
  const outcome = getOutcomeData(row);
  if (result === 'has_opportunity') {
    return outcome?.hasOpportunity === true || outcome?.consensus === true;
  }
  if (result === 'no_opportunity') {
    return outcome?.hasOpportunity === false || outcome?.consensus === false;
  }
  return !row.artifact && ['submitted', 'working', 'input_required'].includes(row.state);
}

function newestFirst(a: NegotiationRow, b: NegotiationRow): number {
  return b.createdAt.getTime() - a.createdAt.getTime()
    || b.updatedAt.getTime() - a.updatedAt.getTime()
    || b.id.localeCompare(a.id);
}

/**
 * Manages A2A task lifecycle and artifact creation.
 * @remarks Delegates all persistence to ConversationDatabaseAdapter. Does not call other services.
 */
export class TaskService {
  constructor(private db: ConversationDatabaseAdapter = conversationDatabaseAdapter) {}

  /**
   * Creates a task in the 'submitted' state for a given conversation.
   * @param conversationId - Conversation the task belongs to
   * @param metadata - Optional task metadata
   * @returns The newly created task
   */
  async createTask(conversationId: string, metadata?: Record<string, unknown>) {
    return this.db.createTask(conversationId, metadata);
  }

  /**
   * Transitions a task to a new state.
   * @param taskId - Task ID
   * @param state - New task state
   * @param statusMessage - Optional status message payload
   * @returns The updated task
   * @throws If the task is not found
   */
  async updateState(taskId: string, state: string, statusMessage?: unknown) {
    return this.db.updateTaskState(taskId, state, statusMessage);
  }

  /**
   * Retrieves a task by ID, verifying it belongs to the given conversation.
   * @param taskId - Task ID
   * @param conversationId - Conversation the task must belong to
   * @returns The task, or null if not found
   * @throws If the task exists but belongs to a different conversation
   */
  async getTask(taskId: string, conversationId: string) {
    const task = await this.db.getTask(taskId);
    if (task && task.conversationId !== conversationId) {
      throw new Error('Forbidden: task does not belong to this conversation');
    }
    return task;
  }

  /**
   * Lists all tasks for a conversation, ordered by creation time.
   * @param conversationId - Conversation ID
   * @returns Ordered list of tasks
   */
  async getTasksByConversation(conversationId: string) {
    return this.db.getTasksByConversation(conversationId);
  }

  /**
   * Creates an artifact linked to a task.
   * @param taskId - Task ID
   * @param data - Artifact payload (name, description, parts, metadata)
   * @returns The newly created artifact
   */
  async createArtifact(
    taskId: string,
    data: { name?: string; description?: string; parts: unknown[]; metadata?: Record<string, unknown> },
  ) {
    return this.db.createArtifact({ taskId, ...data });
  }

  /**
   * Lists all artifacts for a task, verifying the task belongs to the given conversation.
   * @param taskId - Task ID
   * @param conversationId - Conversation the task must belong to
   * @returns Ordered list of artifacts
   * @throws If the task does not exist or belongs to a different conversation
   */
  async getArtifacts(taskId: string, conversationId: string) {
    const task = await this.db.getTask(taskId);
    if (!task || task.conversationId !== conversationId) {
      throw new Error('Forbidden: task does not belong to this conversation');
    }
    return this.db.getArtifacts(taskId);
  }

  /**
   * Retrieves negotiation tasks for a user, with outcome artifacts.
   * @param userId - User to find negotiations for
   * @param opts - Optional limit, offset, and mutual-only filter
   * @returns Tasks with joined outcome artifacts
   */
  async getNegotiationsByUser(
    userId: string,
    opts?: { limit?: number; offset?: number; mutualWithUserId?: string; result?: NegotiationResult; since?: Date },
  ) {
    return this.db.getNegotiationsByUser(userId, opts);
  }

  /**
   * Retrieves and paginates complete negotiation threads for a user.
   *
   * Pagination is applied after every matching task has been grouped by
   * opportunity id (or task id when absent), so an arbitrarily long
   * continuation chain cannot be split across pages. Filters are evaluated
   * against the newest segment, which defines the thread's current state.
   * @param userId - User to find negotiation threads for
   * @param opts - Thread limit, offset, mutual-only filter, current result, and current-segment lower bound
   * @returns Complete threads ordered by newest segment first
   */
  async getNegotiationThreadsByUser(
    userId: string,
    opts?: { limit?: number; offset?: number; mutualWithUserId?: string; result?: NegotiationResult; since?: Date },
  ): Promise<NegotiationThread[]> {
    const rows = await this.db.getNegotiationsByUser(userId, {
      mutualWithUserId: opts?.mutualWithUserId,
      unpaginated: true,
      includeScreenedOut: true,
    });
    const grouped = new Map<string, NegotiationRow[]>();

    for (const row of rows) {
      const opportunityId = getOpportunityId(row);
      // Namespace both key types so a fallback task id cannot collide with an
      // unrelated opportunity id (both are UUID-shaped in production).
      const key = opportunityId ? `opportunity:${opportunityId}` : `task:${row.id}`;
      const segmentRows = grouped.get(key) ?? [];
      segmentRows.push(row);
      grouped.set(key, segmentRows);
    }

    const threads = [...grouped.values()]
      .map((segmentRows) => {
        segmentRows.sort(newestFirst);
        return { current: segmentRows[0], segmentRows };
      })
      .filter((thread) => !opts?.mutualWithUserId || !isScreenedOut(thread.current))
      .filter((thread) => matchesResult(thread.current, opts?.result))
      .filter((thread) => !opts?.since || thread.current.createdAt >= opts.since)
      .sort((a, b) => newestFirst(a.current, b.current));

    const offset = opts?.offset ?? 0;
    const limit = opts?.limit ?? 10;
    return threads.slice(offset, offset + limit);
  }

  /**
   * Retrieves messages for multiple tasks in a single query.
   * @param taskIds - Task IDs to fetch messages for
   * @returns Map of taskId to ordered messages
   */
  async getMessagesByTaskIds(taskIds: string[]) {
    return this.db.getMessagesByTaskIds(taskIds);
  }
}
