import { describe, it, expect, beforeAll, afterAll, beforeEach } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleOpportunity } from "../src/opportunity.command";
import * as output from "../src/output";
import type { Opportunity } from "../src/api.client";
import { createMockServer } from "./helpers/mock-http";

describe("opportunity argument parsing", () => {
  it("parses 'opportunity list' subcommand", () => {
    const result = parseArgs(["opportunity", "list"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'opportunity list --status pending'", () => {
    const result = parseArgs(["opportunity", "list", "--status", "pending"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.status).toBe("pending");
  });

  it("parses 'opportunity list --limit 5'", () => {
    const result = parseArgs(["opportunity", "list", "--limit", "5"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.limit).toBe(5);
  });

  it("parses 'opportunity list --status accepted --limit 10'", () => {
    const result = parseArgs(["opportunity", "list", "--status", "accepted", "--limit", "10"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.status).toBe("accepted");
    expect(result.limit).toBe(10);
  });

  it("parses 'opportunity show <id>'", () => {
    const result = parseArgs(["opportunity", "show", "opp-123"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBe("opp-123");
  });

  it("parses 'opportunity accept <id>'", () => {
    const result = parseArgs(["opportunity", "accept", "opp-456"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("accept");
    expect(result.targetId).toBe("opp-456");
  });

  it("parses 'opportunity reject <id>'", () => {
    const result = parseArgs(["opportunity", "reject", "opp-789"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("reject");
    expect(result.targetId).toBe("opp-789");
  });

  it("parses bare 'opportunity' with no subcommand", () => {
    const result = parseArgs(["opportunity"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'opportunity show' without id", () => {
    const result = parseArgs(["opportunity", "show"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("show");
    expect(result.targetId).toBeUndefined();
  });

  it("parses 'opportunity list' with --api-url", () => {
    const result = parseArgs(["opportunity", "list", "--api-url", "http://example.com"]);
    expect(result.command).toBe("opportunity");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://example.com");
  });
});

// ── API client tests ──────────────────────────────────────────────

describe("opportunity API client", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(async () => {
    await mock.stop();
  });

  describe("listOpportunities", () => {
    it("returns opportunities from the API", async () => {
      mock.on("GET", "/api/opportunities", () =>
        Response.json({
          opportunities: [
            { id: "o1", status: "pending", interpretation: { category: "Collaboration", confidence: 85 } },
            { id: "o2", status: "accepted", interpretation: { category: "Mentoring", confidence: 92 } },
          ],
        }),
      );

      const result = await client.listOpportunities();
      expect(result).toHaveLength(2);
      expect(result[0].id).toBe("o1");
    });

    it("passes status and limit query params", async () => {
      let receivedUrl = "";
      mock.on("GET", "/api/opportunities", (req) => {
        receivedUrl = req.url;
        return Response.json({ opportunities: [] });
      });

      await client.listOpportunities({ status: "pending", limit: 5 });
      expect(receivedUrl).toContain("status=pending");
      expect(receivedUrl).toContain("limit=5");
    });
  });

  describe("getOpportunity", () => {
    it("returns a single opportunity", async () => {
      mock.on("GET", "/api/opportunities/opp-123", () =>
        Response.json({
          id: "opp-123",
          status: "pending",
          interpretation: { reasoning: "Good match", category: "Hiring", confidence: 88 },
          actors: [],
        }),
      );

      const result = await client.getOpportunity("opp-123");
      expect(result.id).toBe("opp-123");
      expect(result.interpretation.reasoning).toBe("Good match");
    });
  });

});

// ── Output renderer tests ─────────────────────────────────────────

describe("opportunity output renderers", () => {
  let captured: string;

  beforeEach(() => {
    captured = "";
    // Intercept stdout and console.log to capture output
    process.stdout.write = ((chunk: string | Uint8Array) => {
      captured += typeof chunk === "string" ? chunk : new TextDecoder().decode(chunk);
      return true;
    }) as typeof process.stdout.write;
    const origLog = console.log;
    console.log = (...args: unknown[]) => {
      captured += args.map(String).join(" ") + "\n";
    };
  });

  describe("opportunityTable", () => {
    it("renders a table with opportunity data", () => {
      const opportunities: Opportunity[] = [
        {
          id: "o1",
          status: "pending",
          counterpartName: "Alice",
          interpretation: { category: "Collaboration", confidence: 85 },
          createdAt: "2026-03-30T10:00:00Z",
        },
      ];

      output.opportunityTable(opportunities);
      expect(captured).toContain("Alice");
      expect(captured).toContain("Collaboration");
      expect(captured).toContain("pending");
      expect(captured).toContain("85%");
    });

    it("shows empty message when no opportunities", () => {
      output.opportunityTable([]);
      expect(captured).toContain("No opportunities found");
    });
  });

  describe("opportunityCard", () => {
    it("renders a detailed card with parties and roles", () => {
      const opportunity: Opportunity = {
        id: "o2",
        status: "pending",
        actors: [
          { userId: "u1", name: "Bob", role: "patient" },
          { userId: "u2", name: "Carol", role: "agent" },
        ],
        interpretation: {
          category: "Mentoring",
          reasoning: "Bob needs a mentor and Carol has mentoring experience.",
          confidence: 90,
        },
        presentation: "A great opportunity for mentoring.",
        createdAt: "2026-03-30T10:00:00Z",
      };

      output.opportunityCard(opportunity);
      expect(captured).toContain("Bob");
      expect(captured).toContain("Carol");
      expect(captured).toContain("Seeker");  // patient -> Seeker
      expect(captured).toContain("Helper");  // agent -> Helper
      expect(captured).toContain("Mentoring");
      expect(captured).toContain("Bob needs a mentor");
    });

    it("renders peer role correctly", () => {
      const opportunity: Opportunity = {
        id: "o3",
        status: "pending",
        actors: [
          { userId: "u1", name: "Dan", role: "peer" },
          { userId: "u2", name: "Eve", role: "peer" },
        ],
        interpretation: { category: "Partnership", confidence: 75 },
        createdAt: "2026-03-30T10:00:00Z",
      };

      output.opportunityCard(opportunity);
      expect(captured).toContain("Peer");
    });
  });
});

describe("opportunity command behavior", () => {
  it("fails fast when introduction profile or intent gathering fails", async () => {
    const calls: string[] = [];
    const client = {
      async callTool(toolName: string) {
        calls.push(toolName);

        if (toolName === "read_network_memberships") {
          return {
            success: true,
            data: { memberships: [{ networkId: "shared-network" }] },
          };
        }

        if (toolName === "read_user_profiles") {
          return {
            success: false,
            error: "profile lookup failed",
          };
        }

        if (toolName === "read_intents") {
          return {
            success: true,
            data: { intents: [] },
          };
        }

        if (toolName === "discover_opportunities") {
          return {
            success: true,
            data: {},
          };
        }

        return {
          success: false,
          error: `unexpected tool ${toolName}`,
        };
      },
    } as unknown as ApiClient;

    const logs: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await handleOpportunity(client, "discover", {
        introduce: "user-a",
        positionals: ["user-b"],
        json: true,
      });
    } finally {
      console.log = log;
    }

    expect(calls).not.toContain("discover_opportunities");
    expect(logs).toHaveLength(1);
    expect(logs[0]).toContain("\"success\":false");
    expect(logs[0]).toContain("profile lookup failed");
  });

  it("keeps --json output clean during introduction discovery", async () => {
    const client = {
      async callTool(toolName: string) {
        if (toolName === "read_network_memberships") {
          return {
            success: true,
            data: { memberships: [{ networkId: "shared-network" }] },
          };
        }

        if (toolName === "read_user_profiles") {
          return {
            success: true,
            data: { profile: { bio: "test" } },
          };
        }

        if (toolName === "read_intents") {
          return {
            success: true,
            data: { intents: [] },
          };
        }

        return {
          success: true,
          data: { created: true },
        };
      },
    } as unknown as ApiClient;

    const logs: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await handleOpportunity(client, "discover", {
        introduce: "user-a",
        positionals: ["user-b"],
        json: true,
      });
    } finally {
      console.log = log;
    }

    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0])).not.toThrow();
  });

  it("keeps --json output clean for scrape", async () => {
    const { handleScrape } = await import("../src/scrape.command");
    const client = {
      async callTool() {
        return {
          success: true,
          data: {
            url: "https://example.com",
            contentLength: 4,
            content: "test",
          },
        };
      },
    } as unknown as ApiClient;

    const logs: string[] = [];
    const log = console.log;
    console.log = (...args: unknown[]) => {
      logs.push(args.map(String).join(" "));
    };

    try {
      await handleScrape(client, ["https://example.com"], { json: true });
    } finally {
      console.log = log;
    }

    expect(logs).toHaveLength(1);
    expect(() => JSON.parse(logs[0])).not.toThrow();
  });
});
