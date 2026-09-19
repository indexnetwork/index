import { buildPrincipalInboxPrompt } from '../prompts/agent.prompt.ts';

import type { ModelLoop } from '../core/model.loop.ts';
import { MemoryMessageStore } from '../core/sessions.ts';
import type { Tool, ToolContext } from '../core/tools.ts';
import type { PendingQuestion } from '../core/types.ts';

import type { AgentDomainEvent, PrincipalActivation } from './agent.events.ts';
import type { DiscoveryClient, NegotiationOpeningRequest, OpenNegotiationResult } from './discovery.types.ts';
import type { Negotiation, NegotiationClient, User } from './negotiation.types.ts';
import { isPrincipalBriefCurrent, latestPrincipalInput, pendingPrincipalQuestions, validPrincipalQuestionRetirements, type PrincipalEffects, type PrincipalRecords, type PrincipalRecordsView, type PrincipalStandingBrief } from './principal.records.ts';

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
  batchId?: string;
  kind: 'question' | 'answer' | 'user' | 'message' | 'event';
  activation?: PrincipalActivation;
  matches: readonly MatchReference[];
  text: string;
  scope?: QuestionScope;
  options?: string[];
}

/** An independently authored H2A question; negotiation activity cannot alter it. */
export interface PrincipalQuestion extends PendingQuestion { id: string; batchId: string }

/** One complete answer to the exact displayed question, including any conditions. */
export interface PrincipalAnswer { questionId: string; text: string }

/** Human input is either a direct message or the entire displayed answer batch, never an A2A event. */
export type AgentInput =
  | { type: 'message'; text: string }
  | { type: 'answers'; answers: readonly PrincipalAnswer[] };

/** Ephemeral H2A tool or automatic matching activity, anchored to the preceding visible conversation entry. */
export interface PrincipalToolCall {
  id: string;
  reviewId: string;
  name: string;
  /** Plain-English action for the represented owner. */
  label: string;
  /** Owner-visible input details, including their own private briefs; never another principal's. */
  details?: string;
  afterMessageId?: string;
  status: 'running' | 'completed' | 'error' | 'cancelled';
  /** Plain-text response summary, never a raw payload or confirmation of later review persistence. */
  summary?: string;
}

interface Decision {
  message?: string;
  questions?: Required<PendingQuestion>[];
  retireQuestionIds?: string[];
  delegations?: { opportunityId: string; brief: string }[];
}

interface ReopeningInput { negotiationId: string; reasoning: string; brief: string }

interface OpeningItemResult {
  candidateIntentId: string;
  networkId: string;
  name: string;
  status: 'pending' | 'opened' | 'reused' | 'unavailable' | 'limit_reached' | 'not_attempted' | 'unconfirmed';
  opportunityId?: string;
}

interface OpeningBatchResult { results: OpeningItemResult[] }

const MAX_AUTOMATIC_NEGOTIATIONS = 10;

/** Progress stays in the owner's activity snapshot, outside the model transcript. */
type InboxTool<I = unknown> = Omit<Tool<I>, 'run'> & {
  run(input: I, context: ToolContext, progress: (summary: string) => void): unknown | Promise<unknown>;
};

function summarizeOpeningBatch(batch: OpeningBatchResult): string {
  return batch.results.map((item, index) => {
    const status = {
      pending: 'Queued for automatic opening in score order.',
      opened: 'Negotiation opened; your private brief was saved.',
      reused: 'Existing negotiation reused; its private brief was left unchanged.',
      unavailable: 'Unavailable for this negotiation.',
      limit_reached: `Not attempted; the ${MAX_AUTOMATIC_NEGOTIATIONS}-new-negotiation limit was reached.`,

      not_attempted: 'Not attempted; the batch stopped.',
      unconfirmed: 'Opening result unconfirmed; inspect saved records before retrying.',
    }[item.status];
    return `${index + 1}. ${item.name}: ${status}`;
  }).join('\n');
}

