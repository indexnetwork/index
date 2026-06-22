/**
 * ChatSummaryService — implements the protocol's ChatSummaryReader contract.
 * Orchestrates read-from-DB → summarize → write-to-DB on every call so callers
 * always get an up-to-date digest (or null if the session has no content yet).
 */
import { ChatContextDigestSchema, ChatSummarizer, getModelName } from '@indexnetwork/protocol';
import type { ChatContextDigest, ChatSummaryReader } from '@indexnetwork/protocol';

import { log } from '../lib/log';
import { ChatSummaryDatabaseAdapter, type ChatSummaryRow } from '../adapters/chat-summary.database.adapter';

const logger = log.service.from('ChatSummaryService');

/** Minimal summarizer shape — used as the constructor type so tests can inject a fake. */
export interface ChatSummarizerLike {
  summarize(input: {
    previousDigest: ChatContextDigest | null;
    newMessages: Array<{ role: 'user' | 'assistant'; content: string }>;
  }): Promise<ChatContextDigest | null>;
}

/**
 * Backend implementation of {@link ChatSummaryReader}. Reads the latest persisted
 * digest for a session, runs incremental summarization over any new messages,
 * and appends a fresh row when summarization succeeds.
 *
 * @remarks The default {@link ChatSummarizer} is constructed lazily on first
 * use of {@link getDigest}, not at service construction. This keeps module-load
 * free of `OPENROUTER_API_KEY` validation; callers that never invoke
 * summarization (or inject a fake summarizer) do not depend on the env var.
 */
export class ChatSummaryService implements ChatSummaryReader {
  private summarizer: ChatSummarizerLike | undefined;

  constructor(
    private readonly adapter: ChatSummaryDatabaseAdapter,
    injectedSummarizer?: ChatSummarizerLike,
  ) {
    this.summarizer = injectedSummarizer;
  }

  /** Lazily constructs the default summarizer on first use. */
  private getSummarizer(): ChatSummarizerLike {
    if (!this.summarizer) {
      this.summarizer = new ChatSummarizer();
    }
    return this.summarizer;
  }

  /**
   * Returns the freshest digest for a session, running summarization if needed.
   *
   * @param sessionId - The conversation (chat session) id.
   * @returns The up-to-date digest, the previous digest when no new content
   *   warrants an update, or `null` when there is nothing to summarize.
   */
  async getDigest(sessionId: string): Promise<ChatContextDigest | null> {
    let prev: ChatSummaryRow | null;
    try {
      prev = await this.adapter.getLatest(sessionId);
    } catch (err) {
      logger.warn('chat-summary getLatest failed', { sessionId, error: errString(err) });
      return null;
    }

    // Validate prev once. If the persisted digest is malformed, treat the session
    // as if there were no prior summary at all: re-summarize from the first
    // message (cursor=null, fromAnchor=null) rather than appending onto a `null`
    // previousDigest with an outdated cursor.
    const previousDigest = digestOf(prev);
    const cursor = previousDigest ? prev?.toMessageId ?? null : null;
    const fromAnchor = previousDigest ? prev?.fromMessageId ?? null : null;

    let newMessages: Awaited<ReturnType<ChatSummaryDatabaseAdapter['getMessagesAfter']>>;
    try {
      newMessages = await this.adapter.getMessagesAfter(sessionId, cursor);
    } catch (err) {
      logger.warn('chat-summary getMessagesAfter failed', { sessionId, error: errString(err) });
      return previousDigest;
    }

    if (newMessages.length === 0) {
      return previousDigest;
    }

    let digest: ChatContextDigest | null;
    try {
      digest = await this.getSummarizer().summarize({
        previousDigest,
        newMessages: newMessages.map((m) => ({ role: m.role, content: m.content })),
      });
    } catch (err) {
      logger.warn('chat-summary summarizer threw', { sessionId, error: errString(err) });
      return previousDigest;
    }

    if (!digest) {
      return previousDigest;
    }

    try {
      await this.adapter.insertSummary({
        sessionId,
        fromMessageId: fromAnchor ?? newMessages[0].id,
        toMessageId: newMessages[newMessages.length - 1].id,
        digest,
        model: getModelName('chatContextSummarizer'),
      });
    } catch (err) {
      logger.warn('chat-summary insertSummary failed', { sessionId, error: errString(err) });
      // Still return the fresh digest — caller benefits even if persistence fails.
    }

    return digest;
  }
}

function errString(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/**
 * Bridge the adapter's local `SummaryDigestRow` type to the protocol's
 * `ChatContextDigest`. Adapters cannot import protocol types (layering rule),
 * so we validate via Zod at this boundary instead of trusting the raw JSONB.
 * Malformed rows (older data, manual edits, partial writes) yield `null`, which
 * callers treat as "no usable previous digest" — fresh summarization will run.
 */
function digestOf(row: ChatSummaryRow | null): ChatContextDigest | null {
  if (!row) return null;
  const parsed = ChatContextDigestSchema.safeParse(row.digest);
  if (!parsed.success) {
    logger.warn('chat-summary digest failed schema validation', {
      summaryId: row.id,
      conversationId: row.conversationId,
      error: parsed.error.message,
    });
    return null;
  }
  return parsed.data;
}
