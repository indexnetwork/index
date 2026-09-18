import { createHash } from 'node:crypto';

import type { NegotiationOpeningRequest, OpenNegotiationResult } from './discovery.types.ts';
import type { Intent, Negotiation } from './negotiation.agent.ts';
import type { PrincipalMessage, PrincipalQuestion } from './principal.inbox.ts';

/** An H2A-authored mandate available to new negotiations for one intent. */
export interface PrincipalStandingBrief {
  id: string;
  brief: string;
  sourceMessageId: string;
  createdAt: string;
}

/** An explicit private instruction issued by H2A for one opportunity. */
export interface PrincipalDelegation {
  id: string;
  opportunityId: string;
  brief: string;
  sourceMessageId: string | null;
  createdAt: string;
  opening?: { networkId: string; candidateIntentId: string; candidateUserId: string; reasoning: string; requestKey: string };
}

/** Authoritative records with separate H2A-effect and brief-relevant A2A fences. */
export interface PrincipalRecordsView {
  intent: Intent;
  principalContext: string;
  messages: PrincipalMessage[];
  retiredQuestionIds: string[];
  standingBrief: PrincipalStandingBrief | null;
  delegations: PrincipalDelegation[];
  version: string;
  executionVersion: string;
}

/** Outputs of an accepted input or one H2A review, committed together. */
export interface PrincipalEffects {
  negotiations: Pick<Negotiation, 'opportunityId' | 'opportunityStatus' | 'turnCount' | 'outcome' | 'awaitingUserId'>[];
  messages: PrincipalMessage[];
  retiredQuestionIds: string[];
  delegations: PrincipalDelegation[];
}

/** Host-owned records and execution ownership; no model or scheduling state is saved. */
export interface PrincipalRecords {
  start(): Promise<void>;
  read(): Promise<PrincipalRecordsView>;
  accept(messages: readonly PrincipalMessage[]): Promise<readonly PrincipalMessage[] | null>;
  writeStandingBrief(brief: PrincipalStandingBrief, expectedVersion: string): Promise<boolean>;
  write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean>;
  close(): Promise<void>;
}

/** @param records - Canonical question, answer and retirement records. @returns The exact unanswered, unretired questions in issuance order. */
export function pendingPrincipalQuestions(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds'>): PrincipalQuestion[] {
  const resolved = new Set(records.retiredQuestionIds);
  for (const message of records.messages) if (message.kind === 'answer' && message.questionId) resolved.add(message.questionId);
  return records.messages
    .filter((message) => message.kind === 'question' && !resolved.has(message.questionId!))
    .map((message) => ({ id: message.questionId!, batchId: message.batchId!, question: message.text, options: message.options }));
}

/** @param messages - Chronological H2A records. @returns The latest accepted user input or explicit lifecycle activation identity. */
export function latestPrincipalInput(messages: readonly PrincipalMessage[]): string | undefined {
  return messages.findLast((message) => message.kind === 'user' || message.kind === 'answer' || message.kind === 'event')?.id;
}

/** @param brief - H2A-authored private mandate. @param messages - Canonical input history. @returns Whether no later principal message or answer superseded the brief. */
export function isPrincipalBriefCurrent(brief: Pick<PrincipalStandingBrief, 'sourceMessageId'> | Pick<PrincipalDelegation, 'sourceMessageId'>, messages: readonly PrincipalMessage[]): boolean {
  if (!brief.sourceMessageId) return false;
  const source = messages.findIndex((message) => message.id === brief.sourceMessageId);
  return source >= 0 && !messages.slice(source + 1).some((message) => message.kind === 'user' || message.kind === 'answer');
}

/** @param records - Current brief records and shared execution fence. @param opportunityId - Negotiation whose applicable brief is being used. @returns A fence unaffected by briefs for other negotiations. */
export function briefExecutionVersion(records: Pick<PrincipalRecordsView, 'standingBrief' | 'delegations' | 'executionVersion'>, opportunityId: string): string {
  const brief = records.delegations.findLast((entry) => entry.opportunityId === opportunityId) ?? records.standingBrief;
  return JSON.stringify([records.executionVersion, brief?.id ?? null]);
}

