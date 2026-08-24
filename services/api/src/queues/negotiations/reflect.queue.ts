/**
 * Negotiation reflection queue (P5.2 / IND-406) — the memory write path.
 *
 * Two job kinds:
 * - `reflect`: enqueued by the negotiation graph's finalize node (via the
 *   injected `ReflectEnqueueFn` — the protocol package has no BullMQ access).
 *   Replays the finished negotiation's turn history from BOTH sides and
 *   distills ≤ 3 private memory entries per side via `NegotiationReflector`.
 * - `chat_reflect`: debounce-scheduled after each negotiator-DM turn; fires
 *   once the session has been idle for the debounce window ("session end"),
 *   distilling the client's stated preferences/corrections.
 *
 * Write-only: nothing reads `negotiator_memories` yet (P5.3). Every write
 * funnels through `NegotiatorMemoryWriteService` (flag gate, caps, dossier
 * upsert). Job failures never affect negotiation outcomes — the negotiation
 * finalized before the job runs, and the graph enqueues fire-and-forget.
 *
 * A daily cron runs the confidence-decay pass (anti-poisoning schedule).
 */

import { Job } from 'bullmq';
import cron from 'node-cron';

import { NegotiationReflector } from '@indexnetwork/protocol';
import type { NegotiationReflectJobData, ReflectEnqueueFn, ReflectionTranscriptEntry, DistilledMemory } from '@indexnetwork/protocol';

import { log } from '../../lib/log';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { conversationDatabaseAdapter } from '../../adapters/database.adapter';
import { chatSessionService } from '../../services/chat.service';
import { negotiatorMemoryWriteService, isNegotiatorMemoryWriteEnabled, type NegotiatorMemoryWriteService } from '../../services/negotiator-memory.service';

/** BullMQ queue name for reflection jobs. */
export const QUEUE_NAME = 'negotiation-reflect';

/** Idle window after the last negotiator-DM turn before chat_reflect fires. */
const CHAT_REFLECT_DELAY_MS = 15 * 60 * 1000;

export type ReflectJobData = NegotiationReflectJobData;

export interface ChatReflectJobData {
  sessionId: string;
  userId: string;
}

type ReflectQueueJobData = ReflectJobData | ChatReflectJobData;

/** Optional deps for testing — abstractions only, no real DB/LLM/Redis. */
export interface ReflectQueueDeps {
  conversations?: {
    getMessagesForConversation: (conversationId: string) => Promise<Array<{
      id: string;
      senderId: string;
      parts: unknown[];
      createdAt: Date;
    }>>;
    getNegotiationMessages: (opportunityId: string) => Promise<Array<{
      id: string;
      senderId: string;
      parts: unknown[];
      createdAt: Date;
    }>>;
  };
  chat?: {
    getSession: (sessionId: string, userId: string) => Promise<{ persona: string; scopeType: string | null; scopeId: string | null } | null>;
    getSessionMessages: (sessionId: string, limit?: number) => Promise<Array<{ role: 'user' | 'assistant' | 'system'; content: string }>>;
  };
  reflector?: Pick<NegotiationReflector, 'reflectNegotiation' | 'reflectChat'>;
  writer?: Pick<NegotiatorMemoryWriteService, 'writeDistilledMemories' | 'runConfidenceDecay'>;
}

/**
 * Reflection queue: BullMQ queue + worker + cron in one class. Workers are
 * started only by the protocol server via {@link startWorker}; the decay cron
 * via {@link startCrons}.
 */
export class NegotiationReflectQueue {
  static readonly QUEUE_NAME = QUEUE_NAME;

  readonly queue = QueueFactory.createQueue<ReflectQueueJobData>(QUEUE_NAME);

  private readonly logger = log.job.from('NegotiationReflectJob');
  private readonly queueLogger = log.queue.from('NegotiationReflectQueue');
  private readonly deps: ReflectQueueDeps | undefined;
  private reflector: Pick<NegotiationReflector, 'reflectNegotiation' | 'reflectChat'> | null;
  private worker: ReturnType<typeof QueueFactory.createWorker<ReflectQueueJobData>> | null = null;
  private cronStarted = false;

  constructor(deps?: ReflectQueueDeps) {
    this.deps = deps;
    this.reflector = deps?.reflector ?? null; // lazy — created on first job (defers OPENROUTER key need)
  }

