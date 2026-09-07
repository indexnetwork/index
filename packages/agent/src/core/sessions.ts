import type { MessageStore } from "./types.ts";
import type { ModelMessage } from "./model.ts";

/**
 * The default `MessageStore`: in memory, per process.
 *
 * Good enough for one host process. A deployment that survives restarts,
 * or runs more than one instance, implements the interface over something
 * shared — the agent only ever reads and writes through it.
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
