/**
 * Tests for the MCP_INSTRUCTIONS constant.
 *
 * MCP_INSTRUCTIONS carries only global guidance: identity, voice, banned
 * vocabulary, entity model, output rules, and auth. Per-tool workflow
 * patterns (discovery-first, introduction mode, negotiation-turn mode,
 * etc.) live in each tool's `description` string, not here.
 */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, test, expect } from "bun:test";
import { MCP_INSTRUCTIONS, sanitizeMcpResult, buildMcpOnboardingMessage, ONBOARDING_ALLOWED, shouldReportMcpToolError, extractBearerToken, getMcpToolMetadataCacheKey } from "../mcp.server.js";
import { CANONICAL_GUIDANCE_SUMMARY, CANONICAL_GUIDANCE_TOPICS } from "../../shared/agent/canonical-guidance.js";
import type { ResolvedToolContext } from "../../shared/agent/tool.helpers.js";
import { ToolRuntimeError } from "../../shared/agent/tool.runtime.js";

describe("MCP_INSTRUCTIONS", () => {
  test("fits within the 4500 character context budget", () => {
    expect(MCP_INSTRUCTIONS.length).toBeLessThan(4500);
  });

  test("is at least 800 characters (guards against accidental truncation)", () => {
    expect(MCP_INSTRUCTIONS.length).toBeGreaterThan(800);
  });

  test("explains the x-api-key header format", () => {
    expect(MCP_INSTRUCTIONS).toContain("x-api-key");
  });

  test('bans the word "search"', () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toMatch(/never.*search|banned.*search|do not.*search/);
  });

  test("frames Index Network as a discovery protocol", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toContain("discovery");
  });

  test("delegates per-tool guidance to tool descriptions", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toContain("tool's description");
  });

  test("describes the canonical entity model", () => {
    for (const term of ["identity", "context", "premise", "signal", "community", "network", "opportunity", "negotiation"]) {
      expect(MCP_INSTRUCTIONS.toLowerCase()).toContain(term);
    }
  });

  test("forbids raw JSON output and ID leakage", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toMatch(/never.*json|no raw json/);
    expect(MCP_INSTRUCTIONS.toLowerCase()).toMatch(/never.*id|no.*uuid/);
  });

  test("translates internal vocabulary to user-facing terms", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).toContain("signal");
    expect(MCP_INSTRUCTIONS.toLowerCase()).toContain("community");
  });

  test("guides H2A and A2A collaboration but never exposes H2H", () => {
    expect(MCP_INSTRUCTIONS).toContain("H2A");
    expect(MCP_INSTRUCTIONS).toContain("A2A");
    expect(MCP_INSTRUCTIONS).not.toContain("H2H");
  });

  test("distinguishes owner approval from A2A negotiation acceptance", () => {
    expect(MCP_INSTRUCTIONS).toContain("owner approval");
    expect(MCP_INSTRUCTIONS).toContain("is not owner approval");
  });

  test("never mentions retired contact/Gmail/scrape/profile/ghost-user guidance", () => {
    const lower = MCP_INSTRUCTIONS.toLowerCase();
    for (const fragment of ["ghost user", "gmail", "scrape", "import_contacts", "read_user_profiles"]) {
      expect(lower).not.toContain(fragment);
    }
  });

  test("does not carry Claude Code sub-skill dispatch idioms", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).not.toContain("sub-skill");
    expect(MCP_INSTRUCTIONS).not.toContain("index-network:");
  });
});

describe("MCP_INSTRUCTIONS canonical source (IND-602/603)", () => {
  test("is built from the shared canonical guidance summary", () => {
    expect(MCP_INSTRUCTIONS).toContain(CANONICAL_GUIDANCE_SUMMARY);
  });

  test("summary lists every canonical read_docs topic", () => {
    for (const topic of CANONICAL_GUIDANCE_TOPICS) {
      expect(MCP_INSTRUCTIONS).toContain(topic);
    }
  });
});

