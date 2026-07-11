/**
 * Negotiator memory write service (P5.2 / IND-406).
 *
 * The single choke point for every `negotiator_memories` write: the reflect
 * queue (post-negotiation + chat distillation) and the ask_user answer path
 * (immediate disclosure_rule) both land here. Owns the anti-poisoning policy:
 *
 * - **Flag gate**: `NEGOTIATOR_MEMORY_WRITE_ENABLED` (default OFF — code
 *   ships inert, the environment turns it on; off in prod until P5.4
 *   inspection ships so users can see memory before it accumulates).
 * - **Per-kind entry caps** per negotiator: at cap, the lowest-confidence
 *   (oldest first) entry is evicted to make room.
 * - **Dossier upsert**: one dossier per (agent, subject) — repeat encounters
 *   reinforce (content refresh + confidence bump + provenance append) instead
 *   of duplicating.
 * - **Confidence decay schedule**: cron-driven bulk decay of stale rows via
 *   the adapter; rows below the floor are removed.
 *
 * Leak-guard unchanged from IND-405: this service only WRITES; no read path
 * is exposed to discovery, user contexts, or counterparty-visible surfaces.
 */

import type { DistilledMemory } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { negotiatorMemoryDatabaseAdapter, type NegotiatorMemoryDatabaseAdapter } from '../adapters/negotiator-memory.database.adapter';
import type { NegotiatorMemoryKind, NegotiatorMemorySourceRef } from '../schemas/database.schema';

const logger = log.service.from('NegotiatorMemoryWrite');

/** Write-path flag. Default off; flipped per environment (dev first). */
export function isNegotiatorMemoryWriteEnabled(): boolean {
  return process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED === 'true';
}

/** Per-kind entry caps per negotiator agent (anti-poisoning). */
export const NEGOTIATOR_MEMORY_KIND_CAPS: Record<NegotiatorMemoryKind, number> = {
  playbook: 25,
  disclosure_rule: 50,
  counterparty_dossier: 200,
  threshold: 15,
};

/** Confidence bump when a dossier is reinforced by a new encounter. */
const REINFORCE_BUMP = 0.1;
/** Max provenance refs kept per row (oldest dropped first). */
const MAX_SOURCE_REFS = 10;
/** Daily decay multiplier for rows not updated within {@link DECAY_AFTER_MS}. */
const DECAY_FACTOR = 0.99;
const DECAY_AFTER_MS = 7 * 24 * 60 * 60 * 1000;
/** Rows decaying below this confidence floor are deleted. */
const DECAY_DELETE_BELOW = 0.05;

type MemoryAdapterSurface = Pick<
  NegotiatorMemoryDatabaseAdapter,
  'create' | 'list' | 'update' | 'delete' | 'decayAll'
>;

export interface NegotiatorMemoryWriteDeps {
  memories?: MemoryAdapterSurface;
  /** Embed a content string (2000-dim premise space); null on failure. */
  embed?: (text: string) => Promise<number[] | null>;
  /** Resolve the user's personal negotiator agent id (provisioning if missing). */
  resolveNegotiatorAgentId?: (userId: string) => Promise<string | null>;
}

export interface WriteDistilledInput {
  /** The client whose negotiator learns. */
  userId: string;
  entries: DistilledMemory[];
  /** Provenance attached to every written row (turnIndexes merged per entry). */
  sourceRef: NegotiatorMemorySourceRef;
  /** Subject for `counterparty_dossier` entries; dossiers are skipped without it. */
  counterpartyUserId?: string;
}

export class NegotiatorMemoryWriteService {
  private readonly memories: MemoryAdapterSurface;
  private readonly embed: (text: string) => Promise<number[] | null>;
  private readonly resolveNegotiatorAgentId: (userId: string) => Promise<string | null>;

