/**
 * Negotiator memory retrieval (P5.3 read path — IND-407).
 *
 * Composes the negotiator-memory store, the embedder, and negotiator-agent
 * resolution into the `NegotiatorMemoryRetrieveFn` seam the negotiation graph
 * (and the pickup/chat surfaces) consume. Lives in the adapter layer so both
 * services and composition roots can import it (eslint boundaries: services
 * and adapters may import adapters; services may not import services).
 *
 * Contract:
 * - `NEGOTIATOR_MEMORY_INJECT !== 'true'` → `[]` (prompts stay byte-identical).
 * - Any failure → `[]` with a log line; memory must never break a negotiation.
 * - Only ever reads the requesting user's OWN agent's memories — the
 *   underlying adapter is (agentId, userId)-scoped, and the agent id is
 *   resolved from the requesting user, so counterparty memory is
 *   unreachable by construction.
 *
 * Retrieval policy per kind:
 * - `disclosure_rule` — ALWAYS included (hard constraints must not depend on
 *   embedding similarity), newest first, capped.
 * - `counterparty_dossier` — direct lookup by subjectUserId (the counterparty
 *   of this negotiation), not similarity.
 * - `playbook` / `threshold` — top-k cosine similarity against the query text
 *   (seed reasoning + counterparty context), with a relevance floor.
 */
import { log } from '../lib/log';
import type { NegotiatorMemory, NegotiatorMemoryKind } from '../schemas/database.schema';
import { agentDatabaseAdapter } from './agent.database.adapter';
import { embedderAdapter } from './embedder.adapter';
import { negotiatorMemoryDatabaseAdapter } from './negotiator-memory.database.adapter';

const logger = log.lib.from('negotiator-memory.retrieval.adapter');

// Structurally aligned with the protocol package's `NegotiatorMemoryEntry` /
// `NegotiatorMemoryQuery` / `NegotiatorMemoryRetrieveFn` (adapters must not
// import @indexnetwork/protocol; compatibility is verified by TypeScript duck
// typing at the composition roots that hand `negotiatorMemoryRetrieve()` to
// the NegotiationGraphFactory).
export interface NegotiatorMemoryEntry {
  kind: NegotiatorMemoryKind;
  content: string;
  confidence?: number;
}

export interface NegotiatorMemoryQuery {
  userId: string;
  counterpartyUserId: string;
  queryText: string;
  scope: 'screen' | 'turn';
}

export type NegotiatorMemoryRetrieveFn = (query: NegotiatorMemoryQuery) => Promise<NegotiatorMemoryEntry[]>;

/** Max disclosure rules injected per prompt (hard constraints, newest first). */
const MAX_DISCLOSURE_RULES = 10;
/** Max dossier notes about the specific counterparty. */
const MAX_DOSSIER_NOTES = 5;
/** Top-k for the similarity leg (playbooks + thresholds). */
const SIMILARITY_LIMIT = 5;
/** Cosine similarity floor for advisory hints — below this they add noise. */
const MIN_SIMILARITY = 0.2;
/** Cap per kind for the chat surface (recency-ordered, no similarity leg). */
const CHAT_PER_KIND_LIMIT = 5;

/** Whether the P5.3 read path is live (default off; flip per environment). */
export function isNegotiatorMemoryInjectEnabled(): boolean {
  return process.env.NEGOTIATOR_MEMORY_INJECT === 'true';
}

function toEntry(row: NegotiatorMemory): NegotiatorMemoryEntry {
  return {
    kind: row.kind,
    content: row.content,
    confidence: row.confidence,
  };
}

type EmbedFn = (text: string) => Promise<number[]>;

const defaultEmbed: EmbedFn = async (text) =>
  (await embedderAdapter.generate(text)) as number[];

export class NegotiatorMemoryRetrievalAdapter {
  /**
   * Embedding seam — injectable so DB-backed specs can pin deterministic
   * vectors instead of round-tripping to the embedding provider.
   */
  constructor(private readonly embed: EmbedFn = defaultEmbed) {}

