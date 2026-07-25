import { z } from "zod";

import type { AgentActivitySummary } from "../interfaces/database.interface.js";

/**
 * Centralized activity-summary permission projection (IND-605).
 *
 * `read_activity_summary` is the only public name for grounded, aggregate-only
 * agent activity reporting. The handler passes a typed resolved caller context
 * into this one projection:
 *
 * - Human owners (REST/chat surfaces and session-authenticated MCP callers)
 *   receive every domain.
 * - Registered agents receive only the domains their permissions authorize.
 *   Signal IDs/titles (`opportunitiesBySignal`) require `manage:intents`.
 * - Question counts are meta-network: they are never narrowed by a network
 *   binding, but each count inherits the permission of the domain the
 *   question AFFECTS. A caller sees a domain's question counts only when it
 *   holds that domain's permission; conversational (`chat`-mode) and
 *   unrecognized modes are human-owner-only. There is deliberately no
 *   any-of all-question count shortcut.
 * - Network agents additionally narrow network-bound aggregates to their bound
 *   community — exposed here as `activitySummaryNetworkId` so the narrowing
 *   happens in the query/adapter layer, never as transport-local JSON
 *   filtering.
 *
 * The projection can only drop fields. It never fabricates data and it never
 * exposes counterparty identities, chats, turns, transcripts, or private
 * content; the strict response schema below is the explicit output contract.
 */

/** Canonical public tool name for aggregate activity reporting. */
export const READ_ACTIVITY_SUMMARY_TOOL_NAME = "read_activity_summary";

/** Activity summary domains, in stable projection order. */
export const ActivitySummaryDomainSchema = z.enum([
  "signals",
  "opportunities",
  "questions",
  "negotiations",
]);
export type ActivitySummaryDomain = z.infer<typeof ActivitySummaryDomainSchema>;

/**
 * Domains a question can affect. `'chat'` covers conversational questions
 * (and, fail-closed, any mode added to the protocol enum later): they have no
 * agent-permission domain and are visible to human owners only.
 */
export const ActivityQuestionDomainSchema = z.enum([
  "identity",
  "premises",
  "intents",
  "opportunities",
  "negotiations",
  "chat",
]);
export type ActivityQuestionDomain = z.infer<typeof ActivityQuestionDomainSchema>;

/**
 * Maps every current `QuestionMode` to the domain the question affects.
 * Modes missing from this table fail closed to the human-only `'chat'`
 * bucket so a future protocol mode can never leak to an agent caller.
 */
export const QUESTION_MODE_TO_DOMAIN: Readonly<Record<string, ActivityQuestionDomain>> = {
  enrichment: "identity",
  intent: "intents",
  discovery: "opportunities",
  pool_discovery: "opportunities",
  negotiation: "negotiations",
  negotiation_inflight: "negotiations",
  chat: "chat",
};

/**
 * Explicit per-domain question counts. Each key is present only when the
 * caller is authorized for that domain and the count is non-zero.
 */
export const ActivityQuestionCountsSchema = z.object({
  identity: z.number().int().optional(),
  premises: z.number().int().optional(),
  intents: z.number().int().optional(),
  opportunities: z.number().int().optional(),
  negotiations: z.number().int().optional(),
  /** Human-owner-only conversational (or unrecognized) question counts. */
  chat: z.number().int().optional(),
}).strict();
export type ActivityQuestionCounts = z.infer<typeof ActivityQuestionCountsSchema>;

/**
 * Typed resolved MCP caller context consumed by the projection. Derived from
 * the MCP capability subject at the transport boundary (see
 * `resolveMcpActivityCaller` in mcp.authorization-policy.ts); absent on
 * REST/chat surfaces, which are owner-trusted.
 */
export const McpActivityCallerSchema = z.object({
  /** `'human'` callers own the summarized data and see every domain. */
  kind: z.enum(["human", "agent"]),
  /** Canonical `manage:*` permission actions granted to the caller. */
  permissions: z.array(z.string()),
  /** A network agent's bound community; always null for humans. */
  networkScopeId: z.string().min(1).nullable(),
}).strict();
export type McpActivityCaller = z.infer<typeof McpActivityCallerSchema>;

/** Summary domain → authorizing permission action for agent callers. */
const DOMAIN_PERMISSIONS: Record<Exclude<ActivitySummaryDomain, "questions">, string> = {
  signals: "manage:intents",
  opportunities: "manage:opportunities",
  negotiations: "manage:negotiations",
};

/**
 * Affected question domain → authorizing permission action. `'chat'` is
 * deliberately absent: conversational counts are human-owner-only and no
 * agent permission releases them.
 */
const QUESTION_DOMAIN_PERMISSIONS: Readonly<Partial<Record<ActivityQuestionDomain, string>>> = {
  identity: "manage:identity",
  premises: "manage:premises",
  intents: "manage:intents",
  opportunities: "manage:opportunities",
  negotiations: "manage:negotiations",
};

