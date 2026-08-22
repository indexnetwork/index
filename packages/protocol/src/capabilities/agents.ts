import { ChatGraphFactory } from "../internal/chat/chat.graph.js";

import type { ChatGraphCompositeDatabase } from "../platform/database.js";
import type { Embedder } from "../platform/discovery/embedder.js";
import type { Scraper } from "../platform/discovery/scraper.js";
import type { ChatSessionReader } from "../platform/chat/ports.js";
import type { ProtocolDeps } from "../internal/shared/agent/tool.helpers.js";
import type { ChatPersonaConfig } from "../internal/chat/chat.persona.js";

/** Host ports required to construct the chat-agent graph. */
export interface AgentsDeps {
  database: ChatGraphCompositeDatabase;
  embedder: Embedder;
  scraper: Scraper;
  chatSession: ChatSessionReader;
  protocol: ProtocolDeps;
}

/** Executable agent capability: builds chat graphs from host-provided ports. */
export class Agents {
  constructor(private readonly deps: AgentsDeps) {}

  public createChatGraph(persona: ChatPersonaConfig): ChatGraphFactory {
    const { database, embedder, scraper, chatSession, protocol } = this.deps;
    return new ChatGraphFactory(database, embedder, scraper, chatSession, protocol, persona);
  }
}