/** @param records - Current private outputs. @param brief - Proposed standing mandate. @returns Whether it is a new, current H2A output. */
export function validStandingBrief(records: Pick<PrincipalRecordsView, 'messages' | 'standingBrief' | 'delegations'>, brief: PrincipalStandingBrief): boolean {
  const source = latestPrincipalInput(records.messages);
  return Boolean(brief.brief.trim()) && Boolean(source) && brief.sourceMessageId === source
    && brief.id !== records.standingBrief?.id
    && !records.messages.some((entry) => entry.id === brief.id)
    && !records.delegations.some((entry) => entry.id === brief.id);
}

/** @param request - Immutable runtime selection. @returns A private retry fingerprint, without copying source context into delegation history. */
export function openingRequestKey(request: NegotiationOpeningRequest): string {
  const binding = [
    request.id, request.expectedLatestNegotiationId, request.expectedLatestOutcome, request.expectedLatestOpportunityStatus,
    request.target.networkId, request.target.intentId, request.target.userId, request.target.payload,
    request.source.kind === 'search' ? ['search', request.source.searchId, request.source.similarity] : ['negotiation', request.source.negotiationId],
    request.reasoning, request.brief, request.sourceMessageId, request.contextVersion, request.scopeVersion,
  ];
  return createHash('sha256').update(JSON.stringify(binding)).digest('hex');
}

/** @param request - Runtime-bound opening instruction. @param opportunityId - Canonical pair result. @param records - Source history. @returns The private output committed with the pair. */
export function openingDelegation(request: NegotiationOpeningRequest, opportunityId: string, records: PrincipalRecordsView): PrincipalDelegation {
  const { target, reasoning, brief, id, sourceMessageId } = request;
  return {
    id, opportunityId, brief, sourceMessageId,
    createdAt: new Date(Math.max(Date.now(), ...[...records.messages, ...records.delegations, ...(records.standingBrief ? [records.standingBrief] : [])].map((entry) => Date.parse(entry.createdAt))) + 1).toISOString(),
    opening: { networkId: target.networkId, candidateIntentId: target.intentId, candidateUserId: target.userId, reasoning, requestKey: openingRequestKey(request) },
  };
}

/** @param records - Canonical history and question status. @param questionIds - Exact pending IDs selected by H2A. @returns Whether retirement can be based on later principal evidence, never lifecycle activity. */
export function validPrincipalQuestionRetirements(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds'>, questionIds: readonly string[]): boolean {
  if (!Array.isArray(questionIds) || new Set(questionIds).size !== questionIds.length) return false;
  if (!questionIds.length) return true;
  const inputId = latestPrincipalInput(records.messages);
  const input = records.messages.find((message) => message.id === inputId);
  if (input?.kind === 'event' && input.activation?.type !== 'h2a.wake') return false;
  const pending = pendingPrincipalQuestions(records);
  return questionIds.every((id) => {
    if (!pending.some((question) => question.id === id)) return false;
    const issued = records.messages.findIndex((message) => message.kind === 'question' && message.questionId === id);
    return records.messages.slice(issued + 1).some((message) => message.kind === 'user' || message.kind === 'answer');
  });
}

