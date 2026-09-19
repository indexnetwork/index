import { buildPrincipalInboxPrompt } from '../prompts/agent.prompt.ts';

import type { ModelLoop } from '../core/model.loop.ts';
import { MemoryMessageStore } from '../core/sessions.ts';
import type { Tool, ToolContext } from '../core/tools.ts';
import type { PendingQuestion } from '../core/types.ts';

import type { AgentDomainEvent, PrincipalActivation } from './agent.events.ts';
import type { CandidateQuery, DiscoveryClient, NegotiationSelection, OpenNegotiationsInput, OpenNegotiationResult, SearchRecord, SkippedCounterparty } from './discovery.types.ts';
import type { Negotiation, User } from './negotiation.types.ts';
import { latestPrincipalInput, pendingPrincipalQuestions, validPrincipalQuestionRetirements, type PrincipalEffects, type PrincipalRecords, type PrincipalRecordsView, type PrincipalStandingBrief } from './principal.records.ts';

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

/** Ephemeral H2A tool execution, anchored to the preceding visible conversation entry. */
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

const DISCOVERY_QUERY_COUNT = 5;

interface OpeningItemResult {
  candidateIntentId: string;
  networkId: string;
  name: string;
  status: 'pending' | 'opened' | 'reused' | 'unavailable' | 'skipped' | 'not_attempted' | 'unconfirmed';
  opportunityId?: string;
  reason?: string;
}

interface OpeningBatchResult { results: OpeningItemResult[] }

/** Progress stays in the owner's activity snapshot, outside the model transcript. */
type InboxTool<I = unknown> = Omit<Tool<I>, 'run'> & {
  run(input: I, context: ToolContext, progress: (summary: string) => void): unknown | Promise<unknown>;
};

function summarizeOpeningBatch(batch: OpeningBatchResult): string {
  return batch.results.map((item, index) => {
    const status = {
      pending: 'Waiting to open.',
      opened: 'Negotiation opened; your private brief was saved.',
      reused: 'Existing negotiation reused; its private brief was left unchanged.',
      unavailable: 'Unavailable for this negotiation.',
      skipped: 'Skipped by your agent.',
      not_attempted: 'Not attempted; the batch stopped.',
      unconfirmed: 'Opening result unconfirmed; inspect saved records before retrying.',
    }[item.status];
    return `${index + 1}. ${item.name}: ${status}${item.reason ? ' ' + item.reason : ''}`;
  }).join('\n');
}

