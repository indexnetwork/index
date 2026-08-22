import { ChatGraphFactory } from "../internal/chat/chat.graph.js";

import type { ChatGraphCompositeDatabase } from "../platform/database.js";
import type { Embedder } from "../platform/discovery/embedder.js";
import type { Scraper } from "../platform/discovery/scraper.js";
import type { ChatSessionReader } from "../platform/chat/ports.js";
import type { ProtocolDeps } from "../internal/shared/agent/tool.helpers.js";
import { createSignalPersona, type SignalPersonaOptions } from "../internal/chat/signal.persona.js";

/** Host ports required to construct the chat-agent graph. */
export interface AgentsDeps {
  database: ChatGraphCompositeDatabase;
  embedder: Embedder;
  scraper: Scraper;
  chatSession: ChatSessionReader;
  protocol: ProtocolDeps;
}

/** The one human-facing agent surface: a user's personal-agent chat. */
export class PersonalAgentChat {
  constructor(private readonly deps: AgentsDeps) {}

  /** Creates a global or intent-scoped personal-agent chat graph. */
  public createGraph(identity: SignalPersonaOptions = {}): ChatGraphFactory {
    const { database, embedder, scraper, chatSession, protocol } = this.deps;
    return new ChatGraphFactory(database, embedder, scraper, chatSession, protocol, createSignalPersona(identity));
  }
}
