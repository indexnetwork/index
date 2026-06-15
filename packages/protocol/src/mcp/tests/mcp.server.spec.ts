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
import { MCP_INSTRUCTIONS, sanitizeMcpResult, buildMcpOnboardingMessage, ONBOARDING_ALLOWED, shouldReportMcpToolError, extractBearerToken, parseClientSurface } from "../mcp.server.js";
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

  test("describes the entity model", () => {
    for (const term of ["Profile", "Intent", "Opportunity"]) {
      expect(MCP_INSTRUCTIONS).toContain(term);
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

  test("does not carry Claude Code sub-skill dispatch idioms", () => {
    expect(MCP_INSTRUCTIONS.toLowerCase()).not.toContain("sub-skill");
    expect(MCP_INSTRUCTIONS).not.toContain("index-network:");
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

describe("parseClientSurface", () => {
  test("defaults absent, empty, and whitespace-only values to web", () => {
    expect(parseClientSurface(null)).toBe("web");
    expect(parseClientSurface("")).toBe("web");
    expect(parseClientSurface("   ")).toBe("web");
  });

  test("normalizes known surfaces", () => {
    expect(parseClientSurface("telegram")).toBe("telegram");
    expect(parseClientSurface(" Telegram ")).toBe("telegram");
    expect(parseClientSurface("WEB")).toBe("web");
  });

  test("coerces unknown surfaces to web", () => {
    expect(parseClientSurface("slack")).toBe("web");
  });
});

describe("ONBOARDING_ALLOWED", () => {
  test("contains all onboarding-flow tools", () => {
    const expected = [
      "record_onboarding_privacy_consent",
      "preview_user_profile",
      "get_profile_run",
      "cancel_profile_run",
      "confirm_user_profile",
      "create_user_profile",
      "complete_onboarding",
      "import_gmail_contacts",
      "read_networks",
      "create_network_membership",
      "create_intent",
      "read_user_profiles",
    ];
    for (const tool of expected) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(true);
    }
  });

  test("contains agent-gate exempt tools", () => {
    for (const tool of ["register_agent", "read_docs", "scrape_url"]) {
      expect(ONBOARDING_ALLOWED.has(tool)).toBe(true);
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
    expect(msg).toContain("record_onboarding_privacy_consent");
    expect(msg).toContain("preview_user_profile");
    expect(msg).toContain("get_profile_run");
  });

  test("uses name-ask step when user has no name", () => {
    const msg = buildMcpOnboardingMessage(minimalContext({ hasName: false, userName: "Unknown" }));
    expect(msg).toContain("Ask the user for their name");
    expect(msg).toContain("short self-description");
    expect(msg).toContain("confirm_user_profile");
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
