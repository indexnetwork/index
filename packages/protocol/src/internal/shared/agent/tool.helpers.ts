import type { Id } from '../../../platform/database.js';
import { ChatContextAccessError } from '../../../platform/runtime/errors.js';
import type { OpportunityGraphDeps } from '../../opportunities/opportunity.graph.shared.js';
import type { OpportunityMutationOutcome } from '../../opportunities/opportunity.graph.modes.js';
import { z } from "zod";
import type { ModelConfig } from "./model.config.js";
import { deriveAllowedNetworkIds, scopeFromNetworkId } from "./tool.scope.js";
import type { ToolScopeType } from "./tool.scope.js";
import type { UserIdentity } from "../../../protocol/schemas/identity.schema.js";
import type { CompositeToolDatabase, CreateOpportunityData, NetworkMembership, UserRecord, UserDatabase, SystemDatabase } from "../../../platform/database.js";
import type { Scraper } from "../../../platform/discovery/scraper.js";
import type { Cache, HydeCache } from "../../../platform/discovery/cache.js";
import type { ProfileEnricher } from "../../../platform/enrichment/ports.js";
import type { IntentFollowUp } from "../../../platform/runtime/follow-up.js";
import type { Embedder } from "../../../platform/discovery/embedder.js";
import type { AgentDatabase } from "../../agents/agent.repository.port.js";
import type { NegotiatorVerdictToolsHost } from "../../../platform/negotiation/verdict.js";

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
  networkName?: string;
  /** True when chat is network-scoped and the user owns the network. */
  isOwner?: boolean;
  // Rich identity context for prompt/tool orchestration.
  user: UserRecord;
  userProfile: IdentityContext;
  userNetworks: NetworkMembership[];
  /**
   * @deprecated networkScope is legacy concrete network reach. New code should derive reach
   * from `scopeType`/`scopeId` plus `userNetworks` via `tool.scope.ts`.
   * Removed after call sites are migrated in this plan.
   */
  networkScope: string[];
  scopedNetwork?: {
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
  database: CompositeToolDatabase;
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
  /** @deprecated networkScope is legacy; use `scopeType`/`scopeId`, retained until wiring phases migrate call sites. */
  networkScope?: string[];
  /** Chat session ID when creating tools for a chat; enables draft opportunities with context.conversationId. */
  sessionId?: string;

  // ─── Protocol-level dependencies (injected by composition root) ──────────
  /** General-purpose cache (e.g. for tool results). */
  cache: Cache;
  /** Dedicated cache for HyDE graph (may be same instance as cache). */
  hydeCache: HydeCache;
  /** Queue for enqueuing follow-up intent processing (HyDE generation/deletion). */
  intentFollowUp: IntentFollowUp;
  /**
   * Host bridge for the `reject_opportunity` / `accept_opportunity` tools —
   * the owner's VERDICT lane (#1471). Injected by the composition root;
   * consumed by the MCP opportunity toolset, and only in an intent-scoped
   * session (the counterparties are one signal's).
   */
  negotiatorVerdictTools?: NegotiatorVerdictToolsHost;
  /** Profile enrichment from external data sources. */
  enricher: ProfileEnricher;
  /** Factory for user-scoped database access. */
  createUserDatabase: (db: CompositeToolDatabase, userId: string) => UserDatabase;
  /** Factory for system-scoped database access. */
  createSystemDatabase: (db: CompositeToolDatabase, userId: string, networkScope: string[], embedder?: Embedder) => SystemDatabase;
  /** Optional runtime LLM config. Pass to override env vars for API key, model, etc. */
  modelConfig?: ModelConfig;
  /** Agent registry database adapter (optional — absent when host does not support agents). */
  agentDatabase?: AgentDatabase;
  /** Grants the default system-agent permissions after onboarding (optional). */
  grantDefaultSystemPermissions?: (userId: string) => Promise<void>;
  /** Host callback for pre-insert newborn pool-preference stamping (optional). */
  stampNewbornOpportunities?: StampNewbornOpportunitiesFn;
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
   * rate-limit error carrying `retryAfterSec`. Absent in test contexts.
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
  | 'networkScope' | 'sessionId'
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
export { ChatContextAccessError } from "../../../platform/runtime/errors.js";

/**
 * Resolve the canonical context used by chat tools and system prompt.
 * This preloads user identity, profile, network memberships, and scoped network role.
 */
export async function resolveChatContext(params: {
  database: Pick<
    CompositeToolDatabase,
    "getUser" | "getProfile" | "getNetworkMemberships" | "getNetworkMembership" | "getNetwork" | "isNetworkOwner" | "isNetworkMember" | "getUserContext"
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
    // Best-effort narrative for chat context. getProfile leaves `context` empty;
    // getUserContext synthesizes a short paragraph from users.name/intro/location.
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

  let scopedNetwork: ResolvedToolContext["scopedNetwork"] = undefined;
  let scopedMembershipRole: ResolvedToolContext["scopedMembershipRole"] = undefined;
  let isOwner = false;
  let networkName: string | undefined;

  if (networkId) {
    const [network, isMember, owner] = await Promise.all([
      database.getNetwork(networkId),
      database.isNetworkMember(networkId, userId),
      database.isNetworkOwner(networkId, userId),
    ]);

    if (!network) {
      throw new ChatContextAccessError(
        "Network not found",
        404,
        "NETWORK_NOT_FOUND"
      );
    }

    if (!isMember) {
      throw new ChatContextAccessError(
        "You are not a member of this network",
        403,
        "NETWORK_MEMBERSHIP_REQUIRED"
      );
    }

    let membership = userNetworks.find((m) => m.networkId === network.id);
    if (membership === undefined) {
      membership = (await database.getNetworkMembership(network.id, userId)) ?? undefined;
    }
    scopedNetwork = {
      id: network.id,
      title: network.title,
      prompt: membership?.networkPrompt ?? null,
      permissions: network.permissions ?? {},
    };
    isOwner = owner;
    networkName = network.title;
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
    networkName,
    isOwner,
    user,
    userProfile,
    userNetworks,
    networkScope: allowedNetworkIds,
    scopedNetwork,
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
  database: CompositeToolDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. */
  userDb: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared networks. */
  systemDb: SystemDatabase;
  scraper: Scraper;
  embedder: import('../../../platform/discovery/embedder.js').Embedder;
  cache: Cache;
  enricher: ProfileEnricher;
  /**
   * Host bridge behind the MCP-surface `reject_opportunity` /
   * `accept_opportunity` owner-verdict tools (#1471, one surface over).
   * Consumed only by the MCP tool registry surface, and only for
   * session-authenticated owners (capability matrix + provenance re-check).
   */
  negotiatorVerdictTools?: NegotiatorVerdictToolsHost;
  /**
   * Test seam for opportunity card presentation helpers. Production
   * compositions leave this unset so tools construct the real presenter.
   */
  opportunityPresentation?: {
    createPresenter?: () => { presentCard(input: unknown): Promise<unknown> };
    gatherPresenterContext?: (...args: unknown[]) => Promise<unknown>;
  };
  /** Agent registry database adapter (optional — absent when host does not support agents). */
  agentDatabase?: AgentDatabase;
  /** Grants the default system-agent permissions after onboarding (optional). */
  grantDefaultSystemPermissions?: (userId: string) => Promise<void>;
  /** Host callback for pre-insert newborn pool-preference stamping (optional). */
  stampNewbornOpportunities?: StampNewbornOpportunitiesFn;
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
    intent: CompiledGraph;
    network: CompiledGraph;
    networkMembership: CompiledGraph;
    intentNetwork: CompiledGraph;
    opportunity: CompiledGraph;
  };
  /**
   * Optional network ranking override for `read_networks`. Injected by tests or custom compositions.
   * When absent, defaults to `NetworkRecommender.invoke()` with a lazy module-level singleton.
   */
  networkRanker?: (input: {
    userContext: string;
    networks: Array<{ networkId: string; renderedContext: string }>;
  }) => Promise<{ rankedNetworkIds: string[] } | null>;
}

/**
 * Shared backing shape for the registry composition boundary. Capability-local
 * ports may Pick from this type, but it is intentionally not a root export.
 */
export type ToolRegistryCompositionDeps = Omit<ToolDepsBindings,
  'embedder' | 'apiBaseUrl' | 'mcpRateLimiter'
>;

/** Runtime-only hooks retained for MCP and existing host composition. */
type ToolRuntimeCompatibilityDeps = Pick<ToolDepsBindings,
  'embedder' | 'apiBaseUrl' | 'mcpRateLimiter'
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
export async function resolveNetworkNames(
  database: { getNetwork(id: string): Promise<{ id: string; title: string } | null> },
  networkIds: string[]
): Promise<string[]> {
  if (networkIds.length === 0) return [];
  const results = await Promise.all(
    networkIds.map(id => database.getNetwork(id))
  );
  return results.filter(Boolean).map(network => network!.title);
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
}
