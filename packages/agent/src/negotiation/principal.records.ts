import type { Intent, Negotiation } from './negotiation.agent.ts';
import type { PrincipalMessage, PrincipalQuestion } from './principal.inbox.ts';

/** An explicit private instruction issued by H2A for one opportunity. */
export interface PrincipalDelegation {
  id: string;
  opportunityId: string;
  brief: string;
  sourceMessageId: string | null;
  createdAt: string;
}

/** Authoritative records for one activation; version fences effects against these records. */
export interface PrincipalRecordsView {
  intent: Intent;
  principalContext: string;
  messages: PrincipalMessage[];
  retiredQuestionIds: string[];
  delegations: PrincipalDelegation[];
  version: string;
}

/** Outputs of an accepted input or one H2A review, committed together. */
export interface PrincipalEffects {
  negotiations: Pick<Negotiation, 'opportunityId' | 'turnCount' | 'outcome' | 'awaitingUserId'>[];
  messages: PrincipalMessage[];
  delegations: PrincipalDelegation[];
}

/** Host-owned records and execution ownership; no model or scheduling state is saved. */
export interface PrincipalRecords {
  start(): Promise<void>;
  read(): Promise<PrincipalRecordsView>;
  accept(message: PrincipalMessage): Promise<PrincipalMessage | null>;
  write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean>;
  close(): Promise<void>;
}

/** @param records - Canonical question, answer and retirement records. @returns The exact unresolved question. */
export function pendingPrincipalQuestion(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds'>): PrincipalQuestion | null {
  const resolved = new Set(records.retiredQuestionIds);
  for (const message of records.messages) if (message.kind === 'answer' && message.questionId) resolved.add(message.questionId);
  const question = records.messages.findLast((message) => message.kind === 'question' && message.questionId && !resolved.has(message.questionId));
  return question ? { id: question.questionId!, question: question.text, options: question.options } : null;
}

/** @param messages - Chronological H2A history. @returns The latest accepted principal input identity. */
export function latestPrincipalInput(messages: readonly PrincipalMessage[]): string | undefined {
  return messages.findLast((message) => message.kind === 'user' || message.kind === 'answer')?.id;
}

/** @param records - Current records. @param effects - Atomic outputs. @returns Whether input and question identities remain valid. */
export function validPrincipalEffects(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds' | 'delegations'>, effects: PrincipalEffects): boolean {
  const pending = pendingPrincipalQuestion(records);
  const questions = effects.messages.filter((message) => message.kind === 'question');
  const ids = [...effects.messages, ...effects.delegations].map((entry) => entry.id);
  const existingIds = new Set([...records.messages, ...records.delegations].map((entry) => entry.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => existingIds.has(id))) return false;
  if (effects.messages.some((message) => !['message', 'question'].includes(message.kind) || !message.text.trim())) return false;
  if (questions.length > 1 || questions.some((question) => !question.questionId || records.messages.some((message) => message.questionId === question.questionId))) return false;
  if (questions.length && pending) return false;
  const source = latestPrincipalInput(records.messages);
  if (new Set(effects.delegations.map((entry) => entry.opportunityId)).size !== effects.delegations.length) return false;
  return effects.delegations.every((delegation) => Boolean(source) && delegation.sourceMessageId === source && Boolean(delegation.brief.trim()));
}

/** @param records - Canonical history and question status. @param input - Principal input. @returns Validated input with the exact question's evidence, or null. */
export function acceptedPrincipalMessage(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds'>, input: PrincipalMessage): PrincipalMessage | null {
  if (!['user', 'answer'].includes(input.kind) || !input.text.trim() || records.messages.some((message) => message.id === input.id)) return null;
  const pending = pendingPrincipalQuestion(records);
  if (input.kind === 'answer' ? !input.questionId || pending?.id !== input.questionId : pending !== null) return null;
  const question = input.kind === 'answer' ? records.messages.find((message) => message.kind === 'question' && message.questionId === input.questionId) : undefined;
  const previous = records.messages.at(-1);
  return { ...input, text: input.text.trim(), matches: question?.matches ?? [], scope: question?.scope,
    createdAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString() };
}

/** In-memory domain records for the disposable scenario host. */
export class MemoryPrincipalRecords implements PrincipalRecords {
  private readonly messages: PrincipalMessage[] = [];
  private readonly retiredQuestionIds: string[] = [];
  private readonly delegations: PrincipalDelegation[] = [];
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly principal: { intent: Intent; principalContext: string }, private readonly negotiations: () => Promise<Negotiation[]>) {}

  /** Start the disposable host. */
  async start(): Promise<void> {}

  /** @returns Detached canonical records; reading produces no effects. */
  async read(): Promise<PrincipalRecordsView> {
    const records = { ...this.principal, messages: this.messages, retiredQuestionIds: this.retiredQuestionIds, delegations: this.delegations };
    return structuredClone({ ...records, version: JSON.stringify(records) });
  }

  /** @param input - New user message or exact-question answer. @returns Accepted input, independent of concurrent assistant outputs. */
  accept(input: PrincipalMessage): Promise<PrincipalMessage | null> {
    const write = this.writing.then(async () => {
      const accepted = acceptedPrincipalMessage(await this.read(), input);
      if (accepted) this.messages.push(structuredClone(accepted));
      return accepted;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param effects - Explicit outputs. @param expectedVersion - Their source records. @returns False for stale or duplicate effects. */
  write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean> {
    const write = this.writing.then(async () => {
      const current = await this.negotiations();
      if (effects.negotiations.some((expected) => !current.some((record) => record.opportunityId === expected.opportunityId && record.turnCount === expected.turnCount && record.outcome === expected.outcome && record.awaitingUserId === expected.awaitingUserId))) return false;
      if (effects.delegations.some((entry) => !current.some((record) => record.opportunityId === entry.opportunityId && !record.settledAt))) return false;
      const records = await this.read();
      if (records.version !== expectedVersion || !validPrincipalEffects(records, effects)) return false;
      this.messages.push(...structuredClone(effects.messages));
      this.delegations.push(...structuredClone(effects.delegations));
      return true;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** Close the disposable host without erasing its records. */
  async close(): Promise<void> {}
}
