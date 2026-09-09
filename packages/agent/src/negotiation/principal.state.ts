import type { Negotiation } from './negotiation.agent.ts';
import type { InboxState, PrincipalMessage } from './principal.inbox.ts';

/** Private runtime state; the host persists it without interpreting agent decisions. */
export interface PrincipalState {
  inbox: InboxState;
  matches: { opportunityId: string; record?: Negotiation; reviewNote?: string; reported?: string }[];
}

/** One exclusively owned principal/intent session. Saves include new H2A entries in the same transaction. */
export interface PrincipalStore {
  load(): Promise<{ state: PrincipalState | null; messages: PrincipalMessage[] }>;
  save(state: PrincipalState, messages: readonly PrincipalMessage[]): Promise<void>;
  close(): Promise<void>;
}

/** Disposable persistence for the local scenario host, using the same runtime contract. */
export class MemoryPrincipalStore implements PrincipalStore {
  private state: PrincipalState | null = null;
  private messages: PrincipalMessage[] = [];

  /** @returns A detached checkpoint and its H2A transcript. */
  async load() { return structuredClone({ state: this.state, messages: this.messages }); }
  /** @param state - Complete checkpoint. @param messages - Newly committed H2A messages. */
  async save(state: PrincipalState, messages: readonly PrincipalMessage[]) {
    this.state = structuredClone(state);
    this.messages.push(...structuredClone(messages));
  }
  /** Release the disposable session. */
  async close() {}
}
