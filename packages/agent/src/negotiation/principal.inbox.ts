import { buildPrincipalInboxPrompt } from '../prompts/agent.prompt.ts';

import type { Agent } from '../core/agent.ts';
import { MemoryMessageStore } from '../core/sessions.ts';
import type { Tool } from '../core/tools.ts';
import type { PendingQuestion } from '../core/types.ts';

import type { Negotiation, User } from './negotiation.agent.ts';
import { latestPrincipalInput, pendingPrincipalQuestion, type PrincipalEffects, type PrincipalRecords, type PrincipalRecordsView } from './principal.records.ts';

export type QuestionScope = 'intent' | 'match';

export interface MatchReference {
  opportunityId: string;
  counterparty: User;
}

/** Canonical H2A entry. Historical scope and references retain the limits of earlier answers. */
export interface PrincipalMessage {
  id: string;
  createdAt: string;
  questionId?: string;
  kind: 'question' | 'answer' | 'user' | 'message';
  matches: readonly MatchReference[];
  text: string;
  scope?: QuestionScope;
  options?: string[];
}

/** An independently authored H2A question; negotiation activity cannot alter it. */
export interface PrincipalQuestion extends PendingQuestion { id: string }

interface Decision {
  message?: string;
  question?: PendingQuestion;
  delegations?: { opportunityId: string; brief: string }[];
}

/** Reconstructs H2A on accepted principal input and persists only explicit outputs. */
export class PrincipalInbox {
  private messages: PrincipalMessage[] = [];
  private currentQuestion: PrincipalQuestion | null = null;
  private running: Promise<void> = Promise.resolve();
  private accepting: Promise<unknown> = Promise.resolve();
  private reviewController?: AbortController;
  private stopped = false;

  constructor(
    private readonly createAgent: (records: PrincipalRecordsView) => Agent,
    private readonly records: PrincipalRecords,
    private readonly negotiations: () => Promise<Negotiation[]>,
    private readonly host: { changed(): void; input(): void; delegated(ids: string[]): void; error(reason: string): void },
  ) {}

  /** Read committed history and question status without activating H2A. */
  async refresh(): Promise<void> {
    const records = await this.records.read();
    this.messages = records.messages;
    const question = pendingPrincipalQuestion(records);
    if (question?.id !== this.currentQuestion?.id) this.currentQuestion = question;
  }

  private entry(records: PrincipalRecordsView, fields: Omit<PrincipalMessage, 'id' | 'createdAt' | 'matches'>): PrincipalMessage {
    const previous = records.messages.at(-1);
    return { id: crypto.randomUUID(), createdAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString(), matches: [], ...fields };
  }

  /** @returns The latest committed H2A history observed by this runtime. */
  get conversation(): readonly PrincipalMessage[] { return this.messages; }
  /** @returns The exact unretired, unanswered question derived from records. */
  get pending(): PrincipalQuestion | null { return this.currentQuestion; }

  /** @param text - Direct input when no question is displayed. @returns Committed input, or null when rejected. */
  message(text: string): Promise<PrincipalMessage | null> { return this.accept(text); }

  /** @param questionId - Exact displayed question. @param text - Complete answer. @returns Committed input, or null for stale or empty input. */
  answer(questionId: string, text: string): Promise<PrincipalMessage | null> { return this.accept(text, questionId); }

  private accept(text: string, questionId?: string): Promise<PrincipalMessage | null> {
    const accepted = this.accepting.then(async () => {
      if (this.stopped || !text.trim()) return null;
      const records = await this.records.read();
      const question = pendingPrincipalQuestion(records);
      if (questionId !== undefined ? questionId !== question?.id : question !== null) return null;
      const message = await this.records.accept(this.entry(records, { kind: questionId ? 'answer' : 'user', questionId, text: text.trim() }));
      if (!message) return null;
      this.host.input();
      this.reviewController?.abort();
      await this.refresh();
      this.host.changed();
      this.running = this.running.then(() => this.review(message));
      return message;
    });
    this.accepting = accepted.catch(() => {});
    return accepted;
  }