  constructor(deps?: NegotiatorMemoryWriteDeps) {
    this.memories = deps?.memories ?? negotiatorMemoryDatabaseAdapter;
    this.embed = deps?.embed ?? (async (text) => {
      try {
        const vector = await embedderAdapter.generate(text);
        return vector as number[];
      } catch (err) {
        logger.warn('Embedding failed for negotiator memory; storing without vector', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });
    this.resolveNegotiatorAgentId = deps?.resolveNegotiatorAgentId ?? (async (userId) =>
      // Same resolution agentService.getNegotiatorAgent uses — idempotent
      // provision of the user's type='personal' negotiator row (IND-410).
      agentDatabaseAdapter.ensureNegotiatorAgent(userId));
  }

  /**
   * Persist a batch of distilled memories for one client's negotiator,
   * applying caps and dossier upsert. Returns write counters (never throws
   * for individual entry failures — callers are fire-and-forget paths).
   */
  async writeDistilledMemories(input: WriteDistilledInput): Promise<{ written: number; skipped: number }> {
    if (!isNegotiatorMemoryWriteEnabled()) {
      return { written: 0, skipped: input.entries.length };
    }
    if (input.entries.length === 0) return { written: 0, skipped: 0 };

    const agentId = await this.resolveNegotiatorAgentId(input.userId);
    if (!agentId) {
      logger.warn('No personal negotiator agent for user; skipping memory write', { userId: input.userId });
      return { written: 0, skipped: input.entries.length };
    }

    let written = 0;
    let skipped = 0;

    for (const entry of input.entries) {
      try {
        const isDossier = entry.kind === 'counterparty_dossier';
        if (isDossier && !input.counterpartyUserId) {
          skipped++;
          continue;
        }

        const ref: NegotiatorMemorySourceRef = {
          ...input.sourceRef,
          ...(entry.turnIndexes.length > 0 && { turnIndexes: entry.turnIndexes }),
        };

        if (isDossier) {
          await this.upsertDossier(agentId, input.userId, input.counterpartyUserId!, entry, ref);
        } else {
          await this.enforceKindCap(agentId, input.userId, entry.kind);
          const embedding = await this.embed(entry.content);
          await this.memories.create({
            agentId,
            userId: input.userId,
            kind: entry.kind,
            content: entry.content,
            confidence: entry.confidence,
            ...(embedding && { embedding }),
            sourceRefs: [ref],
          });
        }
        written++;
      } catch (err) {
        skipped++;
        logger.error('Failed to write negotiator memory entry', {
          userId: input.userId,
          kind: entry.kind,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    if (written > 0) {
      logger.info('Negotiator memories written', {
        userId: input.userId,
        agentId,
        written,
        skipped,
        sourceType: input.sourceRef.type,
        sourceId: input.sourceRef.id,
      });
    }
    return { written, skipped };
  }

  /**
   * Record an `ask_user` answer as an immediate disclosure_rule memory (the
   * answer is already a distilled policy — no LLM pass needed). High
   * confidence: this is the client speaking directly.
   */
  async recordDisclosureRuleFromAnswer(input: {
    userId: string;
    questionId: string;
    questionPrompt?: string;
    selectedOptions: string[];
    freeText?: string;
  }): Promise<void> {
    if (!isNegotiatorMemoryWriteEnabled()) return;

    const answerText = [input.selectedOptions.join('; '), input.freeText?.trim()]
      .filter(Boolean)
      .join(' — ');
    if (!answerText) return;

    const subject = input.questionPrompt?.trim() || 'a mid-negotiation disclosure decision';
    const content = `Client guidance on "${subject}": ${answerText}`;

    await this.writeDistilledMemories({
      userId: input.userId,
      entries: [{
        kind: 'disclosure_rule',
        content,
        confidence: 0.9,
        aboutCounterparty: false,
        turnIndexes: [],
      }],
      sourceRef: { type: 'question_answer', id: input.questionId },
    });
  }

  /**
   * Run one confidence-decay pass (cron path). Independent of the write flag:
   * decay is maintenance of existing rows and no-ops on an empty table.
   */
  async runConfidenceDecay(): Promise<{ decayed: number; deleted: number }> {
    return this.memories.decayAll({
      factor: DECAY_FACTOR,
      olderThanMs: DECAY_AFTER_MS,
      deleteBelow: DECAY_DELETE_BELOW,
    });
  }

  /** One dossier per (agent, subject): reinforce, don't duplicate. */
  private async upsertDossier(
    agentId: string,
    userId: string,
    subjectUserId: string,
    entry: DistilledMemory,
    ref: NegotiatorMemorySourceRef,
  ): Promise<void> {
    const [existing] = await this.memories.list(agentId, userId, {
      kind: 'counterparty_dossier',
      subjectUserId,
      limit: 1,
    });

    if (existing) {
      const embedding = await this.embed(entry.content);
      await this.memories.update(existing.id, userId, {
        content: entry.content,
        ...(embedding && { embedding }),
        confidence: Math.min(1, Math.max(existing.confidence, entry.confidence) + REINFORCE_BUMP),
        sourceRefs: [...existing.sourceRefs.slice(-(MAX_SOURCE_REFS - 1)), ref],
      });
      return;
    }

    await this.enforceKindCap(agentId, userId, 'counterparty_dossier');
    const embedding = await this.embed(entry.content);
    await this.memories.create({
      agentId,
      userId,
      kind: 'counterparty_dossier',
      content: entry.content,
      subjectUserId,
      confidence: entry.confidence,
      ...(embedding && { embedding }),
      sourceRefs: [ref],
    });
  }

  /**
   * Evict lowest-confidence (oldest-first tie-break) entries when the kind is
   * at cap, leaving room for exactly one new row.
   */
  private async enforceKindCap(agentId: string, userId: string, kind: NegotiatorMemoryKind): Promise<void> {
    const cap = NEGOTIATOR_MEMORY_KIND_CAPS[kind];
    const rows = await this.memories.list(agentId, userId, { kind, limit: cap + 16 });
    if (rows.length < cap) return;

    const evictable = [...rows].sort((a, b) =>
      a.confidence !== b.confidence
        ? a.confidence - b.confidence
        : new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
    const toEvict = evictable.slice(0, rows.length - cap + 1);
    for (const row of toEvict) {
      await this.memories.delete(row.id, userId);
      logger.info('Evicted negotiator memory at kind cap', { agentId, kind, evictedId: row.id, confidence: row.confidence });
    }
  }
}

export const negotiatorMemoryWriteService = new NegotiatorMemoryWriteService();
