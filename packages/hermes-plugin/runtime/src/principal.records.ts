import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

import { acceptedPrincipalMessages, isPrincipalBriefCurrent, validPrincipalEffects, validStandingBrief, type PrincipalDelegation, type PrincipalEffects, type PrincipalMessage, type PrincipalRecords, type PrincipalRecordsView, type PrincipalStandingBrief } from '@indexnetwork/agent';

import { IndexClient, type ExternalPrincipalMessage } from './client.ts';

interface Records {
  messages: PrincipalMessage[];
  retiredQuestionIds: string[];
  standingBrief: PrincipalStandingBrief | null;
  delegations: PrincipalDelegation[];
  withdrawals: ExternalPrincipalMessage[];
  delivered: string[];
}

/** Private domain records and delivery receipts; Hermes working sessions are never checkpoints or authority. */
export class FilePrincipalRecords implements PrincipalRecords {
  private saved: Records = { messages: [], retiredQuestionIds: [], standingBrief: null, delegations: [], withdrawals: [], delivered: [] };
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly path: string, private readonly client: IndexClient, private readonly intentId: string) {}

  /** Read durable records only. Startup does not resume an interrupted review. */
  async start(): Promise<void> {
    try {
      const saved = JSON.parse(await readFile(this.path, 'utf8')) as Records;
      if (!Array.isArray(saved.messages) || !Array.isArray(saved.delegations) || !Array.isArray(saved.retiredQuestionIds)
        || !Array.isArray(saved.withdrawals) || !Array.isArray(saved.delivered) || !Object.hasOwn(saved, 'standingBrief')) {
        throw new Error('Invalid principal records; preserve the file and repair it before restarting.');
      }
      this.saved = saved;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
    }
  }

  /** @returns Fresh Index evidence merged with this executor's private domain outputs. */
  async read(): Promise<PrincipalRecordsView> {
    const [intent, principal, remote] = await Promise.all([
      this.client.intent(this.intentId), this.client.principal(), this.client.agentConversation(this.intentId),
    ]);
    const retired = new Set([...this.saved.retiredQuestionIds, ...remote.retiredQuestionIds]);
    const messages = new Map(this.saved.messages.map((message) => [message.id, message]));
    for (const entry of remote.messages) {
      if (entry.kind === 'expire') {
        if (entry.questionId) retired.add(entry.questionId);
      } else {
        messages.set(entry.id, { ...entry, kind: entry.kind });
      }
    }
    const history = [...messages.values()].sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    const standingBrief = this.saved.standingBrief && isPrincipalBriefCurrent(this.saved.standingBrief, history) ? this.saved.standingBrief : null;
    const records = { intent, principalContext: principal.principalContext, messages: history,
      retiredQuestionIds: [...retired], standingBrief, delegations: this.saved.delegations };
    return structuredClone({ ...records, version: JSON.stringify(records),
      executionVersion: JSON.stringify({ intent, inputs: history.filter((entry) => entry.kind === 'user' || entry.kind === 'answer') }) });
  }

  /** @param inputs - Stable private activation receipts; owner messages are already canonical on Index. @returns Newly accepted receipts, or null on replay. */
  accept(inputs: readonly PrincipalMessage[]): Promise<readonly PrincipalMessage[] | null> {
    const write = this.writing.then(async () => {
      if (inputs.some((entry) => entry.kind !== 'event')) throw new Error('Send owner messages and complete answer batches through Index.');
      const accepted = acceptedPrincipalMessages(await this.read(), inputs);
      if (!accepted) return null;
      await this.persist({ ...this.saved, messages: [...this.saved.messages, ...accepted] });
      return accepted;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param brief - A complete private mandate. @param expectedVersion - Source evidence. @returns False when superseded before commit. */
  writeStandingBrief(brief: PrincipalStandingBrief, expectedVersion: string): Promise<boolean> {
    const write = this.writing.then(async () => {
      const current = await this.read();
      if (current.version !== expectedVersion || !validStandingBrief(current, brief)) return false;
      await this.persist({ ...this.saved, standingBrief: brief });
      return true;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param effects - Explicit review outputs. @param expectedVersion - Source context. @returns Whether the outputs and public delivery records committed together. */
  write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean> {
    const write = this.writing.then(async () => {
      const negotiations = await this.client.negotiationsForIntent(this.intentId);
      if (effects.negotiations.some((expected) => !negotiations.some((record) => record.opportunityId === expected.opportunityId
        && record.opportunityStatus === expected.opportunityStatus && record.turnCount === expected.turnCount
        && record.outcome === expected.outcome && record.awaitingUserId === expected.awaitingUserId))) return false;
      const current = await this.read();
      if (current.version !== expectedVersion || !validPrincipalEffects(current, effects)) return false;
      const withdrawals = effects.retiredQuestionIds.map((questionId): ExternalPrincipalMessage => ({
        id: crypto.randomUUID(), createdAt: new Date().toISOString(), kind: 'expire',
        text: 'This question was withdrawn.', questionId, matches: [],
      }));
      await this.persist({
        ...this.saved,
        messages: [...this.saved.messages, ...effects.messages],
        retiredQuestionIds: [...this.saved.retiredQuestionIds, ...effects.retiredQuestionIds],
        delegations: [...this.saved.delegations, ...effects.delegations],
        withdrawals: [...this.saved.withdrawals, ...withdrawals],
      });
      return true;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** Publish explicit outputs idempotently; a restart retries delivery, never the model work that authored them. */
  async publish(): Promise<void> {
    await this.writing;
    const entries: ExternalPrincipalMessage[] = [
      ...this.saved.messages.flatMap((entry): ExternalPrincipalMessage[] => entry.kind === 'question' || entry.kind === 'message' ? [{ ...entry, kind: entry.kind }] : []),
      ...this.saved.withdrawals,
    ].filter((entry) => !this.saved.delivered.includes(entry.id));
    if (!entries.length) return;
    await this.client.publishH2A(this.intentId, entries);
    const write = this.writing.then(async () => {
      await this.persist({ ...this.saved, delivered: [...this.saved.delivered, ...entries.map(({ id }) => id)] });
    });
    this.writing = write.catch(() => {});
    await write;
  }

  /** Finish local writes; domain records survive shutdown. */
  async close(): Promise<void> { await this.writing; }

  private async persist(next: Records): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, JSON.stringify(next), { mode: 0o600 });
    await rename(temporary, this.path);
    this.saved = next;
  }
}
