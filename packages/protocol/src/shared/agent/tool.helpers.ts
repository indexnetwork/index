import type { Id } from '../interfaces/database.interface.js';
import type { OpportunityGraphDeps } from '../../opportunities/opportunity.graph.shared.js';
import type { OpportunityMutationOutcome } from '../../opportunities/opportunity.graph.modes.js';
import { z } from "zod";
import type { ModelConfig } from "./model.config.js";
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "./tool.scope.js";
import type { ToolScopeType } from "./tool.scope.js";
import type { UserIdentity } from "../schemas/identity.schema.js";
import type { ChatGraphCompositeDatabase, CreateOpportunityData, NetworkMembership, UserRecord, UserDatabase, SystemDatabase, NegotiationGraphDatabase } from "../interfaces/database.interface.js";
import type { Scraper } from "../interfaces/scraper.interface.js";
import type { Cache, HydeCache } from "../interfaces/cache.interface.js";
import type { ContactServiceAdapter } from "../../contacts/contact.repository.port.js";
import type { ProfileEnricher } from "../interfaces/enrichment.interface.js";
import type { IntentGraphQueue } from "../interfaces/queue.interface.js";
import type { ChatSessionReader } from "../interfaces/chat-session.interface.js";
import type { ChatSummaryReader } from "../interfaces/chat-summary.interface.js";
import type { ChatMessageWriter } from "../interfaces/chat-message-writer.interface.js";
import type { NegotiationSummaryReader } from "../interfaces/negotiation-summary.interface.js";
import type { Embedder } from "../interfaces/embedder.interface.js";
import type { AgentDatabase } from "../../agents/agent.repository.port.js";
import type { NegotiationTimeoutQueue } from "../interfaces/negotiation-events.interface.js";
import type { AgentDispatcher } from "../interfaces/agent-dispatcher.interface.js";
import type { DeliveryLedger } from "../interfaces/delivery-ledger.interface.js";
import type { NegotiatorMemoryToolsHost } from "../interfaces/negotiator-memory.interface.js";
import type { NegotiatorAnswerToolsHost } from "../interfaces/negotiator-answer.interface.js";
import type { NegotiatorVerdictToolsHost } from "../interfaces/negotiator-verdict.interface.js";
import type { QuestionerEnqueueFn } from "../../questions/question.input.js";
import type { EnrichmentRunQueue, EnrichmentRunStore } from "../interfaces/enrichment-run.interface.js";
import type { McpActivityCaller } from "./activity-projection.js";

export type IdentityContext = UserIdentity | null;