describe("sanitizeMcpResult", () => {
  test("strips underscore-prefixed keys from data", () => {
    const input = JSON.stringify({
      success: true,
      data: { intents: [], _graphTimings: [{ name: "intent", durationMs: 42 }] },
    });
    const { text, isError } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data._graphTimings).toBeUndefined();
    expect(parsed.data.intents).toEqual([]);
    expect(isError).toBe(false);
  });

  test("strips multiple underscore-prefixed keys from data", () => {
    const input = JSON.stringify({
      success: true,
      data: { count: 1, _graphTimings: [], _debug: "x", visible: "kept" },
    });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data._graphTimings).toBeUndefined();
    expect(parsed.data._debug).toBeUndefined();
    expect(parsed.data.visible).toBe("kept");
    expect(parsed.data.count).toBe(1);
  });

  test("sets isError true when success is false", () => {
    const input = JSON.stringify({ success: false, error: "Not found" });
    const { isError } = sanitizeMcpResult(input);
    expect(isError).toBe(true);
  });

  test("sets isError false when success is true", () => {
    const input = JSON.stringify({ success: true, data: {} });
    const { isError } = sanitizeMcpResult(input);
    expect(isError).toBe(false);
  });

  test("passes through unchanged when JSON is invalid", () => {
    const input = "not valid json";
    const { text, isError } = sanitizeMcpResult(input);
    expect(text).toBe(input);
    expect(isError).toBe(false);
  });

  test("does not strip underscore-prefixed top-level keys", () => {
    const input = JSON.stringify({ success: true, _topLevel: "kept", data: { _inner: "stripped" } });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed._topLevel).toBe("kept");
    expect(parsed.data._inner).toBeUndefined();
  });

  test("handles missing data key gracefully", () => {
    const input = JSON.stringify({ success: true });
    const { text, isError } = sanitizeMcpResult(input);
    expect(JSON.parse(text).success).toBe(true);
    expect(isError).toBe(false);
  });

  test("handles data as non-object array without throwing", () => {
    const input = JSON.stringify({ success: true, data: [1, 2, 3] });
    const { text, isError } = sanitizeMcpResult(input);
    expect(JSON.parse(text).data).toEqual([1, 2, 3]);
    expect(isError).toBe(false);
  });
});

describe("sanitizeMcpResult — debugSteps", () => {
  test("strips debugSteps from data", () => {
    const input = JSON.stringify({
      success: true,
      data: {
        count: 3,
        debugSteps: [
          { step: "prep", detail: "Fetched 2 intent(s)" },
          { step: "candidate", detail: "Alice: ✓ passed", data: { bio: "private bio", ragScore: 0.9 } },
        ],
      },
    });
    const { text, isError } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data.debugSteps).toBeUndefined();
    expect(parsed.data.count).toBe(3);
    expect(isError).toBe(false);
  });

  test("still strips _-prefixed keys alongside debugSteps", () => {
    const input = JSON.stringify({
      success: true,
      data: {
        message: "ok",
        _graphTimings: [{ name: "intent", durationMs: 120 }],
        debugSteps: [{ step: "prep" }],
      },
    });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data._graphTimings).toBeUndefined();
    expect(parsed.data.debugSteps).toBeUndefined();
    expect(parsed.data.message).toBe("ok");
  });

  test("leaves data unchanged when no debugSteps present", () => {
    const input = JSON.stringify({
      success: true,
      data: { count: 5, message: "found" },
    });
    const { text } = sanitizeMcpResult(input);
    const parsed = JSON.parse(text);
    expect(parsed.data.count).toBe(5);
    expect(parsed.data.message).toBe("found");
  });
});

function minimalContext(overrides: Partial<ResolvedToolContext> = {}): ResolvedToolContext {
  return {
    userId: "user-1",
    userName: "Alice",
    userEmail: "alice@example.com",
    user: {} as ResolvedToolContext["user"],
    userProfile: {} as ResolvedToolContext["userProfile"],
    userNetworks: [],
    indexScope: [],
    isOnboarding: true,
    hasName: true,
    ...overrides,
  };
}

describe("shouldReportMcpToolError", () => {
  test("suppresses structured runtime failures that are returned to MCP clients", () => {
    const err = new ToolRuntimeError(
      "TOOL_TIMEOUT",
      "Tool update_user_profile timed out after 50000ms.",
      "update_user_profile",
      { class: "async_candidate", timeoutMs: 50_000, maxOutputBytes: 1_000_000 },
    );

    expect(shouldReportMcpToolError(err)).toBe(false);
  });

  test("suppresses expected credential failures", () => {
    expect(shouldReportMcpToolError(new Error("Invalid API key"))).toBe(false);
    expect(shouldReportMcpToolError(new Error("Authentication required: provide Bearer token or x-api-key header"))).toBe(false);
  });

  test("reports unexpected tool failures", () => {
    expect(shouldReportMcpToolError(new Error("database unavailable"))).toBe(true);
  });
});

