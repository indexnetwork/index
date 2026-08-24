/**
 * In-memory host implementing the exact `NegotiationGraphDatabase` port both
 * the NegotiationGraph and the PersonalAgent read and write through.
 *
 * Deliberately provider-free and dependency-free: the e2e specs that use it
 * run in the credential-free CI gate, driving the REAL compiled graphs
 * against this fake rather than mocking the graphs themselves.
 */
import type { NegotiationGraphDatabase, NegotiationTaskRow } from "../../../platform/database/negotiation.js";

export const NETWORK_ID = "network-1";
export const SOURCE_USER_ID = "alice";
export const CANDIDATE_USER_ID = "bob";
export const INTENT_ID = "intent-alice-1";
export const OPPORTUNITY_ID = "opportunity-1";

export interface FakeOpportunity {
  id: string;
  status: string;
  actors: Array<{ userId: string; intent: string; networkId: string; role: string; approved?: boolean }>;
}

export interface FakeMessage {
  id: string;
  senderId: string;
  parts: unknown[];
  createdAt: Date;
}

export class FakeNegotiationHost {
  /** The intent's round lifecycle, exactly as the three columns behave. */
  round = 1;
  roundSize: number | null = null;
  kickoffStartedAt: Date | null = null;
  readonly opportunities = new Map<string, FakeOpportunity>();
  readonly tasks = new Map<string, NegotiationTaskRow>();
  readonly messages = new Map<string, FakeMessage[]>();
  readonly opportunityStatusUpdates: Array<{ id: string; status: string }> = [];
  readonly outcomeArtifacts = new Map<string, { verdict: 'pending' | 'reject'; reasoning?: string; resolvedByUserId: string }>();
  /** Deduped by (intent, round), exactly as the deterministic BullMQ job id does. */
  readonly reflectJobs: Array<{ userId: string; intentId: string; round: number }> = [];
  private taskCounter = 0;
  private messageCounter = 0;

  constructor(counterpartyUserIds: string[] = [CANDIDATE_USER_ID]) {
    counterpartyUserIds.forEach((userId, index) => {
      const id = index === 0 ? OPPORTUNITY_ID : `opportunity-${index + 1}`;
      this.opportunities.set(id, {
        id,
        status: "latent",
        actors: [
          { userId: SOURCE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID, role: "peer" },
          { userId, intent: `intent-${userId}-1`, networkId: NETWORK_ID, role: "peer" },
        ],
      });
    });
  }

  /** The first (and, for the single-opportunity specs, only) opportunity. */
  get opportunity(): FakeOpportunity {
    return this.opportunities.get(OPPORTUNITY_ID)!;
  }