export interface ToolErrorReport {
  operation: string;
  subsystem?: string;
  toolName?: string;
  userId?: string;
  tags?: Record<string, string | number | boolean | null | undefined>;
  context?: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILED GRAPH TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal interface for an invokable compiled LangGraph. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledGraph = { invoke: (input: any) => Promise<any> };

/** Composition-only hook kept structural so shared contracts do not own opportunity runtime. */
export type StampNewbornOpportunitiesFn = (input: {
  ownerUserId: string;
  intentId: string;
  items: CreateOpportunityData[];
}) => Promise<CreateOpportunityData[]>;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolved context available to every tool handler.
 * Contains the current user and optional network identity, resolved from DB at init.
 * The LLM can see this context (via system prompt) but cannot change it.
 */
export interface ResolvedToolContext {
  // Legacy flat fields (kept for backwards compatibility in tools/prompts).
  userId: string;
  userName: string;
  userEmail: string;
  /** Legacy focused network alias. Prefer `scopeType`/`scopeId` in new code. */
  networkId?: string;
  /** Focused request scope type: `network` for community focus, `intent` for selected-intent focus. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. Network scope uses a network id; intent scope uses an intent id. */
  scopeId?: string;
  indexName?: string;
  /** True when chat is network-scoped and the user owns the index. */
  isOwner?: boolean;
  // Rich identity context for prompt/tool orchestration.
  user: UserRecord;
  userProfile: IdentityContext;
  userNetworks: NetworkMembership[];
  /**
   * @deprecated indexScope is legacy concrete network reach. New code should derive reach
   * from `scopeType`/`scopeId` plus `userNetworks` via `tool.scope.ts`.
   * Removed after call sites are migrated in this plan.
   */
  indexScope: string[];
  scopedIndex?: {
    id: string;
    title: string;
    prompt: string | null;
    permissions?: Record<string, unknown>;
  };
  scopedMembershipRole?: "owner" | "member";
  /** True when user has not completed onboarding (onboarding.completedAt is null). */
  isOnboarding: boolean;
  /** True when the user has a non-empty name. */
  hasName: boolean;
  /** Chat session ID when tools are used in a chat; used for draft opportunities (context.conversationId). */
  sessionId?: string;
  /** True when the request originates from an MCP transport (no interactive UI available). */
  isMcp?: boolean;
  /** Agent ID when the request originates from an API key linked to an agent. */
  agentId?: string;
  /**
   * Typed resolved MCP caller context, set only by the MCP server after the
   * capability subject is resolved. Tools with permission-projected output
   * (currently `read_activity_summary`) pass it into the centralized
   * projection in `activity-projection.ts`. Absent on REST/chat surfaces,
   * which are owner-trusted and receive the full owner view.
   */
  mcpCaller?: McpActivityCaller;
}

/**
 * Dependencies passed when creating tools for a user session.
 * Includes DB adapters, embedder, and scraper.
 *
 * Note: userDb and systemDb are optional inputs - if not provided, createChatTools
 * will create them internally from the chatDatabaseAdapter singleton.
 */
/** Complete host binding set used only to derive request and composition ports. */
interface ToolContextBindings {
  userId: string;
  /** @deprecated Use userDb or systemDb instead. Kept for backwards compatibility. */
  database: ChatGraphCompositeDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. Created internally if not provided. */
  userDb?: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared networks. Created internally if not provided. */
  systemDb?: SystemDatabase;
  embedder: Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this network; converted to `{ scopeType: 'network', scopeId: networkId }` at the boundary. */
  networkId?: string;
  /** Focused request scope type: `network` or `intent`. */
  scopeType?: ToolScopeType;
  /** Focused request scope id. Network scope uses a network id; intent scope uses an intent id. */
  scopeId?: string;
  /** @deprecated indexScope is legacy; use `scopeType`/`scopeId`, retained until wiring phases migrate call sites. */
  indexScope?: string[];
  /** Chat session ID when creating tools for a chat; enables draft opportunities with context.conversationId. */
  sessionId?: string;

