import { conversationDatabaseAdapter, ConversationDatabaseAdapter } from '../adapters/database.adapter';

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
    opts?: { limit?: number; offset?: number; mutualWithUserId?: string; result?: 'has_opportunity' | 'no_opportunity' | 'in_progress' },
  ) {
    return this.db.getNegotiationsByUser(userId, opts);
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