describe("extractBearerToken", () => {
  function requestWithAuthorization(value?: string): Request {
    return new Request("https://example.test/mcp", {
      headers: value === undefined ? undefined : { Authorization: value },
    });
  }

  test("returns undefined when Authorization is missing", () => {
    expect(extractBearerToken(requestWithAuthorization())).toBeUndefined();
  });

  test("extracts bearer token case-insensitively", () => {
    expect(extractBearerToken(requestWithAuthorization("Bearer token-123"))).toBe("token-123");
    expect(extractBearerToken(requestWithAuthorization("bearer token-456"))).toBe("token-456");
  });

  test("allows extra whitespace around bearer credentials", () => {
    expect(extractBearerToken(requestWithAuthorization("  Bearer   spaced-token  "))).toBe("spaced-token");
  });

  test("rejects wrong schemes and missing tokens", () => {
    expect(extractBearerToken(requestWithAuthorization("Basic token-123"))).toBeUndefined();
    expect(extractBearerToken(requestWithAuthorization("Bearer"))).toBeUndefined();
  });
});

describe('getMcpToolMetadataCacheKey', () => {
  const baseDeps = {
    chatSession: undefined,
    agentDatabase: undefined,
    agentDispatcher: undefined,
    questionerEnqueue: undefined,
  };

  test('changes when registry-shaping dependencies change', () => {
    const base = getMcpToolMetadataCacheKey(baseDeps);

    expect(getMcpToolMetadataCacheKey({ ...baseDeps, chatSession: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, agentDatabase: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, agentDispatcher: {} as never })).not.toBe(base);
    expect(getMcpToolMetadataCacheKey({ ...baseDeps, questionerEnqueue: (async () => undefined) as never })).not.toBe(base);
  });

  test('CONTACTS_ENABLED never shapes the MCP registry cache key', () => {
    // Contact/Gmail tools are omitted from the MCP surface entirely, so the flag
    // can never change the MCP tool set or its metadata cache key (IND-596).
    const base = getMcpToolMetadataCacheKey(baseDeps);
    const withContacts = { ...baseDeps, contactsEnabled: true } as Parameters<typeof getMcpToolMetadataCacheKey>[0];
    expect(getMcpToolMetadataCacheKey(withContacts)).toBe(base);
  });
});

describe("ONBOARDING_ALLOWED", () => {
  test("contains all onboarding-flow tools", () => {
    const expected = [
      "preview_user_context",
      "get_enrichment_run",
      "cancel_enrichment_run",
      "confirm_user_context",
      "create_user_context",
      "complete_onboarding",
      "read_networks",
      "create_network_membership",
      "create_intent",
      "read_user_contexts",
    ];
    for (const tool of expected) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(true);
    }
  });

  test("contains enrollment and protocol guidance tools", () => {
    for (const tool of ["register_agent", "read_docs"]) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(true);
    }
  });

  test("does not re-advertise removed MCP surfaces during onboarding", () => {
    for (const tool of [
      "scrape_url",
      "import_gmail_contacts",
      "read_user_profiles",
      "create_user_profile",
      "update_user_profile",
      "confirm_user_profile",
      "preview_user_profile",
      "get_profile_run",
      "cancel_profile_run",
    ]) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(false);
    }
  });

  test("does not contain non-onboarding tools", () => {
    for (const tool of ["list_contacts", "update_intent", "delete_network", "discover_opportunities"]) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(false);
    }
  });
});

describe("buildMcpOnboardingMessage", () => {
  test("mentions onboarding requirement", () => {
    const msg = buildMcpOnboardingMessage(minimalContext());
    expect(msg).toContain("not completed onboarding");
    expect(msg).toContain("complete_onboarding");
  });

  test("uses name-confirmation step when user has a name", () => {
    const msg = buildMcpOnboardingMessage(minimalContext({ hasName: true, userName: "Alice" }));
    expect(msg).toContain("You're Alice, right?");
    expect(msg).toContain("preview_user_context");
    expect(msg).toContain("get_enrichment_run");
  });

  test("uses name-ask step when user has no name", () => {
    const msg = buildMcpOnboardingMessage(minimalContext({ hasName: false, userName: "Unknown" }));
    expect(msg).toContain("Ask the user for their name");
    expect(msg).toContain("short self-description");
    expect(msg).toContain("confirm_user_context");
  });

  test("skips community step for network-scoped contexts", () => {
    const msg = buildMcpOnboardingMessage(
      minimalContext({ networkId: "net-1", indexName: "Edge City" }),
    );
    expect(msg).toContain("Skipped");
    expect(msg).toContain("Edge City");
  });

  test("includes community discovery for unscoped contexts", () => {
    const msg = buildMcpOnboardingMessage(minimalContext({ networkId: undefined }));
    expect(msg).toContain("read_networks()");
    expect(msg).toContain("create_network_membership");
  });

  test("lists all allowed tool names", () => {
    const msg = buildMcpOnboardingMessage(minimalContext());
    for (const tool of ONBOARDING_ALLOWED) {
      expect(msg).toContain(tool);
    }
  });
});