  // ─── Protocol-level dependencies (injected by composition root) ──────────
  /** General-purpose cache (e.g. for tool results). */
  cache: Cache;
  /** Dedicated cache for HyDE graph (may be same instance as cache). */
  hydeCache: HydeCache;
  /** Queue for enqueuing follow-up intent processing (HyDE generation/deletion). */
  intentQueue: IntentGraphQueue;
  /** Contact management operations. */
  contactService: ContactServiceAdapter;
  /** Chat session reader for loading conversation history. */
  chatSession: ChatSessionReader;
  /** Read-through chat-session digest. Optional; consumers fall back to undefined `chatContext`. */
  chatSummary?: ChatSummaryReader;
  /** Writes user messages into the user's most-recent chat session (Slice 5 MCP elicitation). */
  chatMessageWriter?: ChatMessageWriter;
  /**
   * Optional async question enqueue callback. When provided, question generation
   * is dispatched asynchronously to the QuestionerQueue instead of running inline.
   * Injected by the composition root when QUESTIONER_ENABLED=true.
   */
  questionerEnqueue?: QuestionerEnqueueFn;
  /** Negotiation-digest summarizer. Optional; consumers fall back to deterministic digests. */
  negotiationSummary?: NegotiationSummaryReader;
  /** Durable host persistence for verified intent proposals shown in chat. */
  intentProposalStore?: import('../../intents/intent.proposal.js').IntentProposalStore;
  /**
   * Host bridge for the negotiator persona's `remember`/`forget` memory
   * tools (P5.4). Injected by the composition root only when negotiator
   * memory writes are enabled; when absent the tools are not registered.
   * Consumed exclusively by the negotiator persona toolset — the
   * orchestrator registry never sees these tools.
   */
  negotiatorMemoryTools?: NegotiatorMemoryToolsHost;
  /**
   * Host bridge for the negotiator persona's `answer_pending_question` tool —
   * the long-tail lane of answer routing, for replies the deterministic
   * precedence gate declined. Injected by the composition root; consumed
   * exclusively by the negotiator persona's toolset, and only in an
   * intent-scoped session (the question lives in one signal's DM).
   */
  negotiatorAnswerTools?: NegotiatorAnswerToolsHost;
  /**
   * Host bridge for the negotiator persona's `reject_opportunity` /
   * `accept_opportunity` tools — the owner's VERDICT lane, which had no lever
   * in chat at all before #1471. Injected by the composition root; consumed
   * exclusively by the negotiator persona's toolset, and only in an
   * intent-scoped session (the counterparties are one signal's).
   */
  negotiatorVerdictTools?: NegotiatorVerdictToolsHost;
  /**
   * Resolve a user's global user_context paragraph (profile-replacing identity
   * text), generating it on demand when absent. Mirrors `ToolDeps.getUserContextText`
   * so chat-path tool factories can forward it.
   */
  getUserContextText?: (userId: string) => Promise<string>;
  /** Profile enrichment from external data sources. */
  enricher: ProfileEnricher;
  /** Database adapter for negotiations/conversation operations. */
  negotiationDatabase: NegotiationGraphDatabase;
  /** Factory for user-scoped database access. */
  createUserDatabase: (db: ChatGraphCompositeDatabase, userId: string) => UserDatabase;
  /** Factory for system-scoped database access. */
  createSystemDatabase: (db: ChatGraphCompositeDatabase, userId: string, indexScope: string[], embedder?: Embedder) => SystemDatabase;
  /** Optional runtime LLM config. Pass to override env vars for API key, model, etc. */
  modelConfig?: ModelConfig;
  /** Manages negotiation timeout jobs (optional — enables AI fallback on external agent timeout). */
  negotiationTimeoutQueue?: NegotiationTimeoutQueue;
  /** Agent registry database adapter (optional — absent when host does not support agents). */
  agentDatabase?: AgentDatabase;
  /** Grants the default system-agent permissions after onboarding (optional). */
  grantDefaultSystemPermissions?: (userId: string) => Promise<void>;
  /** Dispatcher for routing negotiation turns to personal agents (optional — falls back to system AI). */
  agentDispatcher?: AgentDispatcher;
  /** Enqueue a negotiate_existing job after introducer approval (optional). */
  queueNegotiateExisting?: (opportunityId: string, userId: string) => Promise<void>;
  /** Host callback for pre-insert newborn pool-preference stamping (optional). */
  stampNewbornOpportunities?: StampNewbornOpportunitiesFn;
  /** Delivery ledger for committing opportunity delivery rows (optional — absent in chat context). */
  deliveryLedger?: DeliveryLedger;
  /** Persistence for async MCP profile runs (optional — absent in non-MCP/test contexts). */
  enrichmentRuns?: EnrichmentRunStore;
  /** Queue for async MCP profile run execution (optional — absent in non-MCP/test contexts). */
  enrichmentRunQueue?: EnrichmentRunQueue;
  /** Frontend base URL for building profile links (e.g. https://index.network, optional). */
  frontendUrl?: string;
  /** API base URL for building opportunity accept links (e.g. https://protocol.index.network, optional). */
  apiBaseUrl?: string;
  /** Optional host-side error reporter for swallowed protocol/tool errors. */
  reportToolError?: (error: unknown, report: ToolErrorReport) => void;
  /**
   * Optional host-side per-principal MCP call throttle. Invoked once per MCP
   * tool dispatch (after identity resolves, before any DB work). When the
   * returned decision is `allowed: false`, the dispatch short-circuits with a
   * rate-limit error carrying `retryAfterSec`. Absent in chat/test contexts.
   */
  mcpRateLimiter?: (input: { userId: string; agentId?: string; toolName: string }) => Promise<{
    allowed: boolean;
    retryAfterSec?: number;
    limit?: number;
    scope?: 'tool' | 'principal';
  }>;
}

/** Per-request chat identity, scope, and adapter inputs. */
export type ChatToolRequest = Pick<ToolContextBindings,
  'userId' | 'userDb' | 'systemDb' | 'networkId' | 'scopeType' | 'scopeId'
  | 'indexScope' | 'sessionId'
>;

/** Host-owned bindings injected into a chat request at the composition boundary. */
export type ChatToolHostDeps = Omit<ToolContextBindings, keyof ChatToolRequest>;

/**
 * Compatibility context for the chat factory.
 *
 * New tool factories receive capability-specific `*ToolDeps` ports, while
 * this request-plus-host intersection keeps existing chat/persona consumers
 * structurally compatible during incremental migration.
 */
export type ToolContext = ChatToolRequest & ChatToolHostDeps;

/**
 * All host dependencies needed to initialize the protocol chat engine.
 * User and system database views are created per request unless supplied by a
 * compatibility caller.
 */
export type ProtocolDeps = ChatToolHostDeps;

/**
 * Thrown when a requested chat scope is invalid for the authenticated user.
 * Controllers can map this to an HTTP status code.
 */
export class ChatContextAccessError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: "USER_NOT_FOUND" | "INDEX_NOT_FOUND" | "INDEX_MEMBERSHIP_REQUIRED"
  ) {
    super(message);
    this.name = "ChatContextAccessError";
  }
}

