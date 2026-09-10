import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { PrincipalMessage, PrincipalState, PrincipalStore } from '@indexnetwork/agent';

interface Envelope {
  state: PrincipalState | null;
  messages: PrincipalMessage[];
  /** H2A entries already handed to the owner, so a restart never repeats them. */
  delivered: string[];
}

/**
 * One JSON checkpoint per principal and signal, written atomically.
 *
 * The agent package owns `state` and `messages` entirely; the Hermes plugin
 * never interprets them. `delivered` belongs to this runtime and rides in the
 * same envelope so a checkpoint and its delivery record cannot diverge.
 */
export class FilePrincipalStore implements PrincipalStore {
  private envelope: Envelope = { state: null, messages: [], delivered: [] };
  private writing: Promise<void> = Promise.resolve();

  constructor(private readonly path: string) {}

  /** @returns The saved session, or an empty one on this signal's first run. */
  async load(): Promise<{ state: PrincipalState | null; messages: PrincipalMessage[] }> {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as Envelope;
      this.envelope = { state: saved.state ?? null, messages: saved.messages ?? [], delivered: saved.delivered ?? [] };
    } catch {
      // No checkpoint yet, or an unreadable one: start this signal fresh.
    }
    return { state: this.envelope.state, messages: this.envelope.messages };
  }

  /** @param state - The resumable inbox. @param messages - The canonical H2A transcript. */
  async save(state: PrincipalState, messages: readonly PrincipalMessage[]): Promise<void> {
    this.envelope.state = state;
    this.envelope.messages = [...messages];
    await this.flush();
  }

  /** @param id - An H2A entry. @returns Whether the owner has already received it. */
  delivered(id: string): boolean {
    return this.envelope.delivered.includes(id);
  }

  /** @param ids - H2A entries the owner received, or that are no longer deliverable. */
  async markDelivered(ids: readonly string[]): Promise<void> {
    this.envelope.delivered.push(...ids);
    await this.flush();
  }

  /** @returns When every queued write has landed. */
  async close(): Promise<void> {
    await this.writing;
  }

  private flush(): Promise<void> {
    const write = this.writing.then(async () => {
      await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
      const temporary = `${this.path}.tmp`;
      await writeFile(temporary, JSON.stringify(this.envelope), { mode: 0o600 });
      await rename(temporary, this.path);
    });
    this.writing = write.then(() => {}, () => {});
    return write;
  }
}