  /** Cancel model work; committed questions and history survive shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.reviewController?.abort();
    await this.accepting;
    await this.running;
  }

  private async review(input: PrincipalMessage): Promise<void> {
    if (this.stopped) return;
    const controller = new AbortController();
    this.reviewController = controller;
    try {
      const records = await this.records.read();
      if (latestPrincipalInput(records.messages) !== input.id) return;
      const negotiations = await this.negotiations();
      const pendingQuestion = pendingPrincipalQuestion(records);
      let decision: Decision | undefined;
      const tool: Tool<Decision> = {
        name: 'review_principal_inbox',
        description: 'Record one review: optionally reply, ask one independent question, and delegate selected negotiations. Empty input means wait silently. Briefs are private; only saved delegations resume A2A.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1 },
            question: { type: 'object', additionalProperties: false, properties: {
              question: { type: 'string', minLength: 1 },
              options: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', minLength: 1 } },
            }, required: ['question', 'options'] },
            delegations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              opportunityId: { type: 'string' }, brief: { type: 'string', minLength: 1, description: 'Objective, confirmed facts, applicable permission and limits, and next focus for this counterpart.' },
            }, required: ['opportunityId', 'brief'] } },
          },
        },
        run: (value) => {
          if (decision) throw new Error('Only one decision per review.');
          this.validate(value, pendingQuestion, negotiations);
          decision = value;
          return 'Decision recorded.';
        },
      };
      const result = await this.createAgent(records).run(buildPrincipalInboxPrompt({ records, input, pendingQuestion, negotiations }), {
        history: new MemoryMessageStore(), tools: [tool], maxSteps: 1, signal: controller.signal,
      });
      if (controller.signal.aborted || this.stopped) return;
      if (!decision) {
        const failed = result.steps.find((step) => step.kind === 'tool' && step.error);
        throw new Error(failed?.kind === 'tool' ? failed.error : 'The personal agent did not record a communication decision.');
      }
      const effects: PrincipalEffects = { negotiations, messages: [], delegations: [] };
      if (decision.message) effects.messages.push(this.entry(records, { kind: 'message', text: decision.message.trim() }));
      if (decision.question) effects.messages.push(this.entry({ ...records, messages: [...records.messages, ...effects.messages] }, {
        kind: 'question', questionId: crypto.randomUUID(), text: decision.question.question.trim(), options: decision.question.options,
      }));
      let delegationTime = Math.max(Date.now(), ...[...records.messages, ...records.delegations].map((entry) => Date.parse(entry.createdAt))) + 1;
      effects.delegations = (decision.delegations ?? []).map((delegation) => ({ ...delegation, brief: delegation.brief.trim(),
        id: crypto.randomUUID(), sourceMessageId: latestPrincipalInput(records.messages)!, createdAt: new Date(delegationTime++).toISOString() }));
      if (!effects.messages.length && !effects.delegations.length) return;
      if (!await this.records.write(effects, records.version)) return;
      await this.refresh();
      this.host.changed();
      this.host.delegated(effects.delegations.map(({ opportunityId }) => opportunityId));
    } catch (error) {
      if (!controller.signal.aborted && !this.stopped) this.host.error(error instanceof Error ? error.message : String(error));
    } finally {
      if (this.reviewController === controller) this.reviewController = undefined;
    }
  }

  private validate(value: Decision, pending: PrincipalQuestion | null, negotiations: Negotiation[]): void {
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['message', 'question', 'delegations'].includes(key))) throw new Error('Provide a review decision using only the offered fields.');
    if (value.message !== undefined && (typeof value.message !== 'string' || !value.message.trim())) throw new Error('A reply must be nonempty.');
    if (value.question !== undefined) {
      if (!value.question || typeof value.question !== 'object' || Array.isArray(value.question) || Object.keys(value.question).some((key) => !['question', 'options'].includes(key))) throw new Error('Provide one question and suggested answers.');
      if (pending) throw new Error('Keep the displayed question stable until answered.');
      const { question, options } = value.question;
      if (typeof question !== 'string' || !question.trim() || !Array.isArray(options) || options.length < 2 || options.length > 4
        || options.some((option) => typeof option !== 'string' || !option.trim()) || new Set(options).size !== options.length) throw new Error('Ask one question with 2–4 distinct suggestions.');
    }
    if (value.delegations !== undefined && (!Array.isArray(value.delegations) || new Set(value.delegations.map(({ opportunityId }) => opportunityId)).size !== value.delegations.length
      || value.delegations.some((delegation) => typeof delegation.brief !== 'string' || !delegation.brief.trim() || !negotiations.some((record) => record.opportunityId === delegation.opportunityId && !record.settledAt)))) {
      throw new Error('Delegate distinct current, unsettled negotiations with nonempty private briefs.');
    }
  }
}
