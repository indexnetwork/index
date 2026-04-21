import { z } from "zod";
import type { ModelConfig } from "./model.config.js";
import type { ProfileDocument } from "../../profile/profile.generator.js";
import type {
  ChatGraphCompositeDatabase,
  NetworkMembership,
  UserRecord,
  UserDatabase,
  SystemDatabase,
  NegotiationDatabase,
} from "../interfaces/database.interface.js";
import type { Scraper } from "../interfaces/scraper.interface.js";
import type { Cache, HydeCache } from "../interfaces/cache.interface.js";
import type { CompiledOpportunityGraph } from "../../opportunity/opportunity.discover.js";
import type { IntegrationAdapter } from "../interfaces/integration.interface.js";
import type { ContactServiceAdapter } from "../interfaces/contact.interface.js";
import type { ProfileEnricher } from "../interfaces/enrichment.interface.js";
import type { IntentGraphQueue } from "../interfaces/queue.interface.js";
import type { ChatSessionReader } from "../interfaces/chat-session.interface.js";
import type { Embedder } from "../interfaces/embedder.interface.js";
import type { AgentDatabase } from "../interfaces/agent.interface.js";
import type { NegotiationTimeoutQueue } from "../interfaces/negotiation-events.interface.js";
import type { AgentDispatcher } from "../interfaces/agent-dispatcher.interface.js";
import type { DeliveryLedger } from "../interfaces/delivery-ledger.interface.js";

/** Profile without embedding — used in resolved context to avoid bloating prompts and memory. */
export type ProfileContext = Omit<ProfileDocument, "embedding"> | null;

// ═══════════════════════════════════════════════════════════════════════════════
// COMPILED GRAPH TYPE
// ═══════════════════════════════════════════════════════════════════════════════

/** Minimal interface for an invokable compiled LangGraph. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type CompiledGraph = { invoke: (input: any) => Promise<any> };

// ═══════════════════════════════════════════════════════════════════════════════
// TOOL CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Resolved context available to every tool handler.
 * Contains the current user and optional index identity, resolved from DB at init.
 * The LLM can see this context (via system prompt) but cannot change it.
 */
export interface ResolvedToolContext {
  // Legacy flat fields (kept for backwards compatibility in tools/prompts).
  userId: string;
  userName: string;
  userEmail: string;
  networkId?: string;
  indexName?: string;
  /** True when chat is index-scoped and the user owns the index. */
  isOwner?: boolean;

