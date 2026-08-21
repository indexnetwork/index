/**
 * Negotiator client-DM retrieval (A2H read path).
 *
 * Reads the agent-to-human thread a user is having with their negotiator about
 * ONE signal, and composes it into the `NegotiatorClientDmRetrieveFn` seam the
 * negotiation graph consumes. Lives in the adapter layer so both services and
 * composition roots can import it (eslint boundaries: services and adapters may
 * import adapters; services may not import services).
 *
 * Contract:
 * - `NEGOTIATOR_CLIENT_DM_INJECT !== 'true'` → `[]` (prompts stay byte-identical).
 * - No negotiator DM for this signal → `[]`, NOT an error. Most signals will
 *   never have one; absence is the normal case.
 * - Any failure → `[]` with a log line; a DM must never break a negotiation.
 * - Only ever reads the requesting user's OWN DM — the `chat_session_scopes`
 *   lookup is (userId, 'negotiator-intent', intentId)-keyed and the query type
 *   carries no counterparty field, so the counterparty's DM is unreachable by
 *   construction rather than by a check that could be forgotten.
 *
 * Why the DM rather than `negotiator_memories`: memory has no intent column
 * (agentId/userId + optional subjectUserId, retrieved by vector similarity), so
 * grounding on it would cross signals silently. The DM is intent-scoped at the
 * database — `chat_session_scopes` unique on (userId, scopeType, scopeId) with
 * scopeType 'negotiator-intent' — which is exactly one DM per signal.
 */
import { and, db, desc, eq, schema } from './database.shared';
import { log } from '../lib/log';

const logger = log.lib.from('negotiator-client-dm.retrieval.adapter');

// Structurally aligned with the protocol package's `NegotiatorClientDmMessage`
// / `NegotiatorClientDmQuery` / `NegotiatorClientDmRetrieveFn` (adapters must
// not import @indexnetwork/protocol; compatibility is verified by TypeScript
// duck typing at the composition roots that hand `negotiatorClientDmRetrieve()`
// to the NegotiationGraphFactory).
export interface NegotiatorClientDmMessage {
  role: 'client' | 'agent';
  content: string;
}

export interface NegotiatorClientDmQuery {
  userId: string;
  intentId: string;
}

export type NegotiatorClientDmRetrieveFn = (query: NegotiatorClientDmQuery) => Promise<NegotiatorClientDmMessage[]>;

/**
 * Registry scope_type for intent-pinned negotiator sessions (P4.2/IND-403).
 * Duplicated from conversation.database.adapter rather than exported from it —
 * the value is the shape of a stored row, and both readers pinning the same
 * literal is what keeps them honest if either is refactored.
 */
const NEGOTIATOR_INTENT_SCOPE_TYPE = 'negotiator-intent';

/**
 * How many trailing DM messages to read.
 *
 * This lands in a prompt, so the cap is a prompt budget, not a page size. The
 * DM is one standing conversation about one signal; what matters for a question
 * the agent is about to ask is what the client most recently settled, not the
 * whole history — which is what the distillation pass into `negotiator_memories`
 * is for. Twenty messages is roughly the last two exchanges plus their lead-up,
 * enough to catch "we decided this last week" and bounded enough that a chatty
 * client cannot crowd out the negotiation itself.
 */
const MAX_DM_MESSAGES = 20;

/**
 * Per-message character cap. A single pasted email or job description can be
 * longer than the entire rest of the excerpt; truncating per message keeps one
 * outlier from consuming the whole budget while still showing that it was said.
 */
const MAX_MESSAGE_CHARS = 1200;

/**
 * @returns true — the negotiator always reads a bounded excerpt of its own
 * client's DM for this signal. On for the first time with this change.
 */
export function isNegotiatorClientDmInjectEnabled(): boolean {
  return true;
}

/** Text of a message's parts, mirroring the chat-session reader's extraction. */
function messageText(parts: unknown): string {
  if (!Array.isArray(parts)) return '';
  const typed = parts as Array<{ type?: string; text?: string }>;
  const text = typed.find((p) => p?.type === 'text' && typeof p.text === 'string')?.text
    ?? typed.find((p) => typeof p?.text === 'string')?.text
    ?? '';
  const trimmed = text.trim();
  return trimmed.length > MAX_MESSAGE_CHARS ? `${trimmed.slice(0, MAX_MESSAGE_CHARS)}…` : trimmed;
}

export class NegotiatorClientDmRetrievalAdapter {
  /**
   * Retrieves a bounded recent excerpt of the requesting user's negotiator DM
   * for `intentId`, most recent last. Never throws; resolves `[]` when the flag
   * is off, when there is no DM pinned to that signal, or when anything fails.
   */
  async retrieveForNegotiation(query: NegotiatorClientDmQuery): Promise<NegotiatorClientDmMessage[]> {
    if (!isNegotiatorClientDmInjectEnabled()) return [];
    const intentId = query.intentId?.trim();
    if (!query.userId || !intentId) return [];

    try {
      const [scope] = await db
        .select({ conversationId: schema.chatSessionScopes.conversationId })
        .from(schema.chatSessionScopes)
        .where(
          and(
            eq(schema.chatSessionScopes.userId, query.userId),
            eq(schema.chatSessionScopes.scopeType, NEGOTIATOR_INTENT_SCOPE_TYPE),
            eq(schema.chatSessionScopes.scopeId, intentId),
          ),
        )
        .limit(1);

      // No DM pinned to this signal. Expected, not exceptional.
      if (!scope) return [];

      // Newest-first read so the cap keeps the RECENT tail, then reversed so
      // the caller receives the excerpt in reading order.
      const rows = await db
        .select({ role: schema.messages.role, parts: schema.messages.parts })
        .from(schema.messages)
        .where(eq(schema.messages.conversationId, scope.conversationId))
        .orderBy(desc(schema.messages.createdAt), desc(schema.messages.id))
        .limit(MAX_DM_MESSAGES);

      const excerpt = rows
        .reverse()
        .map((row) => ({
          role: row.role === 'agent' ? ('agent' as const) : ('client' as const),
          content: messageText(row.parts),
        }))
        // Tool-only / attachment-only turns carry no text worth grounding on.
        .filter((message) => message.content.length > 0);

      if (excerpt.length > 0) {
        logger.debug('Negotiator client DM retrieved for negotiation', {
          userId: query.userId,
          intentId,
          messages: excerpt.length,
        });
      }
      return excerpt;
    } catch (err) {
      logger.error('Negotiator client DM retrieval failed; proceeding without it', {
        userId: query.userId,
        intentId,
        error: err instanceof Error ? err.message : String(err),
      });
      return [];
    }
  }
}

export const negotiatorClientDmRetrievalAdapter = new NegotiatorClientDmRetrievalAdapter();

/**
 * The `NegotiatorClientDmRetrieveFn` handed to negotiation-graph composition
 * roots. Always defined — the flag is checked per call, so a flag flip takes
 * effect on restart without re-wiring (same pattern as the memory read path).
 */
export function negotiatorClientDmRetrieve(): NegotiatorClientDmRetrieveFn {
  return (query) => negotiatorClientDmRetrievalAdapter.retrieveForNegotiation(query);
}