/** @param records - Current records. @param effects - Atomic outputs. @returns Whether input and question identities remain valid. */
export function validPrincipalEffects(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds' | 'standingBrief' | 'delegations'>, effects: PrincipalEffects): boolean {
  if (!validPrincipalQuestionRetirements(records, effects.retiredQuestionIds)) return false;
  const pending = pendingPrincipalQuestions(records).filter((question) => !effects.retiredQuestionIds.includes(question.id));
  const questions = effects.messages.filter((message) => message.kind === 'question');
  const ids = [...effects.messages, ...effects.delegations].map((entry) => entry.id);
  const existingIds = new Set([...records.messages, ...records.delegations, ...(records.standingBrief ? [records.standingBrief] : [])].map((entry) => entry.id));
  if (new Set(ids).size !== ids.length || ids.some((id) => existingIds.has(id))) return false;
  if (effects.messages.some((message) => !['message', 'question'].includes(message.kind) || !message.text.trim())) return false;
  if (questions.length > 3 || new Set(questions.map((question) => question.questionId)).size !== questions.length) return false;
  if (questions.some((question) => !question.questionId || !question.batchId || question.matches.length > 0 || question.scope !== undefined
    || records.messages.some((message) => message.questionId === question.questionId || message.batchId === question.batchId))) return false;
  if (questions.length && (pending.length > 0 || new Set(questions.map((question) => question.batchId)).size !== 1)) return false;
  const source = latestPrincipalInput(records.messages);
  if (new Set(effects.delegations.map((entry) => entry.opportunityId)).size !== effects.delegations.length) return false;
  return effects.delegations.every((delegation) => Boolean(source) && delegation.sourceMessageId === source && Boolean(delegation.brief.trim()));
}

/** @param records - Canonical history and question status. @param inputs - One direct input/event or the complete answer batch. @returns Validated inputs with exact question evidence, or null; callers commit all or nothing. */
export function acceptedPrincipalMessages(records: Pick<PrincipalRecordsView, 'messages' | 'retiredQuestionIds'>, inputs: readonly PrincipalMessage[]): PrincipalMessage[] | null {
  if (!inputs.length || new Set(inputs.map((input) => input.id)).size !== inputs.length) return null;
  if (inputs.some((input) => !['user', 'answer', 'event'].includes(input.kind) || !input.text.trim()
    || records.messages.some((message) => message.id === input.id))) return null;
  const answering = inputs[0]!.kind === 'answer';
  if (answering) {
    const pending = pendingPrincipalQuestions(records);
    if (pending.length !== inputs.length || new Set(inputs.map((input) => input.questionId)).size !== inputs.length
      || inputs.some((input) => input.kind !== 'answer' || !pending.some((question) => question.id === input.questionId))) return null;
  } else if (inputs.length !== 1 || inputs[0]!.questionId !== undefined || inputs[0]!.batchId !== undefined) return null;
  for (const input of inputs) {
    if (input.kind === 'event') {
      if (!input.activation || input.id !== input.activation.id || !['intent.created', 'intent.broadcast', 'intent.resumed', 'h2a.wake'].includes(input.activation.type)
        || input.activation.type === 'intent.broadcast' && !input.activation.networkId
        || input.activation.type === 'intent.resumed' && !Number.isSafeInteger(input.activation.lifecycleVersionMs)) return null;
    } else if (input.activation) return null;
  }
  const previous = records.messages.at(-1);
  let time = Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0);
  return inputs.map((input) => {
    const question = answering ? records.messages.find((message) => message.kind === 'question' && message.questionId === input.questionId) : undefined;
    return { ...input, text: input.text.trim(), batchId: question?.batchId, matches: question?.matches ?? [], scope: question?.scope,
      createdAt: new Date(time++).toISOString() };
  });
}

/** In-memory domain records for the disposable scenario host. */
export class MemoryPrincipalRecords implements PrincipalRecords {
  private readonly messages: PrincipalMessage[] = [];
  private readonly retiredQuestionIds: string[] = [];
  private readonly standingBriefs: PrincipalStandingBrief[] = [];
  private standingBriefId?: string;
  private readonly delegations: PrincipalDelegation[] = [];
  private writing: Promise<unknown> = Promise.resolve();

  constructor(private readonly principal: { intent: Intent; principalContext: string }, private readonly negotiations: () => Promise<Negotiation[]>) {}

  /** Whether this intent is ready for a new match, read synchronously during a scenario opening commit. */
  get hasStandingBrief(): boolean { return this.standingBriefId !== undefined; }

  /** Start the disposable host. */
  async start(): Promise<void> {}