/**
 * Resolve the canonical context used by chat tools and system prompt.
 * This preloads user identity, profile, network memberships, and scoped index role.
 */
export async function resolveChatContext(params: {
  database: Pick<
    ChatGraphCompositeDatabase,
    "getUser" | "getProfile" | "getNetworkMemberships" | "getNetworkMembership" | "getNetwork" | "isIndexOwner" | "isNetworkMember" | "getUserContext"
  >;
  userId: string;
  networkId?: string;
  /** Chat session ID for draft opportunities (stored as context.conversationId). */
  sessionId?: string;
}): Promise<ResolvedToolContext> {
  const { database, userId, networkId, sessionId } = params;

  const [user, rawProfile, userNetworks, globalContext] = await Promise.all([
    database.getUser(userId),
    database.getProfile(userId),
    database.getNetworkMemberships(userId),
    // The premise-derived global user_context paragraph. getProfile deliberately
    // leaves `context` empty (WS8: narrative lives in user_contexts, not users);
    // without this read the system prompt's only narrative is the stale onboarding
    // bio, which resurrects facts the user has since retracted. Best-effort: a
    // missing row or a minimal test adapter degrades to the empty string.
    Promise.resolve()
      .then(() => database.getUserContext?.(userId, null))
      .catch(() => null),
  ]);

  const userProfile: IdentityContext = rawProfile ?? null;
  if (userProfile && !userProfile.context && globalContext?.text) {
    userProfile.context = globalContext.text;
  }

  if (!user) {
    throw new ChatContextAccessError(
      "User not found",
      404,
      "USER_NOT_FOUND"
    );
  }

  let scopedIndex: ResolvedToolContext["scopedIndex"] = undefined;
  let scopedMembershipRole: ResolvedToolContext["scopedMembershipRole"] = undefined;
  let isOwner = false;
  let indexName: string | undefined;

  if (networkId) {
    const [index, isMember, owner] = await Promise.all([
      database.getNetwork(networkId),
      database.isNetworkMember(networkId, userId),
      database.isIndexOwner(networkId, userId),
    ]);

    if (!index) {
      throw new ChatContextAccessError(
        "Index not found",
        404,
        "INDEX_NOT_FOUND"
      );
    }

    if (!isMember) {
      throw new ChatContextAccessError(
        "You are not a member of this network",
        403,
        "INDEX_MEMBERSHIP_REQUIRED"
      );
    }

    let membership = userNetworks.find((m) => m.networkId === index.id);
    if (membership === undefined) {
      membership = (await database.getNetworkMembership(index.id, userId)) ?? undefined;
    }
    scopedIndex = {
      id: index.id,
      title: index.title,
      prompt: membership?.indexPrompt ?? null,
      permissions: index.permissions ?? {},
    };
    isOwner = owner;
    indexName = index.title;
    scopedMembershipRole = owner ? "owner" : "member";
  }

  const userName = user.name ?? "Unknown";
  const userEmail = user.email ?? "";
  const hasName = !!user.name?.trim();

  const scope = scopeFromNetworkId(networkId);

  // Deprecated compatibility reach. New call sites should call
  // deriveAllowedNetworkIds({ memberships: userNetworks, ...scope }) directly.
  const allowedNetworkIds = deriveAllowedNetworkIds({
    memberships: userNetworks,
    ...scope,
  });

  return {
    userId,
    userName,
    userEmail,
    networkId,
    ...scope,
    indexName,
    isOwner,
    user,
    userProfile,
    userNetworks,
    indexScope: allowedNetworkIds,
    scopedIndex,
    scopedMembershipRole,
    isOnboarding: !(user.onboarding?.completedAt),
    hasName,
    ...(sessionId !== undefined ? { sessionId } : {}),
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// DEFINE TOOL TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Type for the `defineTool` closure created in `createChatTools`.
 * Auto-injects resolved context and provides uniform logging / error handling.
 */
export type DefineTool = <T extends z.ZodType>(opts: {
  name: string;
  description: string;
  querySchema: T;
  handler: (input: { context: ResolvedToolContext; query: z.infer<T> }) => Promise<string>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
}) => any;

/**
 * A raw tool definition before LangChain wrapping.
 * Used by the tool registry for direct HTTP invocation.
 */
export interface RawToolDefinition {
  name: string;
  description: string;
  schema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

/**
 * Registry mapping tool names to their raw definitions.
 */
export type ToolRegistry = Map<string, RawToolDefinition>;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL DEPENDENCIES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Shared dependencies available to all tool domain factories.
 * Passed by `createChatTools` after compiling all subgraphs.
 */
/**
 * Host bindings available while composing the protocol tool registry.
 *
 * This is deliberately not exported as a consumer contract. Individual tool
 * factories receive the use-case ports below; `ToolDeps` remains the complete
 * compatibility shape only for registry/composition callers during migration.
 */
interface ToolDepsBindings {
  /** @deprecated Use userDb or systemDb instead. Kept for backwards compatibility. */
  database: ChatGraphCompositeDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. */
  userDb: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared networks. */
  systemDb: SystemDatabase;
  /** Durable host persistence for verified intent proposals shown in chat. */
  intentProposalStore?: import('../../intents/intent.proposal.js').IntentProposalStore;
  scraper: Scraper;
  embedder: import('../interfaces/embedder.interface.js').Embedder;
  cache: Cache;
  contactService: ContactServiceAdapter;
  enricher: ProfileEnricher;
  /** Database adapter for negotiations/conversation operations. */
  negotiationDatabase: NegotiationGraphDatabase;
  /** Chat session reader for exposing the caller's past conversations as MCP tools. */
  chatSession?: ChatSessionReader;
  /** Read-through chat-session digest. Optional; consumers fall back to undefined `chatContext`. */
  chatSummary?: ChatSummaryReader;
  /**
   * Test seam for opportunity card presentation helpers. Production
   * compositions leave this unset so tools construct the real presenter.
   */
  opportunityPresentation?: {
    createPresenter?: () => { presentCard(input: unknown): Promise<unknown> };
    gatherPresenterContext?: (...args: unknown[]) => Promise<unknown>;
  };
  /** Writes user messages into the user's most-recent chat session (Slice 5 MCP elicitation). */
  chatMessageWriter?: ChatMessageWriter;
  /**
   * Optional async question enqueue callback. When provided, question generation
   * is dispatched asynchronously to the QuestionerQueue. Injected by the
   * composition root when QUESTIONER_ENABLED=true.
   */
  questionerEnqueue?: QuestionerEnqueueFn;
  /** Negotiation-digest summarizer. Optional; consumers fall back to deterministic digests. */
  negotiationSummary?: NegotiationSummaryReader;
  /** Manages negotiation timeout jobs (optional — enables AI fallback on external agent timeout). */
  negotiationTimeoutQueue?: NegotiationTimeoutQueue;
  /** Agent registry database adapter (optional — absent when host does not support agents). */
  agentDatabase?: AgentDatabase;
  /** Grants the default system-agent permissions after onboarding (optional). */
  grantDefaultSystemPermissions?: (userId: string) => Promise<void>;
  /** Dispatcher for routing negotiation turns to personal agents (optional — falls back to system AI). */
  agentDispatcher?: AgentDispatcher;
  /** Host callback for pre-insert newborn pool-preference stamping (optional). */
  stampNewbornOpportunities?: StampNewbornOpportunitiesFn;
  /** Delivery ledger for committing opportunity delivery rows (optional — absent in chat context). */
  deliveryLedger?: DeliveryLedger;
  /** Persistence for async MCP profile runs (optional — absent in non-MCP/test contexts). */
  enrichmentRuns?: EnrichmentRunStore;
  /** Queue for async MCP profile run execution (optional — absent in non-MCP/test contexts). */
  enrichmentRunQueue?: EnrichmentRunQueue;
  /** Frontend base URL for building profile links (e.g. https://index.network, optional). */
  frontendUrl?: string;
  /** API base URL for building opportunity accept links (e.g. https://protocol.index.network, optional). */
  apiBaseUrl?: string;
  /** Optional host-side error reporter for swallowed protocol/tool errors. */
  reportToolError?: (error: unknown, report: ToolErrorReport) => void;
  /**
   * Optional host-side per-principal MCP call throttle. Invoked once per MCP
   * tool dispatch (after identity resolves, before any DB work). When the
   * returned decision is `allowed: false`, the dispatch short-circuits with a
   * rate-limit error carrying `retryAfterSec`. Absent in chat/test contexts.
   */
  mcpRateLimiter?: (input: { userId: string; agentId?: string; toolName: string }) => Promise<{
    allowed: boolean;
    retryAfterSec?: number;
    limit?: number;
    scope?: 'tool' | 'principal';
  }>;
  /**
   * The non-discovery opportunity operations (`update_opportunity` and its
   * send variant). Defaults to the plain functions in
   * `opportunity.graph.modes.ts`; injected by tests to observe the call.
   */
  opportunityOperations?: OpportunityOperations;
  graphs: {
    profile: CompiledGraph;
    intent: CompiledGraph;
    index: CompiledGraph;
    networkMembership: CompiledGraph;
    intentIndex: CompiledGraph;
    opportunity: CompiledGraph;
    premise: CompiledGraph;
  };
  /**
   * Optional network ranking override for `read_networks`. Injected by tests or custom compositions.
   * When absent, defaults to `NetworkRecommender.invoke()` with a lazy module-level singleton.
   */
  networkRanker?: (input: {
    userContext: string;
    networks: Array<{ networkId: string; renderedContext: string }>;
  }) => Promise<{ rankedNetworkIds: string[] } | null>;
  /**
   * Resolve a user's global user_context paragraph (profile-replacing identity text),
   * generating it on demand when absent. Injected by the backend composition root
   * (`ensureGlobalUserContext`). When absent, onboarding network ranking is skipped.
   */
  getUserContextText?: (userId: string) => Promise<string>;
}

/**
 * Shared backing shape for the registry composition boundary. Capability-local
 * ports may Pick from this type, but it is intentionally not a root export.
 */
export type ToolRegistryCompositionDeps = Omit<ToolDepsBindings,
  'embedder' | 'chatMessageWriter' | 'apiBaseUrl' | 'mcpRateLimiter'
>;

/** Runtime-only hooks retained for MCP and existing host composition. */
type ToolRuntimeCompatibilityDeps = Pick<ToolDepsBindings,
  'embedder' | 'chatMessageWriter' | 'apiBaseUrl' | 'mcpRateLimiter'
>;

/**
 * Legacy complete tool composition contract.
 *
 * New capability factories must accept their named `*ToolDeps` port above,
 * rather than this aggregate. Keeping the intersection preserves structural
 * compatibility for the registry and host composition while consumers migrate.
 */
export type ToolDeps =
  & ToolRegistryCompositionDeps
  & ToolRuntimeCompatibilityDeps;

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL RESULT HELPERS
// ═══════════════════════════════════════════════════════════════════════════════

export function success<T>(data: T): string {
  return JSON.stringify({ success: true, data });
}

export function error(
  message: string,
  debugSteps?: Array<{ step: string; detail?: string; data?: Record<string, unknown> }>
): string {
  return JSON.stringify({
    success: false,
    error: message,
    ...(debugSteps?.length ? { debugSteps } : {}),
  });
}

/** Return needsClarification for missing required fields. */
export function needsClarification(params: {
  missingFields: string[];
  message: string;
}): string {
  return JSON.stringify({
    success: false,
    needsClarification: true,
    ...params,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
// CONSTANTS & UTILITIES
// ═══════════════════════════════════════════════════════════════════════════════

/** Matches http/https URLs in text; captures full URL. */
const URL_IN_TEXT_REGEX = /https?:\/\/[^\s"'<>)\]]+/gi;

/**
 * Matches bare domain URLs without protocol (e.g. github.com/foo, www.example.com).
 * Requires at least a SLD.TLD pattern followed by optional path.
 * Negative lookbehind ensures we don't double-match URLs already caught by URL_IN_TEXT_REGEX.
 */
const BARE_URL_REGEX = /(?<!\w:\/\/)(?<![/\w])(?:www\.)?[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.(?:com|org|net|io|dev|co|ai|app|xyz|me|info|gg|so|sh|cc|ly|fm|tv|to|tech|design|network|world|edu|gov|mil|int|us|uk|eu|de|fr|ca|au|jp|cn|in|br|nl|se|no|fi|dk|ch|at|be|it|es|pt|pl|cz|ru|kr|tw|hk|sg|nz|za|mx|ar|cl|id|ph|th|vn|my|ie)(?:\/[^\s"'<>)\]]*)?/gi;

/** UUID v4 format: 8-4-4-4-12 hex chars (e.g. c2505011-2e45-426e-81dd-b9abb9b72023) */
export const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Resolves an array of network IDs to their display titles.
 * Skips any IDs that don't resolve (deleted or invalid networks).
 */
export async function resolveIndexNames(
  database: { getNetwork(id: string): Promise<{ id: string; title: string } | null> },
  networkIds: string[]
): Promise<string[]> {
  if (networkIds.length === 0) return [];
  const results = await Promise.all(
    networkIds.map(id => database.getNetwork(id))
  );
  return results.filter(Boolean).map(idx => idx!.title);
}

/**
 * Normalize a URL string: if it lacks a protocol, prepend "https://".
 * Returns the normalized URL or null if the result is not a valid URL.
 */
export function normalizeUrl(raw: string): string | null {
  let url = raw.replace(/[.,;:!?)]+$/, "").trim();
  if (!/^https?:\/\//i.test(url)) {
    url = `https://${url}`;
  }
  try {
    new URL(url);
    return url;
  } catch {
    return null;
  }
}

/**
 * Extract unique, valid URLs from a string (e.g. user message or details).
 * Handles both full URLs (https://...) and bare domains (github.com/...).
 */
export function extractUrls(text: string): string[] {
  if (!text || typeof text !== "string") return [];

  const seen = new Set<string>();
  const out: string[] = [];

  // Pass 1: full protocol URLs
  const fullMatches = text.match(URL_IN_TEXT_REGEX) ?? [];
  for (const raw of fullMatches) {
    const url = normalizeUrl(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  // Pass 2: bare domain URLs (e.g. github.com/foo)
  const bareMatches = text.match(BARE_URL_REGEX) ?? [];
  for (const raw of bareMatches) {
    const url = normalizeUrl(raw);
    if (url && !seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }

  return out;
}

const SENSITIVE_FIELD_KEYS = new Set([
  "secret",
  "webhooksecret",
  "password",
  "apikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "privatekey",
  "authtoken",
  "bearertoken",
  "clientsecret",
]);

/**
 * Recursively redacts sensitive field values from an arbitrary payload before
 * it is passed to a structured logger. Matches field names case-insensitively
 * and ignoring underscores, so `api_key`, `apiKey`, and `API_KEY` all match.
 * Non-sensitive fields are passed through unchanged. Never mutates the input —
 * returns a new value.
 *
 * Intended for structured-log redaction only. Do NOT use as a security
 * boundary for data in motion.
 *
 * @param value - Arbitrary JSON-like payload (query object, config blob, etc.)
 * @returns A new value with sensitive fields replaced by `"[redacted]"`.
 */
export function redactSensitiveFields(value: unknown): unknown {
  if (value === null || typeof value !== "object") return value;
  if (Array.isArray(value)) {
    return value.map((item) => redactSensitiveFields(item));
  }
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    const normalized = key.toLowerCase().replace(/_/g, "");
    if (SENSITIVE_FIELD_KEYS.has(normalized)) {
      out[key] = "[redacted]";
    } else {
      out[key] = redactSensitiveFields(inner);
    }
  }
  return out;
}

/** The subset of opportunity modes the tool layer invokes. */
export interface OpportunityOperations {
  updateOpportunityStatus: (
    deps: Pick<OpportunityGraphDeps, 'database'>,
    request: { userId: Id<'users'>; opportunityId: string | undefined; newStatus: string | undefined },
  ) => Promise<OpportunityMutationOutcome>;
  sendOpportunity: (
    deps: Pick<OpportunityGraphDeps, 'database' | 'queueNotification'>,
    request: { userId: Id<'users'>; opportunityId: string | undefined },
  ) => Promise<OpportunityMutationOutcome>;
}