/** Snapshot requested inputs before execution; malformed model arguments must still reach tool validation. */
function describeToolCall(
  name: string,
  input: unknown,
  searches: ReadonlyMap<string, SearchRecord>,
  negotiations: readonly Negotiation[],
  pendingQuestions: readonly PrincipalQuestion[],
): Pick<PrincipalToolCall, 'label' | 'details'> {
  const value = (input && typeof input === 'object' ? input : {}) as Record<string, unknown>;
  const text = (field: unknown): string => typeof field === 'string' ? field.trim() : '';
  switch (name) {
    case 'save_standing_brief':
      return { label: 'Saving standing brief', details: text(value.brief) ? `Your private standing brief:\n${text(value.brief)}` : undefined };
    case 'discover_counterparties': {
      const queries = Array.isArray(value.queries) ? value.queries.filter((query): query is string => typeof query === 'string') : [];
      return { label: 'Discovering counterparties', details: [
        Array.isArray(value.networkIds) ? `Requested search scope: ${value.networkIds.length} networks` : '',
        typeof value.minSimilarity === 'number' ? `Minimum similarity: ${value.minSimilarity}` : '',
        queries.length ? `Search queries:\n${queries.map((query, index) => `${index + 1}. ${query.replace(/\s+/g, ' ').trim()}`).join('\n')}` : '',
      ].filter(Boolean).join('\n\n') };
    }
    case 'open_negotiations': {
      const openings = Array.isArray(value.negotiations) ? value.negotiations : [];
      const skipped = Array.isArray(value.skipped) ? value.skipped : [];
      const describe = (entry: unknown, skip: boolean): string => {
        if (!entry || typeof entry !== 'object') return '';
        const item = entry as Record<string, unknown>;
        const selected = negotiations.find((record) => record.id === item.negotiationId);
        const candidate = searches.get(text(item.searchId))?.candidates.find((record) => record.candidateIntentId === item.candidateIntentId && record.networkId === item.networkId);
        const name = (selected ? selected.counterparty.name : candidate?.profile?.identity?.name)?.trim() || 'an unnamed person';
        const intent = selected ? selected.counterparty.statement : candidate?.candidatePayload;
        return [
          `${skip ? 'Skipping' : 'Opening negotiation with'} ${name}`,
          intent ? `Their intent:\n${intent}` : '',
          text(item.networkId) ? `Network: ${text(item.networkId)}` : '',
          skip ? `Reason for skipping:\n${text(item.reason)}` : [
            text(item.reasoning) ? `Why this match:\n${text(item.reasoning)}` : '',
            text(item.brief) ? `Your proposed private brief for this negotiation:\n${text(item.brief)}` : '',
          ].filter(Boolean).join('\n\n'),
        ].filter(Boolean).join('\n\n');
      };
      return { label: 'Opening negotiations', details: [
        ...openings.map((entry) => describe(entry, false)),
        ...skipped.map((entry) => describe(entry, true)),
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
    case 'discover_counterparties': {
      const search = result as SearchRecord;
      return `Found ${search.candidates.length} potential matches across ${search.networkIds.length} searched networks. This search did not open any negotiations.`;
    }
    case 'open_negotiations':
      return summarizeOpeningBatch(result as OpeningBatchResult);
    case 'review_principal_inbox': {
      const decision = input as Decision;
      return `Review prepared; these changes are not yet confirmed saved.\n${decision.message ? 1 : 0} messages, ${decision.questions?.length ?? 0} questions, ${decision.retireQuestionIds?.length ?? 0} questions to close, and ${decision.delegations?.length ?? 0} negotiation instructions.`;
    }
    case 'save_standing_brief':
      return 'Standing brief saved. The intent is ready for new negotiations.';
  }
}

function validateCandidateQuery(
  value: unknown,
  authorizedNetworkIds: string[],
): CandidateQuery {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Provide a valid query object with queries, minSimilarity, and networkIds.');
  }

  const { queries, minSimilarity, networkIds } = value as Record<string, unknown>;

  if (!Array.isArray(queries) || queries.length !== DISCOVERY_QUERY_COUNT || queries.some((query) => typeof query !== 'string' || !query.trim())) {
    throw new Error('Provide exactly five nonempty complementary search queries.');
  }
  const normalizedQueries = queries.map((query: string) => query.replace(/\s+/g, ' ').trim());
  if (new Set(normalizedQueries.map((query) => query.toLowerCase())).size !== DISCOVERY_QUERY_COUNT) {
    throw new Error('Provide five distinct complementary search queries, not duplicates.');
  }

  if (typeof minSimilarity !== 'number' || !Number.isFinite(minSimilarity) || minSimilarity < 0 || minSimilarity > 1) {
    throw new Error('Provide a finite similarity floor between 0 and 1.');
  }

  if (
    !Array.isArray(networkIds) ||
    networkIds.length === 0 ||
    new Set(networkIds).size !== networkIds.length ||
    networkIds.some((id) => typeof id !== 'string' || !authorizedNetworkIds.includes(id))
  ) {
    throw new Error('Provide distinct authorized network IDs from current scope.');
  }

  return {
    queries: normalizedQueries,
    minSimilarity,
    networkIds,
  };
}

/** Internal completion signal: apply the decision without another model call. */
class ReviewComplete extends Error {}

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
    private readonly negotiations: () => Promise<Negotiation[]>,
    private readonly host: { changed(): void; input(): void; delegated(ids: string[]): void; error(reason: string): void; event?(event: AgentDomainEvent): void },
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
  /** @returns The exact unretired, unanswered batch derived from records. */
  get pending(): readonly PrincipalQuestion[] { return this.currentQuestions; }
  /** @returns This runtime's H2A tool observations; never part of persisted conversation or model context. */
  get toolCalls(): readonly PrincipalToolCall[] { return this.calls; }
  /** @returns Whether an H2A review is in flight, excluding cancelled work. */
  get reviewing(): boolean { return Boolean(this.reviewController && !this.reviewController.signal.aborted); }
  /** @returns Guidance for an accepted input whose review was discarded by a stale effect fence. */
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
    searches: ReadonlyMap<string, SearchRecord>, negotiations: readonly Negotiation[], pendingQuestions: readonly PrincipalQuestion[],
  ): Tool[] {
    return tools.map((tool) => ({
      ...tool,
      run: async (input, context) => {
        signal.throwIfAborted();
        const call: PrincipalToolCall = {
          id: crypto.randomUUID(), reviewId, name: tool.name,
          ...describeToolCall(tool.name, input, searches, negotiations, pendingQuestions),
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
    const openedIds = new Set<string>();
    try {
      this.host.changed();
      let records = await this.records.read();
      if (latestPrincipalInput(records.messages) !== input.id) return;
      const negotiations = await this.negotiations();
      const discoveryScope = await this.discovery?.scope(controller.signal);
      controller.signal.throwIfAborted();
      const pendingQuestions = pendingPrincipalQuestions(records);
      const completedSearches = new Map<string, SearchRecord>();
      const attemptedOpenings = new Map<string, OpenNegotiationResult | null>();
      let pendingSearch: SearchRecord | undefined;
      let openingFailure: Error | undefined;
      const requireBatchProcessed = () => {
        if (openingFailure) throw openingFailure;
        if (pendingSearch) throw new Error(`Call open_negotiations for search ${pendingSearch.id} first: account for all ${pendingSearch.candidates.length} candidates with an opening brief or an explicit skip reason.`);
      };
      let decision: Decision | undefined;
      const tool: InboxTool<Decision> = {
        name: 'review_principal_inbox',
        description: 'Record one review. A useful principal-facing message, exact question retirements, a stable batch of 1–3 independent questions, and selected unsettled delegations may coexist. This cannot accept or reject opportunities; users decide in the application UI, never through H2A questions or messages. A discovered batch must be processed through open_negotiations before this review can end. After that, empty input writes no final effects. Briefs are private; only saved delegations resume A2A.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            message: { type: 'string', minLength: 1, description: 'Concise, useful principal-facing communication: answer a direct request, explain a material result or obstacle, or report a meaningful previously unreported outcome. Do not acknowledge input by default or narrate routine/internal progress. Report agreed negotiations as ready for user review in the application UI only when opportunityStatus is pending; otherwise report the authoritative opportunity status separately. Never solicit a chat approval/rejection or claim to apply one. Agreement is not owner approval or verified execution.' },
            questions: { type: 'array', minItems: 1, maxItems: 3, items: { type: 'object', additionalProperties: false, properties: {
              question: { type: 'string', minLength: 1, description: 'One independent question about missing facts, preferences or authority for negotiation. Never ask to approve, accept or reject an opportunity; users do that in the application UI. For negotiation permission, name the counterpart, terms and limits. Defer questions that depend on another answer.' },
              options: { type: 'array', minItems: 2, maxItems: 4, uniqueItems: true, items: { type: 'string', minLength: 1 } },
            }, required: ['question', 'options'] } },
            retireQuestionIds: { type: 'array', minItems: 1, uniqueItems: true, items: { type: 'string', minLength: 1 }, description: 'Exact pending question IDs made obsolete by explicit principal corrections after issuance. Not answers or consent. Retain unrelated questions; ask a new batch only if none remain. Lifecycle events and counterparty activity cannot retire questions.' },
            delegations: { type: 'array', items: { type: 'object', additionalProperties: false, properties: {
              opportunityId: { type: 'string' }, brief: { type: 'string', minLength: 1, description: 'Complete private mandate for this counterpart: objective, confirmed facts, scoped permission, conditions, revocations, unresolved terms and next focus. Prior briefs are not included; retain every applicable limit.' },
            }, required: ['opportunityId', 'brief'] } },
          },
        },
        run: (value) => {
          controller.signal.throwIfAborted();
          if (decision) throw new Error('Only one decision per review.');
          requireBatchProcessed();
          this.validate(value, records, pendingQuestions, negotiations);
          decision = value;
          return 'Decision recorded.';
        },
      };
      let standingBriefSaved = false;
      const standingBriefTool: InboxTool<{ brief: string }> = {
        name: 'save_standing_brief',
        description: 'Save the complete private mandate that makes this intent eligible for new negotiations. Use before discovery when none exists; replace it only when this H2A review has a materially better intent-wide mandate. This does not resume existing negotiations.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: { brief: { type: 'string', minLength: 1, description: 'Objective, confirmed facts, conditions, standing authority and limits, and a safe focus for an unseen counterparty. Do not turn a counterpart-specific approval into standing authority; state what still needs permission.' } },
          required: ['brief'],
        },
        run: async (value) => {
          controller.signal.throwIfAborted();
          if (decision) throw new Error('This review already ended.');
          requireBatchProcessed();
          if (standingBriefSaved) throw new Error('The standing brief was already saved in this review.');
          if (!value || typeof value !== 'object' || typeof value.brief !== 'string' || !value.brief.trim()) throw new Error('Provide a complete nonempty standing brief.');
          const previousTimes = [...records.messages, ...records.delegations, ...(records.standingBrief ? [records.standingBrief] : [])]
            .map((entry) => Date.parse(entry.createdAt));
          const brief: PrincipalStandingBrief = {
            id: crypto.randomUUID(), brief: value.brief.trim(), sourceMessageId: input.id,
            createdAt: new Date(Math.max(Date.now(), ...previousTimes) + 1).toISOString(),
          };
          if (!await this.records.writeStandingBrief(brief, records.version)) throw new Error('Principal context changed; discard this standing brief.');
          const current = await this.records.read();
          if (current.standingBrief?.id !== brief.id) throw new Error('The standing brief could not be confirmed.');
          records = current;
          standingBriefSaved = true;
          this.host.event?.({ type: 'standing_brief.saved', inputId: input.id, standingBriefId: brief.id });
          return 'Standing brief saved. The intent is ready for new negotiations.';
        },
      };
      const searchTool: InboxTool<CandidateQuery> = {
        name: 'discover_counterparties',
        description: 'Search actual counterparty intents with five complementary queries, all in the same authorized networks where both intents are registered. Results are merged by intent and shared network, keeping the highest similarity. After nonempty results, open_negotiations must account for every candidate with an opening or explicit skip before another search or final review. Results exist only in this review; this search never opens a negotiation itself.',
        parameters: {
          type: 'object',
          additionalProperties: false,
          properties: {
            queries: {
              type: 'array',
              minItems: DISCOVERY_QUERY_COUNT,
              maxItems: DISCOVERY_QUERY_COUNT,
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
              description: 'Five genuinely different, complementary search directions grounded in the intent and confirmed principal context. Describe useful counterpart roles, skills, contributions or approaches, not five paraphrases of the same need.',
            },
            minSimilarity: { type: 'number', minimum: 0, maximum: 1 },
            networkIds: {
              type: 'array',
              minItems: 1,
              uniqueItems: true,
              items: { type: 'string', minLength: 1 },
              description: 'One shared subset of discoveryScope.networkIds for all five queries. Both the source and each returned counterparty intent must be registered in the result’s network; user membership alone is insufficient.',
            },
          },
          required: ['queries', 'minSimilarity', 'networkIds'],
        },
        run: async (value): Promise<SearchRecord> => {
          controller.signal.throwIfAborted();
          if (decision) throw new Error('This review already ended.');
          requireBatchProcessed();
          if (!records.standingBrief) throw new Error('Save a standing brief before discovering counterparties.');

          const query = validateCandidateQuery(value, discoveryScope?.networkIds ?? []);

          if ((await this.records.read()).version !== records.version) {
            throw new Error('Principal context changed; discard this search.');
          }

          const result = await this.discovery!.discoverCounterparties(
            query,
            discoveryScope!.version,
            controller.signal,
          );

          controller.signal.throwIfAborted();

          if ((await this.records.read()).version !== records.version) {
            throw new Error('Principal context changed during search.');
          }

          const record: SearchRecord = {
            ...query,
            id: crypto.randomUUID(),
            scopeVersion: discoveryScope!.version,
            candidates: result.candidates,
            status: 'complete',
          };
          completedSearches.set(record.id, record);
          if (this.discovery?.openNegotiation && record.candidates.length) pendingSearch = record;
          this.host.event?.({ type: 'discovery.searched', inputId: input.id, searchId: record.id, ...query, candidateIntentIds: record.candidates.map((candidate) => candidate.candidateIntentId) });
          return record;
        },
      };
      const resolveSelection = (raw: unknown) => {
        if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['searchId', 'candidateIntentId', 'networkId', 'negotiationId', 'reasoning', 'brief'].includes(key))) {
          throw new Error('Provide a valid negotiation selection with its own reasoning and brief.');
        }
        const value = raw as NegotiationSelection;
        const { searchId, negotiationId, reasoning, brief } = value;
        if (negotiationId !== undefined ? typeof negotiationId !== 'string' || !negotiationId.trim()
          : [searchId, value.candidateIntentId, value.networkId].some((id) => typeof id !== 'string' || !id.trim())) {
          throw new Error('Select a completed search candidate or a visible negotiationId.');
        }
        if (!reasoning || typeof reasoning !== 'string' || !reasoning.trim() || reasoning.length > 2000) {
          throw new Error('Provide grounded reasoning within 2000 characters.');
        }
        if (!brief || typeof brief !== 'string' || !brief.trim()) {
          throw new Error('Provide a non-empty private brief.');
        }
        const search = searchId ? completedSearches.get(searchId) : undefined;
        const selected = negotiationId !== undefined ? negotiations.find((record) => record.id === negotiationId) : undefined;
        if (negotiationId !== undefined ? !selected || searchId !== undefined || value.candidateIntentId !== undefined || value.networkId !== undefined : !search) {
          throw new Error('Select exactly one completed search candidate or a negotiation visible in this review.');
        }
        const candidate = search?.candidates.find((c) => c.candidateIntentId === value.candidateIntentId && c.networkId === value.networkId);
        const target = selected ? {
          intentId: selected.counterparty.intentId, userId: selected.counterparty.userId,
          networkId: selected.networkId, payload: selected.counterparty.payload,
        } : candidate ? {
          intentId: candidate.candidateIntentId, userId: candidate.candidateUserId,
          networkId: candidate.networkId, payload: candidate.candidatePayload,
        } : undefined;
        if (!target) throw new Error('Candidate not found in the specified search.');
        if (!discoveryScope?.networkIds.includes(target.networkId)) throw new Error('Selected negotiation is outside the current authorized networks.');
        return { value, search, selected, candidate, target,
          key: JSON.stringify([target.intentId, target.networkId]),
          name: (selected ? selected.counterparty.name : candidate?.profile?.identity?.name)?.trim() || 'Unnamed person' };
      };
      const openSelected = async (selection: ReturnType<typeof resolveSelection>): Promise<OpenNegotiationResult> => {
        const { value: { reasoning, brief }, search, selected, candidate, target, key } = selection;
        const { intentId: candidateIntentId, networkId } = target;
        const scopeVersion = search?.scopeVersion ?? discoveryScope!.version;
        const latest = negotiations.filter((record) => record.networkId === networkId && record.counterparty.intentId === candidateIntentId)
          .sort((a, b) => b.sessionNumber - a.sessionNumber)[0];
        const expectedLatestNegotiationId = selected?.id ?? latest?.id ?? null;

        if ((await this.records.read()).version !== records.version) {
          throw new Error('Principal context changed; discard this opening.');
        }
        const scope = await this.discovery!.scope(controller.signal);
        if (scope.version !== scopeVersion || !scope.networkIds.includes(networkId)) throw new Error('Search scope changed; discard this selection.');
        controller.signal.throwIfAborted();

        let result = attemptedOpenings.get(key);
        if (result === null) throw new Error('This pair has an unconfirmed opening attempt. Reassess its committed records at the next user review; do not retry it here.');
        if (!result) {
          attemptedOpenings.set(key, null);
          if (search && candidate) this.host.event?.({
            type: 'candidate.evaluated', inputId: input.id, searchId: search.id,
            candidateIntentId: candidate.candidateIntentId, networkId: candidate.networkId,
            outcome: 'selected', similarity: candidate.similarity,
          });
          result = await this.discovery!.openNegotiation!({
            id: crypto.randomUUID(), target,
            source: selected ? { kind: 'negotiation', negotiationId: selected.id }
              : { kind: 'search', searchId: search!.id, similarity: candidate!.similarity },
            expectedLatestNegotiationId,
            expectedLatestOutcome: (selected ?? latest)?.outcome ?? null,
            expectedLatestOpportunityStatus: (selected ?? latest)?.opportunityStatus ?? null,
            reasoning: reasoning.trim(), brief: brief.trim(),
            sourceMessageId: input.id, contextVersion: records.version, scopeVersion,
          }, controller.signal);
          attemptedOpenings.set(key, result);
          if (result.status === 'opened') {
            const delegationId = result.delegationId;
            if (delegationId) openedIds.add(result.opportunityId);
            const current = await this.records.read();
            if (delegationId && current.delegations.some((delegation) => delegation.id === delegationId)) {
              this.host.event?.({ type: 'delegation.brief_saved', inputId: input.id, delegationId, opportunityId: result.opportunityId, source: 'opening' });
            }
            this.host.event?.({ type: 'negotiation.opened', inputId: input.id, opportunityId: result.opportunityId, candidateIntentId, networkId });
            if (current.version !== result.contextVersion) throw new Error('Principal context changed during opening; discard the remaining review.');
            records = current;
          }
        }
        controller.signal.throwIfAborted();
        if (result.status === 'unavailable') return result;
        const fresh = (await this.negotiations()).find((record) => record.opportunityId === result.opportunityId);
        if (!fresh) throw new Error('The opened pair could not be read; inspect its committed records before continuing.');
        const index = negotiations.findIndex((record) => record.opportunityId === fresh.opportunityId);
        if (index < 0) negotiations.push(fresh);
        else negotiations[index] = fresh;
        return result;
      };
      const openTool: InboxTool<OpenNegotiationsInput> = {
        name: 'open_negotiations',
        description: 'Process a batch of selected negotiations and explicit skips. After discovery, account for every returned candidate intent/network exactly once before another search or final review. Each opening needs its own complete private brief and grounded public reasoning. Use skipped with a specific reason for unsuitable candidates, not silent omission. Openings run sequentially; unavailable candidates do not stop the batch, but changed context or an uncertain write stops the remainder. Never retry a stopped batch in this review. Existing unsettled negotiations keep their briefs; deliberate terminal-session selections may create new sessions. No user approval is implied.',
        parameters: {
          type: 'object', additionalProperties: false,
          properties: {
            negotiations: { type: 'array', items: {
              type: 'object', additionalProperties: false,
              properties: {
                negotiationId: { type: 'string', minLength: 1 },
                searchId: { type: 'string', minLength: 1 },
                candidateIntentId: { type: 'string', minLength: 1 },
                networkId: { type: 'string', minLength: 1 },
                reasoning: { type: 'string', minLength: 1, maxLength: 2000, description: 'Public reasoning justifying this particular match.' },
                brief: { type: 'string', minLength: 1, description: 'Complete private mandate for this counterpart: objective, confirmed facts, scoped authority, conditions, limits and unresolved terms. Preserve every relevant standing-brief limit. Selecting someone grants no permission to commit the principal.' },
              },
              required: ['reasoning', 'brief'],
              oneOf: [{ required: ['searchId', 'candidateIntentId', 'networkId'] }, { required: ['negotiationId'] }],
            } },
            skipped: { type: 'array', items: {
              type: 'object', additionalProperties: false,
              properties: {
                searchId: { type: 'string', minLength: 1 },
                candidateIntentId: { type: 'string', minLength: 1 },
                networkId: { type: 'string', minLength: 1 },
                reason: { type: 'string', minLength: 1, maxLength: 2000, description: 'Specific grounded reason this candidate is not being pursued. Visible to our principal, not the counterparty.' },
              },
              required: ['searchId', 'candidateIntentId', 'networkId', 'reason'],
            } },
          },
          required: ['negotiations', 'skipped'],
          anyOf: [{ properties: { negotiations: { minItems: 1 } } }, { properties: { skipped: { minItems: 1 } } }],
        },
        run: async (value, _context, progress): Promise<OpeningBatchResult> => {
          controller.signal.throwIfAborted();
          if (openingFailure) throw openingFailure;
          if (decision) throw new Error('This review already ended.');
          if (!records.standingBrief) throw new Error('Save a standing brief before opening negotiations.');
          if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['negotiations', 'skipped'].includes(key))
            || !Array.isArray(value.negotiations) || !Array.isArray(value.skipped) || !value.negotiations.length && !value.skipped.length) {
            throw new Error('Provide negotiations and skipped arrays with at least one opening or explicit skip.');
          }
          // Validate the entire batch before the first write, including later entries.
          const selections = value.negotiations.map(resolveSelection);
          const skipped = value.skipped.map((raw) => {
            if (!raw || typeof raw !== 'object' || Array.isArray(raw) || Object.keys(raw).some((key) => !['searchId', 'candidateIntentId', 'networkId', 'reason'].includes(key))
              || [raw.searchId, raw.candidateIntentId, raw.networkId, raw.reason].some((field) => typeof field !== 'string' || !field.trim()) || raw.reason.length > 2000) {
              throw new Error('Each skip needs a searchId, candidateIntentId, networkId and a nonempty reason within 2000 characters.');
            }
            const item = raw as SkippedCounterparty;
            const search = completedSearches.get(item.searchId);
            const candidate = search?.candidates.find((entry) => entry.candidateIntentId === item.candidateIntentId && entry.networkId === item.networkId);
            if (!candidate || search !== pendingSearch) throw new Error('Skip only candidates from the pending search.');
            return { item, candidate, key: JSON.stringify([candidate.candidateIntentId, candidate.networkId]) };
          });
          const keys = [...selections, ...skipped].map((item) => item.key);
          if (new Set(keys).size !== keys.length) throw new Error('Account for each candidate intent/network exactly once, without duplicate or conflicting entries.');
          if (pendingSearch?.candidates.some((candidate) => !keys.includes(JSON.stringify([candidate.candidateIntentId, candidate.networkId])))) {
            throw new Error('The batch omits discovered candidates. Include every candidate with its own opening brief or explicit skip reason.');
          }
          const batch: OpeningBatchResult = { results: [
            ...selections.map((selection): OpeningItemResult => ({ candidateIntentId: selection.target.intentId, networkId: selection.target.networkId, name: selection.name, status: 'pending' })),
            ...skipped.map(({ candidate }): OpeningItemResult => ({ candidateIntentId: candidate.candidateIntentId, networkId: candidate.networkId, name: candidate.profile?.identity?.name?.trim() || 'Unnamed person', status: 'pending' })),
          ] };
          const previouslyOpened = new Set(selections.filter(({ key }) => attemptedOpenings.get(key)?.status === 'opened').map(({ key }) => key));
          const recordResult = (item: OpeningItemResult, result: OpenNegotiationResult) => {
            item.status = result.status === 'unavailable' ? 'unavailable'
              : result.delegationId && !previouslyOpened.has(JSON.stringify([item.candidateIntentId, item.networkId])) ? 'opened' : 'reused';
            if (result.status === 'opened') item.opportunityId = result.opportunityId;
          };
          let activeIndex = -1;
          const publishStopped = () => {
            if (activeIndex >= 0) {
              const result = attemptedOpenings.get(selections[activeIndex]!.key);
              if (result) recordResult(batch.results[activeIndex]!, result);
              else if (result === null) batch.results[activeIndex]!.status = 'unconfirmed';
            }
            for (const item of batch.results) if (item.status === 'pending') item.status = 'not_attempted';
            progress(summarizeOpeningBatch(batch));
          };
          controller.signal.addEventListener('abort', publishStopped, { once: true });
          try {
            if ((await this.records.read()).version !== records.version) throw new Error('Principal context changed; discard this opening batch.');
            const scope = await this.discovery!.scope(controller.signal);
            if (scope.version !== discoveryScope!.version || [...selections.map(({ target }) => target.networkId), ...skipped.map(({ candidate }) => candidate.networkId)].some((id) => !scope.networkIds.includes(id))) {
              throw new Error('Search scope changed; discard this opening batch.');
            }
            controller.signal.throwIfAborted();
            for (const [index, { item, candidate }] of skipped.entries()) {
              Object.assign(batch.results[selections.length + index]!, { status: 'skipped', reason: item.reason.trim() });
              this.host.event?.({ type: 'candidate.evaluated', inputId: input.id, searchId: item.searchId, candidateIntentId: candidate.candidateIntentId, networkId: candidate.networkId, outcome: 'skipped', similarity: candidate.similarity });
            }
            progress(summarizeOpeningBatch(batch));
            for (const [index, selection] of selections.entries()) {
              activeIndex = index;
              controller.signal.throwIfAborted();
              recordResult(batch.results[index]!, await openSelected(selection));
              progress(summarizeOpeningBatch(batch));
            }
            pendingSearch = undefined;
            return batch;
          } catch (error) {
            openingFailure = error instanceof Error ? error : new Error(String(error));
            publishStopped();
            throw openingFailure;
          } finally {
            controller.signal.removeEventListener('abort', publishStopped);
          }
        },
      };
      const availableTools: InboxTool[] = [standingBriefTool, tool];
      if (this.discovery) {
        availableTools.push(searchTool);
        if (this.discovery.openNegotiation) {
          availableTools.push(openTool);
        }
      }
      try {
        const result = await this.createLoop(records).run(buildPrincipalInboxPrompt({ records, inputs, pendingQuestions, negotiations, discoveryScope }), {
          history: new MemoryMessageStore(), tools: this.observeTools(availableTools, controller.signal, input.id, completedSearches, negotiations, pendingQuestions), signal: controller.signal,
          onStep: (step) => {
            controller.signal.throwIfAborted();
            if (openingFailure) throw openingFailure;
            if (step.kind === 'tool' && step.name === tool.name && !step.error) throw new ReviewComplete();
          },
        });
        requireBatchProcessed();
        if (!decision) {
          const failed = result.steps.findLast((step) => step.kind === 'tool' && step.error);
          throw new Error(failed?.kind === 'tool' ? failed.error : 'The personal agent did not record a communication decision.');
        }
      } catch (error) {
        if (!(error instanceof ReviewComplete)) throw error;
      }
      if (controller.signal.aborted || this.stopped || !decision) return;
      const effects: PrincipalEffects = { negotiations, messages: [], retiredQuestionIds: decision.retireQuestionIds ?? [], delegations: [] };
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

      effects.delegations = (decision.delegations ?? []).map(({ opportunityId, brief }) => ({
        opportunityId,
        brief: brief.trim(),
        id: crypto.randomUUID(),
        sourceMessageId: latestPrincipalInput(records.messages)!,
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
      for (const questionId of effects.retiredQuestionIds) {
        const question = pendingQuestions.find((entry) => entry.id === questionId)!;
        this.host.event?.({ type: 'question.retired', inputId: input.id, questionId, batchId: question.batchId });
      }
      const questionIds = effects.messages.filter((entry) => entry.kind === 'question').map((entry) => entry.questionId!);
      for (const questionId of questionIds) this.host.event?.({ type: 'question.asked', inputId: input.id, questionId, batchId });
      for (const delegation of effects.delegations) {
        this.host.event?.({ type: 'delegation.brief_saved', inputId: input.id, delegationId: delegation.id, opportunityId: delegation.opportunityId, source: 'review' });
      }
      this.host.event?.({ type: 'h2a.review_completed', inputId: input.id, questionIds, delegatedIds: effects.delegations.map((entry) => entry.opportunityId) });
      if (hasEffects) {
        await this.refresh();
        this.host.changed();
      }
      if (effects.delegations.length) this.host.delegated(effects.delegations.map(({ opportunityId }) => opportunityId));
    } catch (error) {
      if (!controller.signal.aborted && !this.stopped) {
        this.failure = error instanceof Error ? error : new Error(String(error));
        this.host.error(this.failure.message);
      }
    } finally {
      if (this.reviewController === controller) this.reviewController = undefined;
      this.host.changed();
      if (!this.stopped && openedIds.size) this.host.delegated([...openedIds]);
    }
  }

  private validate(value: Decision, records: PrincipalRecordsView, pending: readonly PrincipalQuestion[], negotiations: Negotiation[]): void {
    if (!records.standingBrief) throw new Error('Save a standing brief before completing this review.');
    if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !['message', 'questions', 'retireQuestionIds', 'delegations'].includes(key))) throw new Error('Provide a review decision using only the offered fields.');
    if (value.message !== undefined && (typeof value.message !== 'string' || !value.message.trim())) throw new Error('A reply must be nonempty.');
    if (value.retireQuestionIds !== undefined && (!validPrincipalQuestionRetirements(records, value.retireQuestionIds) || !value.retireQuestionIds.length)) {
      throw new Error('Retire distinct pending question IDs only when later principal evidence makes them obsolete; lifecycle events cannot retire questions.');
    }
    if (value.questions !== undefined) {
      if (!Array.isArray(value.questions) || value.questions.length < 1 || value.questions.length > 3) throw new Error('Ask 1–3 independent questions.');
      if (pending.some((question) => !value.retireQuestionIds?.includes(question.id))) throw new Error('Keep remaining questions stable until answered or explicitly retired; do not append or replace them.');
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
