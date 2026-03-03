import { z } from "zod";
import type { ProfileDocument } from "../agents/profile.generator";
import type {
  ChatGraphCompositeDatabase,
  IndexMembership,
  UserRecord,
  UserDatabase,
  SystemDatabase,
} from "../interfaces/database.interface";
import type { Scraper } from "../interfaces/scraper.interface";
import type { Cache } from "../interfaces/cache.interface";
import type { CompiledOpportunityGraph } from "../support/opportunity.discover";

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

/** Callback for streaming custom events from tools (e.g., negotiation progress). */
export type ToolStreamWriter = (event: unknown) => void;

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
  indexId?: string;
  indexName?: string;
  /** True when chat is index-scoped and the user owns the index. */
  isOwner?: boolean;

  // Rich identity context for prompt/tool orchestration (profile omits embedding to keep context lean).
  user: UserRecord;
  userProfile: ProfileContext;
  userIndexes: IndexMembership[];
  scopedIndex?: {
    id: string;
    title: string;
    prompt: string | null;
  };
  scopedMembershipRole?: "owner" | "member";
  /** True when user has not completed onboarding (onboarding.completedAt is null). */
  isOnboarding: boolean;
  /** Chat session ID when tools are used in a chat; used for draft opportunities (context.conversationId). */
  sessionId?: string;
  /** Optional callback for streaming events from tools (e.g., negotiation progress). */
  streamWriter?: ToolStreamWriter;
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
  embedder: import("../interfaces/embedder.interface").Embedder;
  scraper: Scraper;
  /** When set, chat is scoped to this index; tools use it as default for read_intents and create_intent. */
  indexId?: string;
  /** Chat session ID when creating tools for a chat; enables draft opportunities with context.conversationId. */
  sessionId?: string;
  /** Optional callback for streaming events from tools (e.g., negotiation progress). */
  streamWriter?: ToolStreamWriter;
}

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
    "getUser" | "getProfile" | "getIndexMemberships" | "getIndexMembership" | "getIndex" | "isIndexOwner" | "isIndexMember"
  >;
  userId: string;
  indexId?: string;
  /** Chat session ID for draft opportunities (stored as context.conversationId). */
  sessionId?: string;
  /** Optional callback for streaming events from tools (e.g., negotiation progress). */
  streamWriter?: ToolStreamWriter;
}): Promise<ResolvedToolContext> {
  const { database, userId, indexId, sessionId, streamWriter } = params;

  const [user, rawProfile, userIndexes] = await Promise.all([
    database.getUser(userId),
    database.getProfile(userId),
    database.getIndexMemberships(userId),
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

  if (indexId) {
    const [index, isMember, owner] = await Promise.all([
      database.getIndex(indexId),
      database.isIndexMember(indexId, userId),
      database.isIndexOwner(indexId, userId),
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

    let membership = userIndexes.find((m) => m.indexId === index.id);
    if (membership === undefined) {
      membership = (await database.getIndexMembership(index.id, userId)) ?? undefined;
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

  return {
    userId,
    userName: user.name ?? "Unknown",
    userEmail: user.email ?? "",
    indexId,
    indexName,
    isOwner,
    user,
    userProfile,
    userIndexes,
    scopedIndex,
    scopedMembershipRole,
    isOnboarding: !(user.onboarding?.completedAt),
    ...(sessionId !== undefined ? { sessionId } : {}),
    ...(streamWriter !== undefined ? { streamWriter } : {}),
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
  embedder: import('../interfaces/embedder.interface').Embedder;
  cache: Cache;
  graphs: {
    profile: CompiledGraph;
    intent: CompiledGraph;
    index: CompiledGraph;
    indexMembership: CompiledGraph;
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
 * Resolves an array of index IDs to their display titles.
 * Skips any IDs that don't resolve (deleted or invalid indexes).
 */
export async function resolveIndexNames(
  database: { getIndex(id: string): Promise<{ id: string; title: string } | null> },
  indexIds: string[]
): Promise<string[]> {
  if (indexIds.length === 0) return [];
  const results = await Promise.all(
    indexIds.map(id => database.getIndex(id))
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