/** Snapshot requested inputs before execution; malformed model arguments must still reach tool validation. */
function describeToolCall(
  name: string,
  input: unknown,

  negotiations: readonly Negotiation[],
  pendingQuestions: readonly PrincipalQuestion[],
): Pick<PrincipalToolCall, 'label' | 'details'> {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (field: unknown): string => typeof field === 'string' ? field.trim() : '';
  switch (name) {
    case 'save_standing_brief':
      return { label: 'Saving standing brief', details: text(value.brief) ? `Your private standing brief:\n${text(value.brief)}` : undefined };
    case 'reopen_negotiation': {
      const selected = negotiations.find((record) => record.id === value.negotiationId);
      return { label: 'Reopening a terminal negotiation', details: [
        selected ? `Counterparty: ${selected.counterparty.name?.trim() || 'an unnamed person'}\nTheir intent:\n${selected.counterparty.statement}\nNetwork: ${selected.networkId}` : '',
        text(value.reasoning) ? `Public reason for reopening:\n${text(value.reasoning)}` : '',
        text(value.brief) ? `Your private brief for the new session:\n${text(value.brief)}` : '',
      ].filter(Boolean).join('\n\n') };
    }
    case 'review_principal_inbox': {
      const questions = Array.isArray(value.questions) ? value.questions.filter((question) => typeof question?.question === 'string') : [];
      const retirements = Array.isArray(value.retireQuestionIds) ? value.retireQuestionIds.filter((id): id is string => typeof id === 'string') : [];
      const delegations = Array.isArray(value.delegations) ? value.delegations.filter((delegation) => typeof delegation?.brief === 'string') : [];
      const details = [
        text(value.message) ? `Message to you:\n${text(value.message)}` : '',
        questions.length ? `Questions for you:\n${questions.map((question, index) => {
          const options = Array.isArray(question.options) ? question.options.filter((option: unknown): option is string => typeof option === 'string') : [];
          return `${index + 1}. ${text(question.question)}${options.length ? '\n   Options: ' + options.map(text).join(' / ') : ''}`;
        }).join('\n')}` : '',
        retirements.length ? `Questions to close:\n${retirements.map((id) => '- ' + (pendingQuestions.find((question) => question.id === id)?.question ?? id)).join('\n')}` : '',
        ...delegations.map((delegation) => {
          const target = negotiations.find((record) => record.opportunityId === delegation.opportunityId);
          return `Your proposed private instructions for ${target?.counterparty.name?.trim() || 'an unnamed person'}:\n${text(delegation.brief)}`;
        }),
      ].filter(Boolean).join('\n\n');
      return { label: 'Reviewing your next steps', details: details || 'No new messages, questions or negotiation instructions requested.' };
    }
  }
  return { label: name };
}

function summarizeToolResponse(name: string, input: unknown, result: unknown): string | undefined {
  switch (name) {
    case 'reopen_negotiation':
      return summarizeOpeningBatch(result as OpeningBatchResult);
    case 'review_principal_inbox': {
      const decision = input as Decision;
      return `Review prepared; these changes are not yet confirmed saved.\n${decision.message ? 1 : 0} messages, ${decision.questions?.length ?? 0} questions, ${decision.retireQuestionIds?.length ?? 0} questions to close, and ${decision.delegations?.length ?? 0} negotiation instructions.`;
    }
    case 'save_standing_brief':
      return 'Standing brief saved. The intent is ready for new negotiations.';
  }
}

/** Internal completion signal: apply the decision without another model call. */
class ReviewComplete extends Error {}

/** Stop this review without retrying writes or shutting down already delegated A2A work. */
class ReviewInterrupted extends Error {}

/** Reconstructs H2A on accepted input, manual wakes or lifecycle events and persists only explicit outputs. */
export class PrincipalInbox {
  private messages: PrincipalMessage[] = [];
  private currentQuestions: PrincipalQuestion[] = [];
  private readonly calls: PrincipalToolCall[] = [];
  private running: Promise<void> = Promise.resolve();
  private accepting: Promise<unknown> = Promise.resolve();
  private reviewController?: AbortController;
  private stopped = false;
  private failure?: Error;
  private unfinishedReview?: string;

  constructor(
    private readonly createLoop: (records: PrincipalRecordsView) => Pick<ModelLoop, 'run'>,
    private readonly records: PrincipalRecords,
    private readonly negotiations: Pick<NegotiationClient, 'listNegotiations' | 'readNegotiation'>,
    private readonly host: { changed(): void; input(): void; paused(): readonly string[]; delegated(ids: string[]): void; error(reason: string): void; event?(event: AgentDomainEvent): void },
    private readonly discovery?: DiscoveryClient,
  ) {}

  /** @returns Committed records and refreshed question status without activating H2A. */
  async refresh(): Promise<PrincipalRecordsView> {
    const records = await this.records.read();
    this.messages = records.messages.filter((message) => message.kind !== 'event');
    const questions = pendingPrincipalQuestions(records);
    if (questions.length !== this.currentQuestions.length || questions.some((question, index) => question.id !== this.currentQuestions[index]?.id)) {
      this.currentQuestions = questions;
    }
    return records;
  }

  private entry(records: Pick<PrincipalRecordsView, 'messages'>, fields: Omit<PrincipalMessage, 'id' | 'createdAt' | 'matches'>): PrincipalMessage {
    const previous = records.messages.at(-1);
    return { id: crypto.randomUUID(), createdAt: new Date(Math.max(Date.now(), previous ? Date.parse(previous.createdAt) + 1 : 0)).toISOString(), matches: [], ...fields };
  }