  // Rich identity context for prompt/tool orchestration (profile omits embedding to keep context lean).
  user: UserRecord;
  userProfile: ProfileContext;
  userNetworks: NetworkMembership[];
  scopedIndex?: {
    id: string;
    title: string;
    prompt: string | null;
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
export interface ToolContext {
  userId: string;
  /** @deprecated Use userDb or systemDb instead. Kept for backwards compatibility. */
  database: ChatGraphCompositeDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. Created internally if not provided. */
  userDb?: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared indexes. Created internally if not provided. */
  systemDb?: SystemDatabase;
  embedder: Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as default for read_intents and create_intent. */
  networkId?: string;
  /** Chat session ID when creating tools for a chat; enables draft opportunities with context.conversationId. */
  sessionId?: string;

  // ─── Protocol-level dependencies (injected by composition root) ──────────
  /** General-purpose cache (e.g. for tool results). */
  cache: Cache;
  /** Dedicated cache for HyDE graph (may be same instance as cache). */
  hydeCache: HydeCache;
  /** External integration platform adapter (OAuth, tool actions). */
  integration: IntegrationAdapter;
  /** Queue for enqueuing follow-up intent processing (HyDE generation/deletion). */
  intentQueue: IntentGraphQueue;
  /** Contact management operations. */
  contactService: ContactServiceAdapter;
  /** Chat session reader for loading conversation history. */
  chatSession: ChatSessionReader;
  /** Profile enrichment from external data sources. */
  enricher: ProfileEnricher;
  /** Database adapter for negotiation/conversation operations. */
  negotiationDatabase: NegotiationDatabase;
  /** Integration importer for bulk contact import from toolkits. */
  integrationImporter: {
    importContacts(userId: string, toolkit: string): Promise<{
      imported: number;
      skipped: number;
      newContacts: number;
      existingContacts: number;
    }>;
  };
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
  /** Delivery ledger for committing opportunity delivery rows (optional — absent in chat context). */
  deliveryLedger?: DeliveryLedger;
}

/**
 * All external dependencies needed to initialize the protocol tool engine.
 * The host application (composition root) must provide concrete implementations.
 * This is the subset of ToolContext that is NOT per-request (no userId, networkId, sessionId).
 */
export type ProtocolDeps = Omit<ToolContext, 'userId' | 'networkId' | 'sessionId' | 'userDb' | 'systemDb'>;

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
 * This preloads user identity, profile, index memberships, and scoped index role.
 */
export async function resolveChatContext(params: {
  database: Pick<
    ChatGraphCompositeDatabase,
    "getUser" | "getProfile" | "getNetworkMemberships" | "getNetworkMembership" | "getNetwork" | "isIndexOwner" | "isNetworkMember"
  >;
  userId: string;
  networkId?: string;
  /** Chat session ID for draft opportunities (stored as context.conversationId). */
  sessionId?: string;
}): Promise<ResolvedToolContext> {
  const { database, userId, networkId, sessionId } = params;

  const [user, rawProfile, userNetworks] = await Promise.all([
    database.getUser(userId),
    database.getProfile(userId),
    database.getNetworkMemberships(userId),
  ]);

  // Omit embedding from profile so resolved context stays lean (embedding is for search only).
  let userProfile: ProfileContext = null;
  if (rawProfile) {
    const { embedding: _omit, ...rest } = rawProfile;
    userProfile = rest;
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
        "You are not a member of this index",
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
    };
    isOwner = owner;
    indexName = index.title;
    scopedMembershipRole = owner ? "owner" : "member";
  }

  const userName = user.name ?? "Unknown";
  const userEmail = user.email ?? "";
  const hasName = !!user.name?.trim();

  return {
    userId,
    userName,
    userEmail,
    networkId,
    indexName,
    isOwner,
    user,
    userProfile,
    userNetworks,
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
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
export interface ToolDeps {
  /** @deprecated Use userDb or systemDb instead. Kept for backwards compatibility. */
  database: ChatGraphCompositeDatabase;
  /** Context-bound database for accessing the authenticated user's own resources. */
  userDb: UserDatabase;
  /** Context-bound database for LLM/system operations on cross-user resources within shared indexes. */
  systemDb: SystemDatabase;
  scraper: Scraper;
  embedder: import('../interfaces/embedder.interface.js').Embedder;
  cache: Cache;
  integration: IntegrationAdapter;
  contactService: ContactServiceAdapter;
  integrationImporter: {
    importContacts(userId: string, toolkit: string): Promise<{
      imported: number;
      skipped: number;
      newContacts: number;
      existingContacts: number;
    }>;
  };
  enricher: ProfileEnricher;
  /** Database adapter for negotiation/conversation operations. */
  negotiationDatabase: NegotiationDatabase;
  /** Chat session reader for exposing the caller's past conversations as MCP tools. */
  chatSession?: ChatSessionReader;
  /** Manages negotiation timeout jobs (optional — enables AI fallback on external agent timeout). */
  negotiationTimeoutQueue?: NegotiationTimeoutQueue;
  /** Agent registry database adapter (optional — absent when host does not support agents). */
  agentDatabase?: AgentDatabase;
  /** Grants the default system-agent permissions after onboarding (optional). */
  grantDefaultSystemPermissions?: (userId: string) => Promise<void>;
  /** Dispatcher for routing negotiation turns to personal agents (optional — falls back to system AI). */
  agentDispatcher?: AgentDispatcher;
  /** Delivery ledger for committing opportunity delivery rows (optional — absent in chat context). */
  deliveryLedger?: DeliveryLedger;
  graphs: {
    profile: CompiledGraph;
    intent: CompiledGraph;
    index: CompiledGraph;
    networkMembership: CompiledGraph;
    intentIndex: CompiledGraph;
    opportunity: CompiledOpportunityGraph;
  };
}

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
