import { describe, expect, test } from "bun:test";

import type { AgentActivitySummary } from "../../interfaces/database.interface.js";
import { ActivitySummaryResponseSchema, McpActivityCallerSchema, activitySummaryNetworkId, projectActivitySummary, resolveActivitySummaryDomains } from "../activity-projection.js";

/**
 * Centralized MCP activity-summary permission projection (IND-605).
 *
 * `read_activity_summary` passes the typed resolved MCP caller context into one
 * projection. Human owners see every domain; global agents see only the domains
 * their permissions authorize; network agents additionally narrow network-bound
 * aggregates to their bound community at the query/adapter layer (surfaced via
 * `activitySummaryNetworkId`, never transport-local JSON filtering). Signal
 * IDs/titles are exposed only with `manage:intents`. Question counts inherit
 * the permission of the domain each question AFFECTS — there is no any-of
 * all-question count shortcut — and conversational/unrecognized modes are
 * human-owner-only.
 */

const FULL_SUMMARY: AgentActivitySummary = {
  sinceHours: 24,
  liveSignalsWatched: 3,
  opportunitiesSurfaced: 5,
  opportunitiesBySignal: [
    { intentId: "intent-1", title: "Climate founders", count: 3 },
    { intentId: "intent-2", title: "Product advisors", count: 2 },
  ],
  pendingQuestionsByMode: { intent: 2, negotiation: 1, chat: 4 },
  answeredQuestionsByMode: { enrichment: 3, discovery: 5 },
  negotiationsStarted: 6,
  negotiationsCompleted: 7,
};

describe("MCP activity-summary permission projection", () => {
  test("human callers receive every domain and no network narrowing", () => {
    const caller = McpActivityCallerSchema.parse({
      kind: "human",
      permissions: [],
      networkScopeId: null,
    });

    expect(resolveActivitySummaryDomains(caller)).toEqual([
      "signals",
      "opportunities",
      "questions",
      "negotiations",
    ]);
    expect(activitySummaryNetworkId(caller)).toBeUndefined();
    expect(projectActivitySummary(caller, FULL_SUMMARY)).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 3,
      opportunitiesSurfaced: 5,
      opportunitiesBySignal: FULL_SUMMARY.opportunitiesBySignal,
      pendingQuestionsByDomain: { intents: 2, negotiations: 1, chat: 4 },
      answeredQuestionsByDomain: { identity: 3, opportunities: 5 },
      negotiationsStarted: 6,
      negotiationsCompleted: 7,
    });
  });

  test("global agents see only the domains their permissions authorize", () => {
    const caller = McpActivityCallerSchema.parse({
      kind: "agent",
      permissions: ["manage:opportunities", "manage:negotiations"],
      networkScopeId: null,
    });

    expect(resolveActivitySummaryDomains(caller)).toEqual([
      "opportunities",
      "questions",
      "negotiations",
    ]);
    expect(activitySummaryNetworkId(caller)).toBeUndefined();
    expect(projectActivitySummary(caller, FULL_SUMMARY)).toEqual({
      sinceHours: 24,
      opportunitiesSurfaced: 5,
      // intent-mode pending counts stay hidden without manage:intents; chat is human-only.
      pendingQuestionsByDomain: { negotiations: 1 },
      // enrichment counts stay hidden without manage:identity.
      answeredQuestionsByDomain: { opportunities: 5 },
      negotiationsStarted: 6,
      negotiationsCompleted: 7,
    });
  });

  test("signal IDs/titles are exposed only with manage:intents", () => {
    const withoutIntents = projectActivitySummary(
      { kind: "agent", permissions: ["manage:opportunities"], networkScopeId: null },
      FULL_SUMMARY,
    );
    expect("opportunitiesBySignal" in withoutIntents).toBe(false);
    expect("liveSignalsWatched" in withoutIntents).toBe(false);

    const withIntents = projectActivitySummary(
      { kind: "agent", permissions: ["manage:intents"], networkScopeId: null },
      FULL_SUMMARY,
    );
    expect(withIntents).toEqual({
      sinceHours: 24,
      liveSignalsWatched: 3,
      opportunitiesBySignal: FULL_SUMMARY.opportunitiesBySignal,
      pendingQuestionsByDomain: { intents: 2 },
    });
  });

  test("question counts inherit the permission of the affected domain — no any-of all-count", () => {
    // An identity-only agent sees only identity-affected question counts, never
    // an undifferentiated total that would include intent/negotiation questions.
    const caller = McpActivityCallerSchema.parse({
      kind: "agent",
      permissions: ["manage:identity"],
      networkScopeId: null,
    });

    expect(resolveActivitySummaryDomains(caller)).toEqual(["questions"]);
    expect(projectActivitySummary(caller, FULL_SUMMARY)).toEqual({
      sinceHours: 24,
      answeredQuestionsByDomain: { identity: 3 },
    });
  });

  test("chat-mode and unrecognized question modes are human-owner-only", () => {
    const allPermissions = {
      kind: "agent",
      permissions: [
        "manage:identity",
        "manage:premises",
        "manage:intents",
        "manage:opportunities",
        "manage:negotiations",
      ],
      networkScopeId: null,
    } as const;
    const summary = {
      ...FULL_SUMMARY,
      pendingQuestionsByMode: { chat: 4, future_unknown_mode: 7 },
      answeredQuestionsByMode: {},
    };

    // Even a fully-permissioned agent never receives conversational or
    // fail-closed unrecognized-mode counts.
    const agentView = projectActivitySummary(allPermissions, summary);
    expect("pendingQuestionsByDomain" in agentView).toBe(false);
    expect("answeredQuestionsByDomain" in agentView).toBe(false);
    // The human owner sees both, bucketed under chat.
    expect(
      projectActivitySummary({ kind: "human", permissions: [], networkScopeId: null }, summary)
        .pendingQuestionsByDomain,
    ).toEqual({ chat: 11 });
  });

  test("network agents expose their bound community for adapter-layer narrowing", () => {
    const caller = McpActivityCallerSchema.parse({
      kind: "agent",
      permissions: ["manage:intents", "manage:opportunities", "manage:negotiations"],
      networkScopeId: "network-1",
    });

    expect(activitySummaryNetworkId(caller)).toBe("network-1");
    // Meta-network domains are unaffected by the network binding.
    expect(resolveActivitySummaryDomains(caller)).toContain("questions");
  });

  test("the projected response validates against the explicit response schema", () => {
    const projected = projectActivitySummary(
      { kind: "agent", permissions: ["manage:intents"], networkScopeId: null },
      FULL_SUMMARY,
    );
    expect(() => ActivitySummaryResponseSchema.parse(projected)).not.toThrow();
    // The schema is strict: no counterparty or unspecified field can slip through.
    expect(
      ActivitySummaryResponseSchema.safeParse({ ...projected, counterparty: "x" }).success,
    ).toBe(false);
    // Raw per-mode maps are not part of the public contract.
    expect(
      ActivitySummaryResponseSchema.safeParse({ sinceHours: 24, pendingQuestionsByMode: {} }).success,
    ).toBe(false);
  });

  test("caller context is runtime-validated", () => {
    expect(McpActivityCallerSchema.safeParse({ kind: "agent" }).success).toBe(false);
    expect(
      McpActivityCallerSchema.safeParse({
        kind: "system",
        permissions: [],
        networkScopeId: null,
      }).success,
    ).toBe(false);
  });
});