  async createNegotiationTask(input: {
    conversationId: string;
    briefs: Record<string, string>;
    metadata: NegotiationTaskRow['metadata'];
  }): Promise<NegotiationTaskRow> {
    const task: NegotiationTaskRow = {
      id: `task-${++this.taskCounter}`,
      conversationId: input.conversationId,
      state: 'working',
      briefs: { ...input.briefs },
      metadata: input.metadata,
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(task.id, task);
    this.messages.set(task.id, []);
    return task;
  }

  readonly database: NegotiationGraphDatabase = {
    getOpportunity: async (id: string) => (this.opportunities.get(id) as never) ?? null,
    getIntent: async (intentId: string) => {
      const actor = [...this.opportunities.values()]
        .flatMap((opportunity) => opportunity.actors)
        .find((candidate) => candidate.intent === intentId);
      return actor ? ({ id: intentId, userId: actor.userId, payload: `${actor.userId} wants a suitable match.` } as never) : null;
    },
    getUserContext: async () => null as never,
    openNegotiationTask: async (input) => {
      const existing = [...this.tasks.values()].find((task) =>
        task.metadata.opportunityId === input.opportunityId && task.state !== 'completed');
      if (existing) {
        return {
          task: existing,
          disposition: existing.id === input.knownTaskId ? 'existing' : 'raced',
        };
      }
      const opportunity = this.opportunities.get(input.opportunityId);
      if (
        !opportunity
        || opportunity.status === 'pending'
        || ['accepted', 'rejected', 'expired'].includes(opportunity.status)
        || opportunity.actors.some((actor) => actor.role === 'introducer' && actor.approved !== true)
      ) return null;
      const task: NegotiationTaskRow = {
        id: `task-${++this.taskCounter}`,
        conversationId: `conversation-${this.tasks.size + 1}`,
        state: 'working',
        briefs: { [input.sourceUserId]: input.brief },
        metadata: {
          type: 'negotiation',
          opportunityId: input.opportunityId,
          sourceUserId: input.sourceUserId,
          candidateUserId: input.candidateUserId,
          initiatorUserId: input.sourceUserId,
          networkId: input.networkId,
          seats: { [input.intentId]: { userId: input.sourceUserId, round: input.round } },
        },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      this.tasks.set(task.id, task);
      this.messages.set(task.id, []);
      if (opportunity.status !== 'negotiating') {
        this.opportunityStatusUpdates.push({ id: input.opportunityId, status: 'negotiating' });
        opportunity.status = 'negotiating';
      }
      return { task, disposition: 'created' };
    },
    getNegotiationTaskForOpportunity: async (opportunityId) =>
      [...this.tasks.values()].find((t) => t.metadata.opportunityId === opportunityId && t.state !== "completed") ?? null,
    getNegotiationTask: async (taskId) => this.tasks.get(taskId) ?? null,
    getNegotiationTasksForUser: async (userId) =>
      [...this.tasks.values()].filter((t) => t.metadata.sourceUserId === userId || t.metadata.candidateUserId === userId),
    updateNegotiationTaskState: async (taskId, state, pause) => {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error(`No such task ${taskId}`);
      const updated: NegotiationTaskRow = {
        ...task,
        state,
        metadata: { ...task.metadata, pause: pause ?? null },
        updatedAt: new Date(),
      };
      this.tasks.set(taskId, updated);
      return updated;
    },
    // Per SEAT: writing one must never clobber the other's.
    setNegotiationBrief: async (taskId, userId, brief) => {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error(`No such task ${taskId}`);
      this.tasks.set(taskId, { ...task, briefs: { ...task.briefs, [userId]: brief }, updatedAt: new Date() });
    },
    // Per SEAT: binding one must never disturb the other's.
    bindNegotiationSeat: async (taskId, intentId, binding) => {
      const task = this.tasks.get(taskId);
      if (!task) throw new Error(`No such task ${taskId}`);
      this.tasks.set(taskId, {
        ...task,
        metadata: { ...task.metadata, seats: { ...task.metadata.seats, [intentId]: binding } },
        updatedAt: new Date(),
      });
    },
    createNegotiationMessage: async (input) => {
      const list = this.messages.get(input.taskId) ?? [];
      if (list.length !== input.expectedMessageCount) return null; // fenced: a concurrent turn already landed
      const message = { id: `message-${++this.messageCounter}`, senderId: input.senderId, parts: input.parts, createdAt: new Date() };
      list.push(message);
      this.messages.set(input.taskId, list);
      return message;
    },
    // A snapshot, not the live array — a real DB read would never see a later write reflected back.
    getNegotiationMessages: async (taskId) => [...(this.messages.get(taskId) ?? [])],
    createNegotiationOutcomeArtifact: async (taskId, outcome) => {
      this.outcomeArtifacts.set(taskId, outcome);
    },
    getArtifactsForTask: async () => [],
    updateOpportunityStatus: async (id, status) => {
      this.opportunityStatusUpdates.push({ id, status });
      const opportunity = this.opportunities.get(id);
      if (opportunity) opportunity.status = status;
      return { id, status };
    },
    getNegotiationTasksForIntentRound: async (intentId, round) =>
      [...this.tasks.values()].filter((t) => t.metadata.seats[intentId]?.round === round),
    // Signal-scoped on purpose: a negotiation a later round left behind must
    // stay visible, or it can never be promoted or rejected.
    getPausedNegotiationTasksForIntent: async (intentId) =>
      [...this.tasks.values()].filter((t) => intentId in t.metadata.seats && t.state === "paused"),
    // One write: the bump clears the stamp AND marks the kickoff as begun.
    bumpIntentNegotiationRound: async () => {
      this.roundSize = null;
      this.kickoffStartedAt = new Date();
      return (this.round += 1);
    },
    getIntentNegotiationRound: async () => ({
      round: this.round,
      roundSize: this.roundSize,
      kickoffStartedAt: this.kickoffStartedAt,
    }),
    stampIntentNegotiationRoundSize: async (_intentId, round, size) => {
      if (round === this.round) this.roundSize = size;
    },
    countActiveNegotiationsForRound: async (intentId, round) =>
      [...this.tasks.values()].filter((t) =>
        t.metadata.seats[intentId]?.round === round && t.state === "working").length,
  };

  /**
   * Push the kickoff marker past the staleness bound, so a later turn reads
   * the round as abandoned rather than in flight (D20).
   */
  ageKickoff(byMs = 11 * 60 * 1000): void {
    if (this.kickoffStartedAt) this.kickoffStartedAt = new Date(this.kickoffStartedAt.getTime() - byMs);
  }

  /** Records a reflect job the way the queue does: once per (intent, round). */
  enqueueReflect(job: { userId: string; intentId: string; round: number }): void {
    if (this.reflectJobs.some((existing) => existing.intentId === job.intentId && existing.round === job.round)) return;
    this.reflectJobs.push(job);
  }

  taskFor(negotiationId: string): NegotiationTaskRow {
    const task = this.tasks.get(negotiationId);
    if (!task) throw new Error(`No such task ${negotiationId}`);
    return task;
  }
}