/**
 * Explicit response contract for `read_activity_summary`. Every domain field
 * is optional because agent callers receive only their authorized domains.
 * Strict: no counterparty or unspecified field can pass validation.
 */
export const ActivitySummaryResponseSchema = z.object({
  /** The reporting window actually used, in hours. */
  sinceHours: z.number().int(),
  /** signals domain — liveSignalsWatched and per-signal opportunity counts. */
  liveSignalsWatched: z.number().int().optional(),
  /** opportunities domain. */
  opportunitiesSurfaced: z.number().int().optional(),
  /** signals domain — signal IDs/titles, authorized by manage:intents only. */
  opportunitiesBySignal: z.array(z.object({
    intentId: z.string(),
    title: z.string(),
    count: z.number().int(),
  }).strict()).optional(),
  /** questions domain (meta-network) — counts grouped by affected domain. */
  pendingQuestionsByDomain: ActivityQuestionCountsSchema.optional(),
  answeredQuestionsByDomain: ActivityQuestionCountsSchema.optional(),
  /** negotiations domain. */
  negotiationsStarted: z.number().int().optional(),
  negotiationsCompleted: z.number().int().optional(),
}).strict();
export type ProjectedActivitySummary = z.infer<typeof ActivitySummaryResponseSchema>;

/**
 * Resolves the summary domains a caller may see. Human owners receive every
 * domain; agents receive only domains backed by one of their permissions.
 * The `questions` domain only flags that at least one affected-domain count
 * may be visible — each count is still filtered per affected domain in
 * `projectActivitySummary`.
 */
export function resolveActivitySummaryDomains(
  caller: McpActivityCaller,
): ActivitySummaryDomain[] {
  if (caller.kind === "human") {
    return ["signals", "opportunities", "questions", "negotiations"];
  }
  const granted = new Set(caller.permissions);
  const domains: ActivitySummaryDomain[] = [];
  if (granted.has(DOMAIN_PERMISSIONS.signals)) domains.push("signals");
  if (granted.has(DOMAIN_PERMISSIONS.opportunities)) domains.push("opportunities");
  if (Object.values(QUESTION_DOMAIN_PERMISSIONS).some((action) => granted.has(action))) {
    domains.push("questions");
  }
  if (granted.has(DOMAIN_PERMISSIONS.negotiations)) domains.push("negotiations");
  return domains;
}

/**
 * Returns the bound community a network agent's network-bound aggregates must
 * be narrowed to in the query/adapter layer. Undefined for human callers and
 * global agents, whose aggregates span the owner's networks.
 */
export function activitySummaryNetworkId(caller: McpActivityCaller): string | undefined {
  if (caller.kind !== "agent") return undefined;
  return caller.networkScopeId ?? undefined;
}

/**
 * Aggregates raw per-mode question counts into per-affected-domain counts,
 * releasing only the domains the caller is authorized for. Meta-network:
 * domain permissions are the only boundary — never a network filter.
 */
function projectQuestionCounts(
  caller: McpActivityCaller,
  byMode: Record<string, number>,
): ActivityQuestionCounts | undefined {
  const granted = new Set(caller.permissions);
  const counts: ActivityQuestionCounts = {};
  for (const [mode, count] of Object.entries(byMode)) {
    // Unrecognized modes fail closed to the human-only bucket.
    const domain = QUESTION_MODE_TO_DOMAIN[mode] ?? "chat";
    if (caller.kind === "agent") {
      const permission = QUESTION_DOMAIN_PERMISSIONS[domain];
      if (!permission || !granted.has(permission)) continue;
    }
    counts[domain] = (counts[domain] ?? 0) + count;
  }
  return Object.keys(counts).length > 0 ? counts : undefined;
}

/**
 * Projects a full owner-scoped summary down to the caller's authorized
 * domains. Pure field selection — no data is transformed or fabricated.
 */
export function projectActivitySummary(
  caller: McpActivityCaller,
  summary: AgentActivitySummary,
): ProjectedActivitySummary {
  const domains = new Set(resolveActivitySummaryDomains(caller));
  const projected: ProjectedActivitySummary = { sinceHours: summary.sinceHours };
  if (domains.has("signals")) {
    projected.liveSignalsWatched = summary.liveSignalsWatched;
    projected.opportunitiesBySignal = summary.opportunitiesBySignal;
  }
  if (domains.has("opportunities")) {
    projected.opportunitiesSurfaced = summary.opportunitiesSurfaced;
  }
  if (domains.has("questions")) {
    const pending = projectQuestionCounts(caller, summary.pendingQuestionsByMode);
    if (pending) projected.pendingQuestionsByDomain = pending;
    const answered = projectQuestionCounts(caller, summary.answeredQuestionsByMode);
    if (answered) projected.answeredQuestionsByDomain = answered;
  }
  if (domains.has("negotiations")) {
    projected.negotiationsStarted = summary.negotiationsStarted;
    projected.negotiationsCompleted = summary.negotiationsCompleted;
  }
  return projected;
}