  /** @returns The latest committed H2A history observed by this runtime. */
  get conversation(): readonly PrincipalMessage[] { return this.messages; }
  /** @returns All unretired, unanswered questions derived from records. */
  get pending(): readonly PrincipalQuestion[] { return this.currentQuestions; }
  /** @returns This runtime's H2A tool and matching observations; never persisted or added to model context. */
  get toolCalls(): readonly PrincipalToolCall[] { return this.calls; }
  /** @returns Whether an H2A review is in flight, excluding cancelled work. */
  get reviewing(): boolean { return Boolean(this.reviewController && !this.reviewController.signal.aborted); }
  /** @returns Guidance when a review or automatic matching stopped before completing. */
  get reviewNotice(): string | undefined { return this.unfinishedReview; }

  /** @param input - Direct human input or a complete answer batch. @returns Committed input with one review queued, or null without a write or wake. */
  receiveInput(input: AgentInput): Promise<readonly PrincipalMessage[] | null> {
    return this.accept(input.type === 'message'
      ? [{ kind: 'user', text: input.text }]
      : input.answers.map((answer) => ({ kind: 'answer', questionId: answer.questionId, text: answer.text })));
  }

  /** @param activation - Explicit manual wake or lifecycle event. @returns Its private receipt with one review queued, or null for duplicate delivery. */
  async wake(activation: PrincipalActivation): Promise<PrincipalMessage | null> {
    const accepted = await this.accept([{ kind: 'event', text: activation.type, activation }]);
    return accepted?.[0] ?? null;
  }

  private accept(inputs: Pick<PrincipalMessage, 'kind' | 'text' | 'questionId' | 'activation'>[]): Promise<readonly PrincipalMessage[] | null> {
    const accepted = this.accepting.then(async () => {
      if (this.failure) throw this.failure;
      if (this.stopped || !inputs.length || inputs.some((input) => !input.text.trim())) return null;
      // accept() validates against canonical records and assigns their ordering
      // inside the host's transaction; an extra pre-read cannot authorize input.
      const entries = inputs.map((input) => {
        const entry = this.entry({ messages: this.messages }, input);
        if (input.activation) entry.id = input.activation.id;
        return entry;
      });
      const messages = await this.records.accept(entries);
      if (!messages) return null;
      const input = messages.at(-1)!;
      this.unfinishedReview = undefined;
      if (input.kind !== 'event') this.host.input();
      for (const message of messages) if (message.kind === 'answer') {
        this.host.event?.({ type: 'question.answered', inputId: message.id, questionId: message.questionId!, batchId: message.batchId! });
      }
      this.host.event?.({ type: 'h2a.activated', inputId: input.id, cause: input.activation?.type ?? (input.kind === 'answer' ? 'answer' : 'user') });
      this.reviewController?.abort();
      await this.refresh();
      this.host.changed();
      // Human input and explicit wakes share one scheduling path. Accepted input
      // is already the review's receipt; it must not create a second manual wake.
      this.running = this.running.then(() => this.review(messages));
      return messages;
    });
    this.accepting = accepted.catch(() => {});
    return accepted;
  }

  /** Cancel model work; committed questions and history survive shutdown. */
  async stop(): Promise<void> {
    this.stopped = true;
    this.reviewController?.abort();
    this.host.changed();
    await this.accepting;
    await this.running;
  }

  private observeTools(
    tools: InboxTool[], signal: AbortSignal, reviewId: string,
    negotiations: readonly Negotiation[], pendingQuestions: readonly PrincipalQuestion[],
  ): Tool[] {
    return tools.map((tool) => ({
      ...tool,
      run: async (input, context) => {
        signal.throwIfAborted();
        const call: PrincipalToolCall = {
          id: crypto.randomUUID(), reviewId, name: tool.name,
          ...describeToolCall(tool.name, input, negotiations, pendingQuestions),
          afterMessageId: this.messages.at(-1)?.id, status: 'running',
        };
        this.calls.push(call);
        const cancelled = () => {
          call.status = 'cancelled';
          this.host.changed();
        };
        signal.addEventListener('abort', cancelled, { once: true });
        this.host.changed();
        try {
          const result = await tool.run(input, context, (summary) => {
            call.summary = summary;
            this.host.changed();
          });
          call.status = signal.aborted ? 'cancelled' : 'completed';
          if (!signal.aborted) call.summary = summarizeToolResponse(tool.name, input, result);
          return result;
        } catch (error) {
          call.status = signal.aborted ? 'cancelled' : 'error';
          if (!signal.aborted) call.summary = [call.summary, error instanceof Error ? error.message : 'Tool execution failed.'].filter(Boolean).join('\n\n');
          throw error;
        } finally {
          signal.removeEventListener('abort', cancelled);
          this.host.changed();
        }
      },
    }));
  }

