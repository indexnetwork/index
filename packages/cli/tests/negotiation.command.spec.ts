import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleNegotiation, resolveSince } from "../src/negotiation.command";
import type { Negotiation } from "../src/types";
import { createMockServer } from "./helpers/mock-http";

// ── Argument parsing tests ──────────────────────────────────────────

describe("negotiation argument parsing", () => {
  it("parses 'negotiation list' subcommand", () => {
    const result = parseArgs(["negotiation", "list"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'negotiation list --limit 5'", () => {
    const result = parseArgs(["negotiation", "list", "--limit", "5"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(5);
  });

  it("parses 'negotiation list --since 1d'", () => {
    const result = parseArgs(["negotiation", "list", "--since", "1d"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
    expect(result.since).toBe("1d");
  });

  it("parses 'negotiation list --limit 10 --since 2h'", () => {
    const result = parseArgs(["negotiation", "list", "--limit", "10", "--since", "2h"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(10);
    expect(result.since).toBe("2h");
  });

  it("parses 'negotiation show abc-123'", () => {
    const result = parseArgs(["negotiation", "show", "abc-123"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBe("abc-123");
  });

  it("parses bare 'negotiation' with no subcommand", () => {
    const result = parseArgs(["negotiation"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'negotiation show' without id", () => {
    const result = parseArgs(["negotiation", "show"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBeUndefined();
  });

  it("parses 'negotiation list --json'", () => {
    const result = parseArgs(["negotiation", "list", "--json"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
    expect(result.json).toBe(true);
  });

  it("parses '--api-url http://x negotiation list' with pre-scan global flag", () => {
    const result = parseArgs(["--api-url", "http://x", "negotiation", "list"]);
    expect(result.command).toBe("negotiation");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://x");
  });
});

// ── resolveSince tests ──────────────────────────────────────────────

describe("resolveSince", () => {
  it("resolves '1h' to an ISO date ~1 hour ago", () => {
    const result = resolveSince("1h");
    const parsed = Date.parse(result);
    expect(isNaN(parsed)).toBe(false);
    const diff = Date.now() - parsed;
    // Should be within 1 hour + 5 seconds
    expect(diff).toBeGreaterThan(3_600_000 - 5_000);
    expect(diff).toBeLessThan(3_600_000 + 5_000);
  });

  it("resolves '2d' to an ISO date ~2 days ago", () => {
    const result = resolveSince("2d");
    const parsed = Date.parse(result);
    expect(isNaN(parsed)).toBe(false);
    const diff = Date.now() - parsed;
    expect(diff).toBeGreaterThan(2 * 86_400_000 - 5_000);
    expect(diff).toBeLessThan(2 * 86_400_000 + 5_000);
  });

  it("resolves '1w' to an ISO date ~7 days ago", () => {
    const result = resolveSince("1w");
    const parsed = Date.parse(result);
    expect(isNaN(parsed)).toBe(false);
    const diff = Date.now() - parsed;
    expect(diff).toBeGreaterThan(7 * 86_400_000 - 5_000);
    expect(diff).toBeLessThan(7 * 86_400_000 + 5_000);
  });

  it("resolves '30m' to an ISO date ~30 minutes ago", () => {
    const result = resolveSince("30m");
    const parsed = Date.parse(result);
    expect(isNaN(parsed)).toBe(false);
    const diff = Date.now() - parsed;
    expect(diff).toBeGreaterThan(30 * 60_000 - 5_000);
    expect(diff).toBeLessThan(30 * 60_000 + 5_000);
  });

  it("resolves '10s' to an ISO date ~10 seconds ago", () => {
    const result = resolveSince("10s");
    const parsed = Date.parse(result);
    expect(isNaN(parsed)).toBe(false);
    const diff = Date.now() - parsed;
    expect(diff).toBeGreaterThan(10_000 - 5_000);
    expect(diff).toBeLessThan(10_000 + 5_000);
  });

  it("returns ISO date string as-is", () => {
    const iso = "2026-01-01T00:00:00Z";
    const result = resolveSince(iso);
    expect(result).toBe(new Date(iso).toISOString());
  });

  it("throws on invalid input 'foobar'", () => {
    expect(() => resolveSince("foobar")).toThrow("Invalid --since");
  });

  it("throws on non-date non-duration 'abc123'", () => {
    expect(() => resolveSince("abc123")).toThrow("Invalid --since");
  });
});

// ── API client tests ────────────────────────────────────────────────

describe("negotiation API client", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(() => {
    mock = createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(() => {
    mock.stop();
  });

  describe("listNegotiations", () => {
    it("returns negotiations from the API", async () => {
      mock.on("GET", "/api/auth/me", () =>
        Response.json({ user: { id: "user-1", name: "Test", email: "test@test.com" } }),
      );
      mock.on("GET", "/api/users/user-1/negotiations", () =>
        Response.json({
          negotiations: [
            {
              id: "neg-1",
              counterparty: { id: "u2", name: "Alice", avatar: null },
              outcome: { hasOpportunity: true, role: "agent", turnCount: 2, reason: "Good match" },
              turns: [],
              createdAt: "2026-04-20T10:00:00Z",
            },
            {
              id: "neg-2",
              counterparty: { id: "u3", name: "Bob", avatar: null },
              outcome: null,
              turns: [],
              createdAt: "2026-04-21T12:00:00Z",
            },
          ],
        }),
      );

      const result = await client.listNegotiations();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("neg-1");
      expect(result[1].id).toBe("neg-2");
    });

    it("passes query params (limit, since)", async () => {
      let receivedUrl = "";
      mock.on("GET", "/api/auth/me", () =>
        Response.json({ user: { id: "user-1", name: "Test", email: "test@test.com" } }),
      );
      mock.on("GET", "/api/users/user-1/negotiations", (req) => {
        receivedUrl = req.url;
        return Response.json({ negotiations: [] });
      });

      await client.listNegotiations({ limit: 5, since: "2026-01-01T00:00:00Z" });
      expect(receivedUrl).toContain("limit=5");
      expect(receivedUrl).toContain("since=");
    });
  });
});

// ── Output renderer tests ───────────────────────────────────────────

describe("negotiation output renderers", () => {
  let captured: string;
  let origWrite: typeof process.stdout.write;
  let origLog: typeof console.log;

  const mockNegotiations: Negotiation[] = [
    {
      id: "neg-111-222-333-444",
      counterparty: { id: "u2", name: "Alice", avatar: null },
      outcome: { hasOpportunity: true, role: "agent", turnCount: 3, reason: "Good match" },
      turns: [
        {
          speaker: { id: "u1", name: "Bot", avatar: null },
          action: "propose",
          reasoning: "Found overlap in AI interests",
          suggestedRoles: { ownUser: "agent", otherUser: "patient" },
          createdAt: "2026-04-20T10:00:00Z",
        },
      ],
      createdAt: "2026-04-20T09:00:00Z",
    },
    {
      id: "neg-555-666-777-888",
      counterparty: { id: "u3", name: "Bob", avatar: null },
      outcome: null,
      turns: [],
      createdAt: "2026-04-21T12:00:00Z",
    },
  ];

  beforeEach(() => {
    captured = "";
    origWrite = process.stdout.write;
    origLog = console.log;
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    console.log = (...args: unknown[]) => {
      captured += args.map(String).join(" ") + "\n";
    };
  });

  afterAll(() => {
    process.stdout.write = origWrite;
    console.log = origLog;
  });

  it("renders counterparty and outcome in table", async () => {
    const mockClient = {
      async getMe() { return { id: "user-1", name: "Test", email: "test@test.com" }; },
      async listNegotiations() { return mockNegotiations; },
    } as unknown as ApiClient;

    await handleNegotiation(mockClient, "list", {});
    expect(captured).toContain("Alice");
    expect(captured).toContain("Bob");
    // "opportunity" is the outcome label when hasOpportunity is true
    expect(captured).toContain("opportunity");
    // "unknown" is the outcome label when outcome is null
    expect(captured).toContain("unknown");
  });

  it("shows empty message when no negotiations", async () => {
    const mockClient = {
      async getMe() { return { id: "user-1", name: "Test", email: "test@test.com" }; },
      async listNegotiations() { return []; },
    } as unknown as ApiClient;

    await handleNegotiation(mockClient, "list", {});
    expect(captured).toContain("No negotiations found");
  });

  it("outputs valid JSON with --json flag", async () => {
    const mockClient = {
      async getMe() { return { id: "user-1", name: "Test", email: "test@test.com" }; },
      async listNegotiations() { return mockNegotiations; },
    } as unknown as ApiClient;

    await handleNegotiation(mockClient, "list", { json: true });
    expect(() => JSON.parse(captured.trim())).not.toThrow();
    const parsed = JSON.parse(captured.trim());
    expect(parsed).toHaveLength(2);
    expect(parsed[0].id).toBe("neg-111-222-333-444");
  });
});