  /**
   * Retrieves the requesting user's own negotiator memories for a
   * negotiation-facing prompt (screen node, turn agent, polling pickup).
   * Never throws; resolves `[]` when the flag is off, the user has no
   * negotiator agent, or anything fails.
   */
  async retrieveForNegotiation(query: NegotiatorMemoryQuery): Promise<NegotiatorMemoryEntry[]> {
    if (!isNegotiatorMemoryInjectEnabled()) return [];
    try {
      const agentId = await agentDatabaseAdapter.ensureNegotiatorAgent(query.userId);
      if (!agentId) return [];

      const [disclosureRules, dossierNotes] = await Promise.all([
        negotiatorMemoryDatabaseAdapter.list(agentId, query.userId, {
          kind: 'disclosure_rule',
          limit: MAX_DISCLOSURE_RULES,
        }),
        negotiatorMemoryDatabaseAdapter.list(agentId, query.userId, {
          kind: 'counterparty_dossier',
          subjectUserId: query.counterpartyUserId,
          limit: MAX_DOSSIER_NOTES,
        }),
      ]);

      // Advisory similarity leg — a failed embedding call costs only the
      // hints, never the hard constraints already fetched above.
      let advisory: NegotiatorMemory[] = [];
      try {
        const embedding = await this.embed(query.queryText);
        const similar = await negotiatorMemoryDatabaseAdapter.searchSimilar({
          agentId,
          userId: query.userId,
          embedding,
          limit: SIMILARITY_LIMIT,
          minScore: MIN_SIMILARITY,
        });
        advisory = similar.filter((m) => m.kind === 'playbook' || m.kind === 'threshold');
      } catch (err) {
        logger.warn('Similarity leg of negotiator memory retrieval failed; hard constraints unaffected', {
          userId: query.userId,
          scope: query.scope,
          error: err instanceof Error ? err.message : String(err),
        });
      }

      const entries = [...disclosureRules, ...dossierNotes, ...advisory].map(toEntry);
      if (entries.length > 0) {
        logger.debug('Negotiator memory retrieved for negotiation', {
          userId: query.userId,
          scope: query.scope,
          disclosureRules: disclosureRules.length,
          dossierNotes: dossierNotes.length,
          advisory: advisory.length,
        });
      }
      return entries;
    } catch (err) {
      logger.error('Negotiator memory retrieval failed; proceeding without memory', {
        userId: query.userId,
        scope: query.scope,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }

  /**
   * Retrieves memories for the negotiator CHAT persona (client-facing DM).
   * No similarity leg — there is no counterparty/seed to query against — so
   * this is recency-ordered per kind. Dossiers are excluded: notes about
   * third parties are negotiation context, not standing chat context.
   * Never throws.
   */
  async retrieveForChat(userId: string): Promise<NegotiatorMemoryEntry[]> {
    if (!isNegotiatorMemoryInjectEnabled()) return [];
    try {
      const agentId = await agentDatabaseAdapter.ensureNegotiatorAgent(userId);
      if (!agentId) return [];

      const [disclosureRules, playbooks, thresholds] = await Promise.all([
        negotiatorMemoryDatabaseAdapter.list(agentId, userId, { kind: 'disclosure_rule', limit: CHAT_PER_KIND_LIMIT }),
        negotiatorMemoryDatabaseAdapter.list(agentId, userId, { kind: 'playbook', limit: CHAT_PER_KIND_LIMIT }),
        negotiatorMemoryDatabaseAdapter.list(agentId, userId, { kind: 'threshold', limit: CHAT_PER_KIND_LIMIT }),
      ]);

      return [...disclosureRules, ...playbooks, ...thresholds].map(toEntry);
    } catch (err) {
      logger.error('Negotiator chat memory retrieval failed; proceeding without memory', {
        userId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export const negotiatorMemoryRetrievalAdapter = new NegotiatorMemoryRetrievalAdapter();

/**
 * The `NegotiatorMemoryRetrieveFn` handed to negotiation-graph composition
 * roots. Always defined — the flag is checked per call, so a flag flip takes
 * effect on restart without re-wiring (same pattern as the write service).
 */
export function negotiatorMemoryRetrieve(): NegotiatorMemoryRetrieveFn {
  return (query) => negotiatorMemoryRetrievalAdapter.retrieveForNegotiation(query);
}
