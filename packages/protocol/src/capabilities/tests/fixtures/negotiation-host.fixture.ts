/**
 * In-memory host implementing the exact `NegotiationGraphDatabase` and
 * `NegotiationRoundLogDatabase` ports the NegotiationGraph and the
 * PersonalAgent read and write through.
 *
 * Deliberately provider-free and dependency-free: the e2e specs that use it
 * run in the credential-free CI gate, driving the REAL compiled graphs
 * against this fake rather than mocking the graphs themselves.
 */
import type { NegotiationGraphDatabase, NegotiationRoundLogDatabase, NegotiationRoundLogEventRecord, NegotiationTaskRow } from "../../../platform/database/negotiation.js";

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
  /** Per-intent batch lifecycle, exactly as `intents.negotiation_batch_id` behaves. */
  readonly batchIds = new Map<string, string>();
  readonly opportunities = new Map<string, FakeOpportunity>();
  readonly tasks = new Map<string, NegotiationTaskRow>();
  readonly messages = new Map<string, FakeMessage[]>();
  readonly opportunityStatusUpdates: Array<{ id: string; status: string }> = [];
  readonly outcomeArtifacts = new Map<string, { verdict: 'pending' | 'reject'; reasoning?: string; resolvedByUserId: string }>();
  /** Test-only interleave immediately before the atomic completion snapshot. */
  beforeCompleteNegotiation?: () => void;
  /** Deduped by one durable dedupe key, exactly as BullMQ does. */
  readonly reflectJobs: Array<{ userId: string; intentId: string; batchId: string; dedupeKey: string }> = [];
  /** `${intentId}::${batchId}` → append-order event log. */
  readonly roundLogEvents = new Map<string, NegotiationRoundLogEventRecord[]>();
  private taskCounter = 0;
  private messageCounter = 0;
  private batchCounter = 0;

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

  /** Convenience accessor for INTENT_ID's own current batch — most specs only ever kick off one signal. */
  get batchId(): string | null {
    return this.batchIds.get(INTENT_ID) ?? null;
  }

  set batchId(value: string | null) {
    if (value === null) this.batchIds.delete(INTENT_ID);
    else this.batchIds.set(INTENT_ID, value);
  }

  /** Whether the given batch's round-log carries its opening_complete marker. */
  isOpeningComplete(intentId: string = INTENT_ID, batchId: string | null = this.batchId): boolean {
    if (!batchId) return false;
    return (this.roundLogEvents.get(`${intentId}::${batchId}`) ?? []).some((event) => event.kind === "opening_complete");
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
      metadata: { ...input.metadata },
      createdAt: new Date(),
      updatedAt: new Date(),
    };
    this.tasks.set(task.id, task);
    this.messages.set(task.id, []);
    return task;
  }

  readonly roundLog: NegotiationRoundLogDatabase = {
    appendNegotiationRoundLogEvent: async (intentId, event) => {
      const key = `${intentId}::${event.batchId}`;
      const list = this.roundLogEvents.get(key) ?? [];
      list.push({ ...event, createdAt: new Date() });
      this.roundLogEvents.set(key, list);
    },
    readNegotiationRoundLogEvents: async (intentId, batchId) =>
      [...(this.roundLogEvents.get(`${intentId}::${batchId}`) ?? [])],
  };

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
          seats: input.seats,
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
        metadata: {
          ...task.metadata,
          ...(pause !== undefined || state === "working" ? { pause: pause ?? null } : {}),
        },
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
    completeNegotiation: async (input) => {
      const task = this.tasks.get(input.taskId);
      if (!task || task.state === 'completed') return null;
      if (input.kind !== 'opportunity_expired') {
        const isSeat = Object.values(task.metadata.seats).some((seat) => seat.userId === input.resolvedByUserId)
          || task.metadata.sourceUserId === input.resolvedByUserId
          || task.metadata.candidateUserId === input.resolvedByUserId;
        if (!isSeat) return null;
        if (input.kind === 'pause_verdict' && (
          task.state !== 'paused'
          || task.metadata.pause?.reason !== 'ready_for_verdict'
          || task.metadata.pause.pausedBy !== input.resolvedByUserId
        )) return null;
      }
      this.beforeCompleteNegotiation?.();
      const opportunity = this.opportunities.get(task.metadata.opportunityId);
      if (!opportunity) return null;
      const terminal = ['accepted', 'rejected', 'expired'].includes(opportunity.status);
      if (input.kind === 'owner_verdict' && !terminal) return null;
      if (input.kind === 'opportunity_expired' && opportunity.status !== 'expired') return null;
      if (input.kind !== 'opportunity_expired') {
        this.outcomeArtifacts.set(task.id, {
          verdict: input.verdict,
          reasoning: input.reasoning,
          resolvedByUserId: input.resolvedByUserId,
        });
      }
      const updated = {
        ...task,
        state: 'completed' as const,
        metadata: { ...task.metadata, watchdogReflectPending: true },
        updatedAt: new Date(),
      };
      this.tasks.set(task.id, updated);
      if (input.kind === 'pause_verdict' && !terminal) {
        const status = input.verdict === 'pending' ? 'pending' : 'rejected';
        this.opportunityStatusUpdates.push({ id: opportunity.id, status });
        opportunity.status = status;
      }
      return updated;
    },
    clearNegotiationReflectPending: async (taskId) => {
      const task = this.tasks.get(taskId);
      if (!task) return;
      this.tasks.set(taskId, {
        ...task,
        metadata: { ...task.metadata, watchdogReflectPending: false },
      });
    },
    getArtifactsForTask: async () => [],
    getNegotiationTasksForIntentBatch: async (intentId, batchId) =>
      [...this.tasks.values()].filter((t) => t.metadata.seats[intentId]?.batchId === batchId),
    // Signal-scoped on purpose: a negotiation a later batch left behind must
    // stay visible, or it can never be promoted or rejected.
    getPausedNegotiationTasksForIntent: async (intentId) =>
      [...this.tasks.values()].filter((t) => intentId in t.metadata.seats && t.state === "paused"),
    bumpIntentNegotiationBatch: async (intentId: string) => {
      const batchId = `batch-${++this.batchCounter}`;
      this.batchIds.set(intentId, batchId);
      return { batchId };
    },
    getIntentNegotiationBatch: async (intentId) => ({
      batchId: this.batchIds.get(intentId) ?? null,
    }),
    countActiveNegotiationsForBatch: async (intentId, batchId) =>
      [...this.tasks.values()].filter((t) =>
        t.metadata.seats[intentId]?.batchId === batchId && t.state !== "paused" && t.state !== "completed").length,
  };

  /**
   * Push every event of the given batch's log past the staleness bound, so a
   * later turn reads the batch as abandoned rather than in flight (D20).
   */
  ageKickoff(byMs = 11 * 60 * 1000, intentId: string = INTENT_ID, batchId?: string | null): void {
    const resolvedBatchId = batchId ?? this.batchIds.get(intentId) ?? null;
    if (!resolvedBatchId) return;
    const key = `${intentId}::${resolvedBatchId}`;
    const list = this.roundLogEvents.get(key);
    if (!list) return;
    this.roundLogEvents.set(key, list.map((event) => ({ ...event, createdAt: new Date(event.createdAt.getTime() - byMs) })));
  }

  /** Records a reflect job the way the queue does: once per durable dedupe key. */
  enqueueReflect(job: { userId: string; intentId: string; batchId: string; dedupeKey: string }): void {
    if (this.reflectJobs.some((existing) =>
      existing.intentId === job.intentId && existing.batchId === job.batchId && existing.dedupeKey === job.dedupeKey)) return;
    this.reflectJobs.push(job);
  }

  taskFor(negotiationId: string): NegotiationTaskRow {
    const task = this.tasks.get(negotiationId);
    if (!task) throw new Error(`No such task ${negotiationId}`);
    return task;
  }
}
