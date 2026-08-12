import { describe, it, expect } from "bun:test";

/**
 * Deterministic regression harness for the WS11 user-context payload reshape.
 *
 * Runs the EXACT merged extractProfile logic (from opportunity.command.ts) and
 * the agentvillage negotiation-summary name parser over REAL live payloads
 * captured from dev (flat, WS11+) and historical production (nested, pre-WS11)
 * on 2026-06-19. Proves the payload parser remains compatible with persisted
 * legacy response shapes even though the retired tool alias is gone.
 */

// ── Real live payloads (captured via MCP) ────────────────────────────────────

// dev read_user_contexts({ userId }) — flat single-user identity (WS11+)
const DEV_FLAT_SINGLE = {
  success: true,
  data: {
    hasProfile: true,
    name: "Eric Lacosse",
    bio: "Eric Lacosse is a computational neuroscientist...",
    location: "Lisbon, Portugal",
    context: "Eric Lacosse is a computational neuroscientist based in Lisbon...",
  },
};

// historical production response — nested single-user (pre-WS11)
const PROD_NESTED_SINGLE = {
  success: true,
  data: {
    hasProfile: true,
    profile: {
      id: "5fa8a85d-9f3a-4524-b9a9-848793951bb0",
      name: "Yankı Ekin Yüksel",
      bio: "Yankı Ekin Yüksel is a tech professional...",
      location: "Istanbul, Turkey",
      skills: ["Photography", "SAP BI"],
      interests: ["Movies", "Reading"],
    },
    onboardingComplete: true,
  },
};

// dev read_user_contexts({ query }) — flat list (unchanged by WS11)
const DEV_FLAT_LIST = {
  success: true,
  data: {
    query: "Eric",
    matchCount: 1,
    profiles: [
      {
        userId: "3a899407-a970-4e7d-8e5e-2caa6bb06fbe",
        name: "Eric Lacosse",
        hasProfile: true,
        bio: "Eric Lacosse is a computational neuroscientist...",
        location: "Lisbon, Portugal",
      },
    ],
  },
};

// hypothetical legacy nested list (pre-WS11 query mode) — defensive coverage
const LEGACY_NESTED_LIST = {
  success: true,
  data: { profiles: [{ profile: { name: "Legacy Person", bio: "x" } }] },
};

const EMPTY = { success: true, data: {} };
const FAILED = { success: false };

// ── Verbatim copy of the merged extractProfile (opportunity.command.ts) ───────

const extractProfile = (result: { success: boolean; data?: Record<string, unknown> }) => {
  if (!result.success || !result.data) return undefined;
  const d = result.data as Record<string, unknown>;
  // Legacy nested single-user shape (pre-WS11 protocol): { profile: {...} }.
  if (d.profile) return d.profile as Record<string, unknown>;
  // Multi-profile response (query mode) — take first; entries may be flat or nested.
  const profiles = d.profiles as Array<Record<string, unknown>> | undefined;
  if (profiles?.length) {
    const first = profiles[0];
    return (first.profile as Record<string, unknown> | undefined) ?? first;
  }
  // Flat single-user identity shape (WS11+ protocol): { id, name, bio, location, context }.
  if (typeof d.name === "string" || typeof d.context === "string") {
    return { name: d.name, bio: d.bio, location: d.location, context: d.context };
  }
  return undefined;
};

// ── Verbatim copy of the agentvillage negotiation-summary name parser ─────────

interface ProfileResponse {
  success?: boolean;
  data?: { hasProfile?: boolean; name?: string; profile?: { name?: string } };
}
const resolveName = (parsed: ProfileResponse): string | null => {
  const rawName =
    parsed.success !== false && parsed.data?.hasProfile
      ? parsed.data.name ?? parsed.data.profile?.name
      : undefined;
  return rawName?.trim() || null;
};

// ── Tests ────────────────────────────────────────────────────────────────────

describe("CLI extractProfile vs live payloads", () => {
  it("resolves the new flat single-user shape (dev / WS11+)", () => {
    const p = extractProfile(DEV_FLAT_SINGLE);
    expect(p).toBeDefined();
    expect(p?.name).toBe("Eric Lacosse");
    expect(p?.location).toBe("Lisbon, Portugal");
    expect(typeof p?.context).toBe("string");
  });

  it("resolves the legacy nested single-user shape (prod / pre-WS11)", () => {
    const p = extractProfile(PROD_NESTED_SINGLE);
    expect(p).toBeDefined();
    expect(p?.name).toBe("Yankı Ekin Yüksel");
    expect(p?.location).toBe("Istanbul, Turkey");
  });

  it("unwraps the flat list shape (dev query mode)", () => {
    const p = extractProfile(DEV_FLAT_LIST);
    expect(p?.name).toBe("Eric Lacosse");
  });

  it("unwraps the legacy nested list shape (defensive)", () => {
    const p = extractProfile(LEGACY_NESTED_LIST);
    expect(p?.name).toBe("Legacy Person");
  });

  it("returns undefined on empty/failed reads", () => {
    expect(extractProfile(EMPTY)).toBeUndefined();
    expect(extractProfile(FAILED)).toBeUndefined();
  });
});

describe("agentvillage negotiation-summary name resolver vs live payloads", () => {
  it("reads name from the new flat shape (dev / WS11+)", () => {
    expect(resolveName(DEV_FLAT_SINGLE)).toBe("Eric Lacosse");
  });

  it("reads name from the legacy nested shape (prod / pre-WS11)", () => {
    expect(resolveName(PROD_NESTED_SINGLE)).toBe("Yankı Ekin Yüksel");
  });

  it("returns null when no profile exists or read failed", () => {
    expect(resolveName({ success: true, data: { hasProfile: false } })).toBeNull();
    expect(resolveName(FAILED)).toBeNull();
  });
});