  private getReflector(): Pick<NegotiationReflector, 'reflectNegotiation' | 'reflectChat'> {
    if (!this.reflector) this.reflector = new NegotiationReflector();
    return this.reflector;
  }

  private getWriter(): Pick<NegotiatorMemoryWriteService, 'writeDistilledMemories' | 'runConfidenceDecay'> {
    return this.deps?.writer ?? negotiatorMemoryWriteService;
  }

  /** Enqueue a post-negotiation reflection job. */
  async addReflectJob(data: ReflectJobData): Promise<void> {
    await this.queue.add('reflect', data, { jobId: `reflect-${data.negotiationId}` });
  }

  /**
   * Debounce-schedule a chat reflection for a negotiator DM: each call
   * replaces any pending delayed job for the session, so the job only fires
   * after the session has been idle for the full delay window — the closest
   * observable "session end" for an open-ended DM surface. No-op when the
   * write flag is off (avoids Redis churn for a job that would skip anyway).
   */
  async scheduleChatReflect(data: ChatReflectJobData): Promise<void> {
    if (!isNegotiatorMemoryWriteEnabled()) return;
    const jobId = `chat-reflect-${data.sessionId}`;
    await this.queue.remove(jobId).catch(() => { /* not present or already active — fine */ });
    await this.queue.add('chat_reflect', data, { jobId, delay: CHAT_REFLECT_DELAY_MS });
  }

  /** Run a job handler (worker path and tests with injected deps). */
  async processJob(name: string, data: ReflectQueueJobData): Promise<void> {
    switch (name) {
      case 'reflect':
        await this.handleReflect(data as ReflectJobData);
        break;
      case 'chat_reflect':
        await this.handleChatReflect(data as ChatReflectJobData);
        break;
      default:
        this.queueLogger.warn('Unknown job name', { name });
    }
  }

  /** Start the BullMQ worker. Idempotent; protocol server only. */
  startWorker(): void {
    if (this.worker) return;
    const processor = async (job: Job<ReflectQueueJobData>) => {
      this.queueLogger.info('Processing job', { jobId: job.id, jobName: job.name });
      await this.processJob(job.name, job.data);
    };
    this.worker = QueueFactory.createWorker<ReflectQueueJobData>(QUEUE_NAME, processor);
  }

  /**
   * Start the daily confidence-decay cron (04:40, after the HyDE maintenance
   * window). Runs regardless of the write flag — decay is maintenance of
   * existing rows and no-ops on an empty table.
   */
  startCrons(): void {
    if (this.cronStarted) return;
    this.cronStarted = true;
    cron.schedule('40 4 * * *', () => {
      this.getWriter().runConfidenceDecay()
        .then(({ decayed, deleted }) => {
          if (decayed > 0 || deleted > 0) this.logger.info('Confidence decay pass complete', { decayed, deleted });
        })
        .catch((err) => this.logger.error('Confidence decay cron failed', { error: err }));
    });
  }

  /** Gracefully close the worker and queue connections. */
  async close(): Promise<void> {
    if (this.worker) {
      await this.worker.close();
      this.worker = null;
    }
    await this.queue.close();
  }

  // ─── reflect ──────────────────────────────────────────────────────────────