  private async review(inputs: readonly PrincipalMessage[]): Promise<void> {
    if (this.stopped) return;
    const input = inputs.at(-1)!;
    const controller = new AbortController();
    this.reviewController = controller;
    const delegatedIds = new Set<string>();
    try {
      this.host.changed();
      let records = await this.records.read();
      if (latestPrincipalInput(records.messages) !== input.id) return;
      const negotiations = await this.negotiations.listNegotiations();
      const visibleNegotiationIds = new Set(negotiations.map((record) => record.id));
      const discoveryScope = await this.discovery?.scope(controller.signal);
      controller.signal.throwIfAborted();
      const pendingQuestions = pendingPrincipalQuestions(records);
      let reviewFailure: ReviewInterrupted | undefined;
      const sourceUnchanged = (current: PrincipalRecordsView) => latestPrincipalInput(current.messages) === input.id
        && current.executionVersion === records.executionVersion && current.principalContext === records.principalContext
        && current.intent.id === records.intent.id && current.intent.payload === records.intent.payload;
      const requireCurrent = async () => {
        controller.signal.throwIfAborted();
        const current = await this.records.read();
        if (current.version !== records.version || !sourceUnchanged(current)) throw new ReviewInterrupted('Principal context changed; the remaining review and matching were stopped.');
        controller.signal.throwIfAborted();
      };
      const requireScope = async (version: string, networkIds: string[]) => {
        const scope = await this.discovery!.scope(controller.signal);
        if (scope.version !== version || networkIds.some((id) => !scope.networkIds.includes(id))) throw new ReviewInterrupted('Authorized network scope changed; no further openings were attempted.');
        controller.signal.throwIfAborted();
      };
      let decision: Decision | undefined;
      const tool: InboxTool<Decision> = {
        name: 'review_principal_inbox',
        description: 'Record one review. A useful principal-facing message, exact question retirements, 1–3 new independent questions without altering pending questions, and selected unsettled delegations may coexist. This cannot accept or reject opportunities; users decide in the application UI, never through H2A questions or messages. After these effects are saved, the runtime automatically scores pairs across all authorized networks and opens up to 10 new negotiations in descending score order using the standing brief. Empty input writes no final effects but still runs matching. Briefs are private; only saved specific delegations resume existing A2A work.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, description: 'Concise, useful principal-facing communication: answer a direct request, explain a material result or obstacle, or report a meaningful previously unreported outcome. Do not acknowledge input by default or narrate routine/internal progress. Report agreed negotiations as ready for user review in the application UI only when opportunityStatus is pending; otherwise report the authoritative opportunity status separately. Never solicit a chat approval/rejection or claim to apply one. Agreement is not owner approval or verified execution.' },
            questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
              question: { type: 'string', minLength: 1, description: 'One independent question about missing facts, preferences or authority for negotiation. Never ask to approve, accept or reject an opportunity; users do that in the application UI. For negotiation permission, name the counterpart, terms and limits. Defer questions that depend on another answer.' },
              options: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', minLength: 1 } },
            }, required: ['question', 'options'] } },
            retireQuestionIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 }, description: 'Exact pending question IDs made obsolete by explicit principal corrections after issuance. Not answers or consent. Retain unrelated questions; new questions must address facts not already covered by pending or answered questions. Lifecycle events and counterparty activity cannot retire questions.' },
            delegations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              opportunityId: { type: 'string' }, brief: { type: 'string', minLength: 1, description: 'Complete private mandate for this counterpart: objective, confirmed facts, scoped permission, conditions, revocations, unresolved terms and next focus. Prior briefs are not included; retain every applicable limit.' },
            }, required: ['opportunityId', 'brief'] } },
          },
        },
        run: (value) => {
          controller.signal.throwIfAborted();
          if (decision) throw new Error('Only one decision per review.');
          if (reviewFailure) throw reviewFailure;
          this.validate(value, records, negotiations);
          decision = value;
          return 'Decision recorded.';
        },
      };
      let standingBriefSaved = false;
      const standingBriefTool: InboxTool<{ brief: string }> = {
        name: 'save_standing_brief',
        description: 'Save the complete private mandate that makes this intent eligible for new negotiations. Use before review completion when none exists; replace it only when this H2A review has a materially better intent-wide mandate. This does not resume existing negotiations.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { brief: { type: 'string', minLength: 1, description: 'Objective, confirmed facts, conditions, standing authority and limits, and a safe focus for an unseen counterparty. Do not turn a counterpart-specific approval into standing authority; state what still needs permission.' } },
          required: ['brief'],
        },
        run: async (value) => {
          controller.signal.throwIfAborted();
          if (decision) throw new Error('This review already ended.');
          if (reviewFailure) throw reviewFailure;
          if (standingBriefSaved) throw new Error('The standing brief was already saved in this review.');
          if (!value || typeof value !== 'object' || typeof value.brief !== 'string' || !value.brief.trim()) throw new Error('Provide a complete nonempty standing brief.');
          const previousTimes = [...records.messages, ...records.delegations, ...(records.standingBrief ? [records.standingBrief] : [])]
            .map((entry) => Date.parse(entry.createdAt));
          const brief: PrincipalStandingBrief = {
            id: crypto.randomUUID(), brief: value.brief.trim(), sourceMessageId: input.id,
            createdAt: new Date(Math.max(Date.now(), ...previousTimes) + 1).toISOString(),
          };
          try {
            if (!await this.records.writeStandingBrief(brief, records.version)) throw new ReviewInterrupted('Principal context changed; the standing brief was not saved.');
            const current = await this.records.read();
            if (!sourceUnchanged(current) || current.standingBrief?.id !== brief.id) throw new ReviewInterrupted('The current standing brief could not be confirmed; review stopped.');
            records = current;
            standingBriefSaved = true;
            this.host.event?.({ type: 'standing_brief.saved', inputId: input.id, standingBriefId: brief.id });
            return 'Standing brief saved. The intent is ready for new negotiations.';
          } catch (error) {
            reviewFailure = error instanceof ReviewInterrupted ? error : new ReviewInterrupted('Standing-brief write unconfirmed; inspect saved records before another review.');
            throw reviewFailure;
          }
        },
      };
      const latestNegotiation = (intentId: string, networkId: string) => negotiations
        .filter((record) => record.networkId === networkId && record.counterparty.intentId === intentId)
        .sort((a, b) => b.sessionNumber - a.sessionNumber)[0];
      const open = async (request: Omit<NegotiationOpeningRequest, 'id' | 'sourceMessageId' | 'contextVersion'>, item: OpeningItemResult, progress: () => void) => {
        await requireScope(request.scopeVersion, [request.target.networkId]);
        await requireCurrent();
        controller.signal.throwIfAborted();
        let result: OpenNegotiationResult;
        item.status = 'unconfirmed';
        try {
          result = await this.discovery!.openNegotiation({
            ...request, id: crypto.randomUUID(), sourceMessageId: input.id, contextVersion: records.version,
          }, controller.signal);
        } catch (error) {
          throw new ReviewInterrupted('Opening result unconfirmed; inspect saved records before another review. ' + (error instanceof Error ? error.message : String(error)));
        }
        item.status = result.status === 'unavailable' ? 'unavailable' : result.delegationId ? 'opened' : 'reused';
        if (result.status === 'opened') {
          item.opportunityId = result.opportunityId;
          if (result.delegationId) {
            // Record committed work before any subsequent read or fence can fail.
            delegatedIds.add(result.opportunityId);
            this.host.event?.({ type: 'delegation.brief_saved', inputId: input.id, delegationId: result.delegationId, opportunityId: result.opportunityId, source: 'opening' });
            this.host.event?.({ type: 'negotiation.opened', inputId: input.id, opportunityId: result.opportunityId, candidateIntentId: request.target.intentId, networkId: request.target.networkId });
            if (!this.stopped) this.host.delegated([result.opportunityId]);
          }
        }
        // Publish the acknowledged result before follow-up reads can delay it.
        progress();
        const current = await this.refresh();
        if (current.version !== (result.status === 'opened' ? result.contextVersion : records.version) || !sourceUnchanged(current)
          || current.standingBrief?.id !== records.standingBrief?.id) throw new ReviewInterrupted('Principal context changed during opening; no further openings were attempted.');
        records = current;
        if (result.status === 'opened') {
          const fresh = await this.negotiations.readNegotiation(result.opportunityId);
          if (fresh.opportunityId !== result.opportunityId || fresh.intentId !== records.intent.id) throw new ReviewInterrupted('The opened pair could not be read; inspect its committed records before continuing.');
          const index = negotiations.findIndex((record) => record.id === fresh.id);
          if (index === -1) negotiations.push(fresh);
          else negotiations[index] = fresh;
        }
        controller.signal.throwIfAborted();
      };
      const reopenedIds = new Set<string>();
      const reopenTool: InboxTool<ReopeningInput> = {
        name: 'reopen_negotiation',
        description: 'Deliberately reopen the latest terminal negotiation visible in this review as a new session and opportunity. Supply public reasoning and a complete private brief grounded in current principal evidence. Does not alter old sessions or grant user approval. Cannot open new pairs or update unsettled work; those use automatic matching or review delegations respectively.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            negotiationId: { type: 'string', minLength: 1 },
            reasoning: { type: 'string', minLength: 1, maxLength: 2000, description: 'Public reason for deliberately starting a new session; never disclose private instructions.' },
            brief: { type: 'string', minLength: 1, description: 'Complete private mandate for the new session. Preserve applicable limits; do not inherit old counterpart-specific authority without current evidence.' },
          },
          required: ['negotiationId', 'reasoning', 'brief'],
        },
        run: async (value, _context, progress): Promise<OpeningBatchResult> => {
          controller.signal.throwIfAborted();
          if (reviewFailure) throw reviewFailure;
          if (decision) throw new Error('This review already ended.');
          if (!records.standingBrief || !isPrincipalBriefCurrent(records.standingBrief, records.messages)) throw new Error('Save a current standing brief before reopening a negotiation.');
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['negotiationId', 'reasoning', 'brief'].includes(key))
            || [value.negotiationId, value.reasoning, value.brief].some((field) => typeof field !== 'string' || !field.trim()) || value.reasoning.length > 2000) {
            throw new Error('Provide a visible terminal negotiationId, public reasoning within 2000 characters and a complete private brief.');
          }
          const selected = negotiations.find((record) => record.id === value.negotiationId);
          if (!selected || !visibleNegotiationIds.has(selected.id) || !selected.settledAt && !selected.outcome && selected.opportunityStatus === 'negotiating'
            || latestNegotiation(selected.counterparty.intentId, selected.networkId)?.id !== selected.id) throw new Error('Reopen only the latest visible terminal negotiation.');
          if (!discoveryScope?.networkIds.includes(selected.networkId)) throw new Error('This negotiation is outside the authorized networks.');
          if (reopenedIds.has(selected.id)) throw new Error('This negotiation was already attempted in this review; do not retry it.');
          const item: OpeningItemResult = { candidateIntentId: selected.counterparty.intentId, networkId: selected.networkId, name: selected.counterparty.name?.trim() || 'Unnamed person', status: 'pending' };
          const batch = { results: [item] };
          const publishStopped = () => {
            if (item.status === 'pending') item.status = 'not_attempted';
            progress(summarizeOpeningBatch(batch));
          };
          controller.signal.addEventListener('abort', publishStopped, { once: true });
          try {
            reopenedIds.add(selected.id);
            await open({
              target: { intentId: selected.counterparty.intentId, userId: selected.counterparty.userId, networkId: selected.networkId, payload: selected.counterparty.payload },
              source: { kind: 'negotiation', negotiationId: selected.id },
              expectedLatestNegotiationId: selected.id, expectedLatestOutcome: selected.outcome, expectedLatestOpportunityStatus: selected.opportunityStatus,
              reasoning: value.reasoning.trim(), brief: value.brief.trim(), scopeVersion: discoveryScope.version,
            }, item, () => progress(summarizeOpeningBatch(batch)));
            return batch;
          } catch (error) {
            reviewFailure = error instanceof ReviewInterrupted ? error : new ReviewInterrupted(error instanceof Error ? error.message : String(error));
            publishStopped();
            throw reviewFailure;
          } finally {
            controller.signal.removeEventListener('abort', publishStopped);
          }
        },
      };
      const availableTools: InboxTool[] = [standingBriefTool, tool];
      if (this.discovery) availableTools.push(reopenTool);
      try {
        const result = await this.createLoop(records).run(buildPrincipalInboxPrompt({ records, inputs, pendingQuestions, negotiations, pausedNegotiationIds: this.host.paused(), discoveryScope }), {
          history: new MemoryMessageStore(), tools: this.observeTools(availableTools, controller.signal, input.id, negotiations, pendingQuestions), signal: controller.signal,
          onStep: (step) => {
            controller.signal.throwIfAborted();
            if (reviewFailure) throw reviewFailure;
            if (step.kind === 'tool' && step.name === tool.name && !step.error) throw new ReviewComplete();
          },
        });
        if (reviewFailure) throw reviewFailure;
        if (!decision) {
          const failed = result.steps.findLast((step) => step.kind === 'tool' && step.error);
          throw new Error(failed?.kind === 'tool' ? failed.error : 'The personal agent did not record a communication decision.');
        }
      } catch (error) {
        if (!(error instanceof ReviewComplete)) throw error;
      }
      if (controller.signal.aborted || this.stopped || !decision) return;
      const delegations = decision.delegations ?? [];
      // Newly opened sessions run independently; fence them only if this decision also rebriefs them.
      const effects: PrincipalEffects = {
        negotiations: negotiations.filter((record) => visibleNegotiationIds.has(record.id)
          || delegations.some((delegation) => delegation.opportunityId === record.opportunityId)),
        messages: [], retiredQuestionIds: decision.retireQuestionIds ?? [], delegations: [],
      };
      if (decision.message) effects.messages.push(this.entry(records, { kind: 'message', text: decision.message.trim() }));
      const batchId = crypto.randomUUID();
      for (const question of decision.questions ?? []) {
        effects.messages.push(this.entry({ ...records, messages: [...records.messages, ...effects.messages] }, {
          kind: 'question', questionId: crypto.randomUUID(), batchId, text: question.question.trim(), options: question.options.map((option) => option.trim()),
        }));
      }
      let delegationTime = Math.max(
        Date.now(),
        ...[...records.messages, ...records.delegations, ...(records.standingBrief ? [records.standingBrief] : [])].map((entry) => Date.parse(entry.createdAt)),
      ) + 1;

      effects.delegations = delegations.map(({ opportunityId, brief }) => ({
        opportunityId,
        brief: brief.trim(),
        id: crypto.randomUUID(),
        sourceMessageId: input.id,
        createdAt: new Date(delegationTime++).toISOString(),
      }));
      const hasEffects = effects.messages.length > 0 || effects.retiredQuestionIds.length > 0 || effects.delegations.length > 0;
      if (hasEffects && !(await this.records.write(effects, records.version))) {
        const current = await this.records.read();
        if (latestPrincipalInput(current.messages) === input.id) {
          this.unfinishedReview = 'Review unfinished because the negotiation changed. Send a new message to reassess.';
          this.host.event?.({ type: 'h2a.review_discarded', inputId: input.id, reason: 'stale_context' });
          this.host.changed();
        }
        return;
      }
      for (const delegation of effects.delegations) delegatedIds.add(delegation.opportunityId);
      for (const questionId of effects.retiredQuestionIds) {
        const question = pendingQuestions.find((entry) => entry.id === questionId)!;
        this.host.event?.({ type: 'question.retired', inputId: input.id, questionId, batchId: question.batchId });
      }
      const questionIds = effects.messages.filter((entry) => entry.kind === 'question').map((entry) => entry.questionId!);
      for (const questionId of questionIds) this.host.event?.({ type: 'question.asked', inputId: input.id, questionId, batchId });
      for (const delegation of effects.delegations) {
        this.host.event?.({ type: 'delegation.brief_saved', inputId: input.id, delegationId: delegation.id, opportunityId: delegation.opportunityId, source: 'review' });
      }
      if (!this.stopped && effects.delegations.length) this.host.delegated(effects.delegations.map((entry) => entry.opportunityId));
      // Review writes advance version. Adopt that version only after confirming the
      // principal evidence and standing mandate that authorized this review.
      const current = await this.refresh();
      this.host.changed();
      if (!sourceUnchanged(current) || current.standingBrief?.id !== records.standingBrief?.id || !hasEffects && current.version !== records.version) {
        throw new ReviewInterrupted('Principal context changed after review; automatic matching was not started.');
      }
      records = current;
      this.host.event?.({ type: 'h2a.review_completed', inputId: input.id, questionIds, delegatedIds: effects.delegations.map((entry) => entry.opportunityId) });
      controller.signal.throwIfAborted();
      if (!this.discovery) return;

      const standingBrief = records.standingBrief!;
      const matching: PrincipalToolCall = {
        id: crypto.randomUUID(), reviewId: input.id, name: 'match_counterparties', label: 'Matching counterparties automatically',
        afterMessageId: this.messages.at(-1)?.id, status: 'running',
      };
      const batch: OpeningBatchResult = { results: [] };
      let matchingSummary = 'Matching has not completed.';
      const summarize = () => [matchingSummary, `${batch.results.filter((item) => item.status === 'opened').length} of up to ${MAX_AUTOMATIC_NEGOTIATIONS} new negotiations opened.`, summarizeOpeningBatch(batch)].filter(Boolean).join('\n\n');
      const progress = () => {
        matching.summary = summarize();
        this.host.changed();
      };
      const stopBatch = () => {
        for (const item of batch.results) if (item.status === 'pending') item.status = 'not_attempted';
      };
      const cancelled = () => {
        stopBatch();
        matching.status = 'cancelled';
        matching.summary = summarize();
        this.host.changed();
      };
      this.calls.push(matching);
      controller.signal.addEventListener('abort', cancelled, { once: true });
      this.host.changed();
      try {
        const scope = await this.discovery.scope(controller.signal);
        await requireCurrent();
        matching.details = `Matching across all ${scope.networkIds.length} authorized networks.\n\nYour private standing brief, copied unchanged to each new negotiation:\n${standingBrief.brief}`;
        this.host.changed();
        if (!scope.networkIds.length) {
          matching.summary = 'No authorized networks; no matching was run.';
          matching.status = 'completed';
          return;
        }
        const discoveryInput = { networkIds: [...scope.networkIds] };
        const { candidates } = await this.discovery.discoverCounterparties(discoveryInput, scope.version, controller.signal);
        batch.results = candidates.map((candidate) => ({
          candidateIntentId: candidate.candidateIntentId, networkId: candidate.networkId,
          name: candidate.profile?.identity?.name?.trim() || 'Unnamed person', status: 'pending',
        }));
        matchingSummary = `Found ${candidates.length} scored intent pairs across ${discoveryInput.networkIds.length} authorized networks, ranked highest first.`;
        matching.details += candidates.map((candidate, index) => `\n\n${index + 1}. ${batch.results[index]!.name}\nNetwork: ${candidate.networkId}\nTheir intent:\n${candidate.candidatePayload}\nTypeSafe score: ${candidate.matchProbability}\nPublic match reasoning:\n${candidate.reasoning}`).join('');
        await requireScope(scope.version, [...discoveryInput.networkIds, ...candidates.map((candidate) => candidate.networkId)]);
        await requireCurrent();
        controller.signal.throwIfAborted();
        this.host.event?.({ type: 'discovery.searched', inputId: input.id, matchId: matching.id, networkIds: discoveryInput.networkIds, candidateIntentIds: candidates.map((candidate) => candidate.candidateIntentId) });
        matching.summary = [summarize(), candidates.length ? 'Preparing automatic openings; no action is needed from you.' : ''].filter(Boolean).join('\n\n');
        this.host.changed();
        const fresh = await this.negotiations.listNegotiations();
        negotiations.splice(0, negotiations.length, ...fresh);
        let openedCount = 0;
        for (const [index, candidate] of candidates.entries()) {
          controller.signal.throwIfAborted();
          if (openedCount === MAX_AUTOMATIC_NEGOTIATIONS) {
            for (const item of batch.results.slice(index)) item.status = 'limit_reached';
            break;
          }
          const item = batch.results[index]!;
          const latest = latestNegotiation(candidate.candidateIntentId, candidate.networkId);
          if (latest) {
            item.status = !latest.settledAt && !latest.outcome && latest.opportunityStatus === 'negotiating' ? 'reused' : 'unavailable';
            progress();
            continue;
          }
          await open({
            target: { userId: candidate.candidateUserId, intentId: candidate.candidateIntentId, networkId: candidate.networkId, payload: candidate.candidatePayload },
            source: { kind: 'match', matchId: matching.id, probability: candidate.matchProbability },
            expectedLatestNegotiationId: null, expectedLatestOutcome: null,
            expectedLatestOpportunityStatus: null,
            reasoning: candidate.reasoning, brief: standingBrief.brief, scopeVersion: scope.version,
          }, item, progress);
          if (item.status === 'opened') openedCount++;
        }
        controller.signal.throwIfAborted();
        matching.summary = summarize();
        matching.status = 'completed';
      } catch (error) {
        stopBatch();
        const reason = error instanceof Error ? error.message : String(error);
        matching.status = controller.signal.aborted ? 'cancelled' : 'error';
        matching.summary = `${summarize()}\n\nAutomatic matching stopped: ${reason}`;
        if (!controller.signal.aborted && !this.stopped) this.unfinishedReview = `Automatic matching stopped: ${reason}`;
      } finally {
        controller.signal.removeEventListener('abort', cancelled);
        this.host.changed();
      }
    } catch (error) {
      if (!controller.signal.aborted && !this.stopped) {
        if (error instanceof ReviewInterrupted || delegatedIds.size) {
          this.unfinishedReview = error instanceof Error ? error.message : String(error);
        } else {
          this.failure = error instanceof Error ? error : new Error(String(error));
          this.host.error(this.failure.message);
        }
      }
    } finally {
      if (this.reviewController === controller) this.reviewController = undefined;
      this.host.changed();
    }
  }

  private validate(value: Decision, records: PrincipalRecordsView, negotiations: Negotiation[]): void {
    if (!records.standingBrief || !isPrincipalBriefCurrent(records.standingBrief, records.messages)) throw new Error('Save a current standing brief before completing this review.');
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['message', 'questions', 'retireQuestionIds', 'delegations'].includes(key))) throw new Error('Provide a review decision using only the offered fields.');
    if (value.message !== undefined && (typeof value.message !== 'string' || !value.message.trim())) throw new Error('A reply must be nonempty.');
    if (value.retireQuestionIds !== undefined && (!validPrincipalQuestionRetirements(records, value.retireQuestionIds) || !value.retireQuestionIds.length)) {
      throw new Error('Retire distinct pending question IDs only when later principal evidence makes them obsolete; lifecycle events cannot retire questions.');
    }
    if (value.questions !== undefined) {
      if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3) throw new Error('Ask 1–3 independent questions.');
      for (const item of value.questions) {
        if (!item || typeof item !== 'object' || Array.isArray(item) || Object.keys(item).some((key) => !['question', 'options'].includes(key))) throw new Error('Provide a question and suggested answers.');
        const { question, options } = item;
        if (typeof question !== 'string' || !question.trim() || !Array.isArray(options) || options.length < 2 || options.length > 4
          || options.some((option) => typeof option !== 'string' || !option.trim()) || new Set(options.map((option) => option.trim())).size !== options.length) throw new Error('Each question needs 2–4 distinct suggestions.');
      }
    }
    if (value.delegations !== undefined && (!Array.isArray(value.delegations) || new Set(value.delegations.map(({ opportunityId }) => opportunityId)).size !== value.delegations.length
      || value.delegations.some((delegation) => typeof delegation.brief !== 'string' || !delegation.brief.trim() || !negotiations.some((record) => record.opportunityId === delegation.opportunityId && !record.settledAt && record.opportunityStatus === 'negotiating')))) {
      throw new Error('Delegate distinct current, unsettled negotiations with nonempty private briefs.');
    }
  }
}
