import { log } from '../lib/log';
import { ChatDatabaseAdapter } from '../adapters/database.adapter';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { ScraperAdapter } from '../adapters/scraper.adapter';
import { ChatGraphFactory } from '../lib/protocol/graphs/chat.graph';
import { ChatTitleGenerator } from '../lib/protocol/agents/chat.title.generator';
import type { ChatGraphCompositeDatabase } from '../lib/protocol/interfaces/database.interface';
import type { Embedder } from '../lib/protocol/interfaces/embedder.interface';
import type { Scraper } from '../lib/protocol/interfaces/scraper.interface';

const logger = log.service.from("ChatSessionService");

/**
 * ChatSessionService
 *
 * Thin wrapper around the ChatGraphFactory for SSE sideband streaming.
 * Session/message persistence has been removed -- XMTP handles message storage.
 * This service exposes:
 *   - getGraphFactory()  -- for controllers/agents that need to stream chat events
 *   - generateTitle()    -- generates a short suggested title from a user/assistant exchange
 */
export class ChatSessionService {
  private graphDb: ChatGraphCompositeDatabase;
  private embedder: Embedder;
  private scraper: Scraper;
  private _factory: ChatGraphFactory | null = null;

  constructor() {
    // Initialize protocol adapters for graph processing
    this.graphDb = new ChatDatabaseAdapter();
    this.embedder = new EmbedderAdapter();
    this.scraper = new ScraperAdapter();
    // Factory created lazily to avoid circular dependency: chat.graph imports this service.
  }

  private get factory(): ChatGraphFactory {
    if (!this._factory) {
      this._factory = new ChatGraphFactory(this.graphDb, this.embedder, this.scraper);
    }
    return this._factory;
  }

  /**
   * Get the chat graph factory for streaming operations.
   * This is used by controllers that need to stream chat events.
   *
   * @returns The ChatGraphFactory instance
   */
  getGraphFactory(): ChatGraphFactory {
    return this.factory;
  }

  /**
   * Generate a suggested title from a user message and assistant response.
   *
   * @param userMessage - The user's message content
   * @param assistantResponse - The assistant's response content
   * @returns The generated title or undefined if generation fails
   */
  async generateTitle(userMessage: string, assistantResponse: string): Promise<string | undefined> {
    if (!userMessage.trim() || !assistantResponse.trim()) {
      return undefined;
    }

    try {
      const titleGenerator = new ChatTitleGenerator();
      const title = await titleGenerator.invoke({
        messages: [
          { role: 'user', content: userMessage },
          { role: 'assistant', content: assistantResponse },
        ],
      });

      logger.info('Title generated', { title });
      return title;
    } catch (err) {
      logger.warn('Failed to generate title', {
        error: err instanceof Error ? err.message : String(err),
      });
      return undefined;
    }
  }
}

export const chatSessionService = new ChatSessionService();