  private async handleReflect(data: ReflectJobData): Promise<void> {
    if (!isNegotiatorMemoryWriteEnabled()) {
      this.logger.info('Memory writes disabled; skipping reflection', { negotiationId: data.negotiationId });
      return;
    }

    const conversations: NonNullable<ReflectQueueDeps['conversations']> =
      this.deps?.conversations ?? conversationDatabaseAdapter;
    // A negotiation is its own conversation now — no pair-shared thread to
    // scope out of.
    const messages = await conversations.getMessagesForConversation(data.conversationId);

    // Extract turn data parts. #1494: the persisted shape is
    // {verb, message, reasoning} for a continuing turn, or {verb:'pause',
    // reason} for a pause (redacted — payload is never in the shared
    // thread). This is dormant until step 2 rewires reflectEnqueue at this
    // queue, but the shape must be current now, not the pre-rewrite
    // {action, assessment} one.
    const turns = messages
      .map((m: { senderId: string; parts: unknown[] }) => {
        const dataPart = (m.parts as Array<{ kind?: string; data?: { verb?: string; message?: string; reasoning?: string; reason?: string } }>)
          .find((p) => p.kind === 'data');
        return dataPart?.data ? { senderId: m.senderId, turn: dataPart.data } : null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);

    if (turns.length === 0) {
      this.logger.info('No turns to reflect on', { negotiationId: data.negotiationId });
      return;
    }

    // Each side's negotiator learns independently: run the distiller once per
    // user, projecting the shared transcript into that side's perspective.
    // One side failing must not cost the other its memories.
    const sides = [
      { user: data.sourceUser, other: data.candidateUser },
      { user: data.candidateUser, other: data.sourceUser },
    ];

    for (const { user, other } of sides) {
      try {
        const transcript: ReflectionTranscriptEntry[] = turns.map((t, index) => ({
          index,
          speaker: t.senderId === `agent:${user.id}` ? 'client' as const : 'counterparty' as const,
          action: t.turn.verb === 'pause' ? `pause:${t.turn.reason ?? 'unknown'}` : (t.turn.verb ?? 'unknown'),
          ...(t.turn.message && { message: t.turn.message }),
          ...(t.turn.reasoning && { reasoning: t.turn.reasoning }),
        }));

        const entries = await this.getReflector().reflectNegotiation({
          clientUser: user,
          counterpartyUser: other,
          seat: user.id === data.initiatorUserId ? 'initiator' : 'counterparty',
          outcome: data.outcome,
          transcript,
        });

        const { written, skipped } = await this.getWriter().writeDistilledMemories({
          userId: user.id,
          counterpartyUserId: other.id,
          entries,
          sourceRef: { type: 'negotiation', id: data.negotiationId },
        });

        this.logger.info('Negotiation reflection side complete', {
          negotiationId: data.negotiationId,
          userId: user.id,
          distilled: entries.length,
          written,
          skipped,
        });
      } catch (err) {
        this.logger.error('Negotiation reflection side failed', {
          negotiationId: data.negotiationId,
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
  }

  // ─── chat_reflect ─────────────────────────────────────────────────────────

  private async handleChatReflect(data: ChatReflectJobData): Promise<void> {
    if (!isNegotiatorMemoryWriteEnabled()) {
      this.logger.info('Memory writes disabled; skipping chat reflection', { sessionId: data.sessionId });
      return;
    }

    const chat = this.deps?.chat ?? chatSessionService;

    // Ownership + scope guard: only the client's own signal DM (an
    // intent-scoped session) is reflected — global chats teach the
    // negotiator nothing. Re-keyed from the retired negotiator persona id to
    // the same scope predicate that routes the DM's turns.
    const session = await chat.getSession(data.sessionId, data.userId);
    if (!session || session.scopeType !== 'intent' || !session.scopeId) {
      this.logger.info('Not an intent-scoped DM session; skipping chat reflection', {
        sessionId: data.sessionId,
        persona: session?.persona ?? 'none',
      });
      return;
    }

    const raw = await chat.getSessionMessages(data.sessionId, 60);
    const messages = raw
      .filter((m): m is typeof m & { role: 'user' | 'assistant' } => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role, content: m.content }))
      .filter((m) => m.content.trim().length > 0);

    if (!messages.some((m) => m.role === 'user')) {
      this.logger.info('No client messages in session; skipping chat reflection', { sessionId: data.sessionId });
      return;
    }

    const entries = await this.getReflector().reflectChat({
      clientUser: { id: data.userId },
      messages,
    });

    // Chat scope has no counterparty: dossiers cannot be attributed to a
    // subject here, so any that slip through the prompt are dropped.
    const clientSideEntries: DistilledMemory[] = entries.filter((e) => e.kind !== 'counterparty_dossier');

    const { written, skipped } = await this.getWriter().writeDistilledMemories({
      userId: data.userId,
      entries: clientSideEntries,
      sourceRef: { type: 'chat', id: data.sessionId },
    });

    this.logger.info('Chat reflection complete', {
      sessionId: data.sessionId,
      userId: data.userId,
      distilled: entries.length,
      written,
      skipped,
    });
  }
}

/** Singleton reflect queue instance. */
export const negotiationReflectQueue = new NegotiationReflectQueue();

/**
 * The reflect enqueue callback.
 *
 * Use at every negotiation-graph composition site (main.ts background graph,
 * negotiation/tool services, MCP composition root) — mirrors
 * `parkedQuestionEnqueue` so no path silently drops reflection.
 */
export function reflectEnqueue(): ReflectEnqueueFn {
  return async (job) => {
    await negotiationReflectQueue.addReflectJob(job);
  };
}
