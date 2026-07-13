/**
 * Negotiator memory inspection service (P5.4 / IND-408).
 *
 * The read/edit/delete surface behind `GET|PATCH|DELETE
 * /users/:userId/negotiator/memories` — it's the user's agent, so memory must
 * be inspectable and editable. Disclosure rules especially are standing
 * consent and must be user-visible.
 *
 * Deliberately NOT gated on `NEGOTIATOR_MEMORY_WRITE_ENABLED`: inspection and
 * deletion are the user's standing rights over already-accumulated rows, and
 * the flag only controls whether new rows may be written. The strict
 * self-only authorization lives in the controller (403 for ANY non-self
 * caller, mutuals included); this service additionally keys every adapter
 * call on the owner's userId, so a forged id can never touch another user's
 * rows (no existence oracle).
 *
 * Content edits re-embed: a row's vector must always describe its current
 * content, or similarity retrieval (P5.3) would inject stale meaning. When
 * re-embedding fails, the vector is cleared — the row then simply sits out
 * similarity retrieval (disclosure rules don't ride similarity anyway).
 */

import { log } from '../lib/log';
import { agentDatabaseAdapter } from '../adapters/agent.database.adapter';
import { embedderAdapter } from '../adapters/embedder.adapter';
import { negotiatorMemoryDatabaseAdapter, type NegotiatorMemoryDatabaseAdapter } from '../adapters/negotiator-memory.database.adapter';
import type { NegotiatorMemory, NegotiatorMemoryKind } from '../schemas/database.schema';

const logger = log.service.from('NegotiatorMemoryInspection');

/** All rows fit: per-kind caps total 290 (25+50+200+15). */
const LIST_LIMIT = 300;

type InspectionAdapterSurface = Pick<
  NegotiatorMemoryDatabaseAdapter,
  'list' | 'getById' | 'update' | 'delete'
>;

export interface NegotiatorMemoryInspectionDeps {
  memories?: InspectionAdapterSurface;
  /** Embed a content string (2000-dim premise space); null on failure. */
  embed?: (text: string) => Promise<number[] | null>;
  /** Resolve the user's personal negotiator agent id (provisioning if missing). */
  resolveNegotiatorAgentId?: (userId: string) => Promise<string | null>;
}

export interface UpdateMemoryPatch {
  content?: string;
  confidence?: number;
}

export class NegotiatorMemoryInspectionService {
  private readonly memories: InspectionAdapterSurface;
  private readonly embed: (text: string) => Promise<number[] | null>;
  private readonly resolveNegotiatorAgentId: (userId: string) => Promise<string | null>;

  constructor(deps?: NegotiatorMemoryInspectionDeps) {
    this.memories = deps?.memories ?? negotiatorMemoryDatabaseAdapter;
    this.embed = deps?.embed ?? (async (text) => {
      try {
        const vector = await embedderAdapter.generate(text);
        return vector as number[];
      } catch (err) {
        logger.warn('Embedding failed for negotiator memory edit; clearing vector', {
          error: err instanceof Error ? err.message : String(err),
        });
        return null;
      }
    });
    this.resolveNegotiatorAgentId = deps?.resolveNegotiatorAgentId ?? (async (userId) =>
      agentDatabaseAdapter.ensureNegotiatorAgent(userId));
  }

  /**
   * List the user's own negotiator memories, newest first, optionally
   * filtered by kind. Returns [] when the user has no negotiator agent.
   */
  async list(userId: string, filter?: { kind?: NegotiatorMemoryKind }): Promise<NegotiatorMemory[]> {
    const agentId = await this.resolveNegotiatorAgentId(userId);
    if (!agentId) return [];
    return this.memories.list(agentId, userId, {
      ...(filter?.kind ? { kind: filter.kind } : {}),
      limit: LIST_LIMIT,
    });
  }

  /**
   * Edit a memory's content and/or confidence. Content edits re-embed (or
   * clear the vector on embed failure) so similarity retrieval never serves
   * stale meaning. Returns null when the row is missing or not the caller's.
   */
  async update(userId: string, memoryId: string, patch: UpdateMemoryPatch): Promise<NegotiatorMemory | null> {
    const existing = await this.memories.getById(memoryId, userId);
    if (!existing) return null;

    const content = patch.content?.trim();
    const contentChanged = content !== undefined && content.length > 0 && content !== existing.content;
    const embedding = contentChanged ? await this.embed(content) : undefined;

    const updated = await this.memories.update(memoryId, userId, {
      ...(contentChanged ? { content, embedding } : {}),
      ...(patch.confidence !== undefined ? { confidence: patch.confidence } : {}),
    });
    if (updated) {
      logger.info('Negotiator memory edited by owner', {
        userId,
        memoryId,
        contentChanged,
        confidenceChanged: patch.confidence !== undefined,
      });
    }
    return updated;
  }

  /**
   * Delete a memory. Owner-scoped at the adapter; removal takes effect for
   * the next retrieval immediately (P5.3 reads live rows per session).
   */
  async remove(userId: string, memoryId: string): Promise<boolean> {
    const deleted = await this.memories.delete(memoryId, userId);
    if (deleted) logger.info('Negotiator memory deleted by owner', { userId, memoryId });
    return deleted;
  }
}

export const negotiatorMemoryInspectionService = new NegotiatorMemoryInspectionService();
