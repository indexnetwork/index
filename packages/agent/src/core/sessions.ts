import type { MessageStore, NegotiationSession, NegotiationStore } from "./types.ts";
import type { ModelMessage } from "./model.ts";

/**
 * The default `NegotiationStore`: in memory, per process.
 *
 * Good enough for one host process, and the same trade-off the A2A
 * `TaskStore` makes. A deployment that survives restarts, or runs more than
 * one instance, implements the interface over something shared — the agent
 * only ever reads and writes through it.
 */
export class MemoryNegotiationStore implements NegotiationStore {
  private readonly sessions = new Map<string, NegotiationSession>();

  get(id: string): NegotiationSession | undefined {
    return this.sessions.get(id);
  }

  save(session: NegotiationSession): void {
    // Re-inserted so `list()` ends with whatever moved most recently.
    this.sessions.delete(session.id);
    this.sessions.set(session.id, session);
  }

  list(): NegotiationSession[] {
    return [...this.sessions.values()];
  }

  delete(id: string): void {
    this.sessions.delete(id);
  }
}

/**
 * The default `MessageStore`: in memory, per process.
 *
 * Same trade-off as `MemoryNegotiationStore` — good enough for one host
 * process. A deployment that survives restarts, or runs more than one
 * instance, implements the interface over something shared.
 */
export class MemoryMessageStore implements MessageStore {
  private transcript: ModelMessage[] = [];

  list(): ModelMessage[] {
    return this.transcript;
  }

  save(messages: ModelMessage[]): void {
    this.transcript = messages;
  }
}