  /** @returns Detached canonical records; reading produces no effects. */
  async read(): Promise<PrincipalRecordsView> {
    const standingBrief = this.standingBriefs.find((entry) => entry.id === this.standingBriefId) ?? null;
    const records = { ...this.principal, messages: this.messages, retiredQuestionIds: this.retiredQuestionIds, standingBrief, delegations: this.delegations };
    const execution = {
      intent: this.principal.intent,
      inputs: this.messages.filter((message) => message.kind === 'user' || message.kind === 'answer'),
    };
    return structuredClone({ ...records, version: JSON.stringify(records), executionVersion: JSON.stringify(execution) });
  }

  /** @param inputs - One user message/event or the complete answer batch. @returns Inputs committed together, or null without any write. */
  accept(inputs: readonly PrincipalMessage[]): Promise<readonly PrincipalMessage[] | null> {
    const write = this.writing.then(async () => {
      const accepted = acceptedPrincipalMessages(await this.read(), inputs);
      if (accepted) {
        this.messages.push(...structuredClone(accepted));
        if (accepted[0]!.kind !== 'event') this.standingBriefId = undefined;
      }
      return accepted;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param brief - Complete intent-wide mandate. @param expectedVersion - Its source records. @returns False for stale or duplicate effects. */
  writeStandingBrief(brief: PrincipalStandingBrief, expectedVersion: string): Promise<boolean> {
    const write = this.writing.then(async () => {
      const records = await this.read();
      if (records.version !== expectedVersion || !validStandingBrief(records, brief)) return false;
      this.standingBriefs.push(structuredClone(brief));
      this.standingBriefId = brief.id;
      return true;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param effects - Explicit outputs. @param expectedVersion - Their source records. @returns False for stale or duplicate effects. */
  write(effects: PrincipalEffects, expectedVersion: string): Promise<boolean> {
    const write = this.writing.then(async () => {
      const current = await this.negotiations();
      if (effects.negotiations.some((expected) => !current.some((record) => record.opportunityId === expected.opportunityId && record.opportunityStatus === expected.opportunityStatus && record.turnCount === expected.turnCount && record.outcome === expected.outcome && record.awaitingUserId === expected.awaitingUserId))) return false;
      if (effects.delegations.some((entry) => !current.some((record) => record.opportunityId === entry.opportunityId && !record.settledAt && record.opportunityStatus === 'negotiating'))) return false;
      const records = await this.read();
      if (records.version !== expectedVersion || !validPrincipalEffects(records, effects)) return false;
      this.messages.push(...structuredClone(effects.messages));
      this.retiredQuestionIds.push(...effects.retiredQuestionIds);
      this.delegations.push(...structuredClone(effects.delegations));
      return true;
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** @param request - Exact selected opening and its source context. @param open - Synchronous host pair operation; null means unavailable. @returns Pair and delegation committed together, or unavailable. @throws When source records changed. */
  openNegotiation(request: NegotiationOpeningRequest, open: () => { opportunityId: string; created: boolean } | null): Promise<OpenNegotiationResult> {
    const write = this.writing.then(async (): Promise<OpenNegotiationResult> => {
      const records = await this.read();
      const replay = records.delegations.find((entry) => entry.id === request.id);
      if (replay) {
        if (replay.opening?.requestKey !== openingRequestKey(request)) throw new Error('Opening request identity was reused.');
        return { status: 'opened', opportunityId: replay.opportunityId, delegationId: replay.id, contextVersion: records.version };
      }
      if (records.version !== request.contextVersion || latestPrincipalInput(records.messages) !== request.sourceMessageId) throw new Error('Principal context changed; discard this opening.');
      if (!request.brief.trim() || !request.reasoning.trim() || request.reasoning.length > 2000) throw new Error('An opening needs reasoning and a complete private brief.');
      const result = open();
      if (!result) return { status: 'unavailable' };
      const { opportunityId } = result;
      let delegationId: string | undefined;
      if (result.created) {
        const delegation = openingDelegation(request, opportunityId, records);
        this.delegations.push(delegation);
        delegationId = delegation.id;
      }
      return { status: 'opened', opportunityId, contextVersion: (await this.read()).version, ...(delegationId ? { delegationId } : {}) };
    });
    this.writing = write.catch(() => {});
    return write;
  }

  /** Close the disposable host without erasing its records. */
  async close(): Promise<void> {}
}
