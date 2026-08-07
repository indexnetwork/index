import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleNetwork } from "../src/network.command";
import { createMockServer } from "./helpers/mock-http";

describe("parseArgs — network command", () => {
  it("parses 'network' with no subcommand as network-help", () => {
    const result = parseArgs(["network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBeUndefined();
  });

  it("parses 'network list'", () => {
    const result = parseArgs(["network", "list"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("list");
  });

  it("parses 'network create <name>'", () => {
    const result = parseArgs(["network", "create", "My Network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("create");
    expect(result.positionals).toEqual(["My Network"]);
  });

  it("parses 'network create <name> --prompt <text>'", () => {
    const result = parseArgs(["network", "create", "My Network", "--prompt", "A test network"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("create");
    expect(result.positionals).toEqual(["My Network"]);
    expect(result.prompt).toBe("A test network");
  });

  it("parses 'network show <id>'", () => {
    const result = parseArgs(["network", "show", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("show");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network join <id>'", () => {
    const result = parseArgs(["network", "join", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("join");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network leave <id>'", () => {
    const result = parseArgs(["network", "leave", "abc-123"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("leave");
    expect(result.positionals).toEqual(["abc-123"]);
  });

  it("parses 'network invite <id> <email>'", () => {
    const result = parseArgs(["network", "invite", "abc-123", "user@example.com"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("invite");
    expect(result.positionals).toEqual(["abc-123", "user@example.com"]);
  });

  it("parses 'network list --api-url <url>'", () => {
    const result = parseArgs(["network", "list", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("network");
    expect(result.subcommand).toBe("list");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});

// ── handleNetwork integration tests ────────────────────────────────

describe("handleNetwork", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token");
  });

  afterAll(async () => {
    await mock.stop();
  });

  it("lists networks, filtering out personal networks", async () => {
    mock.on("GET", "/api/networks", () =>
      Response.json({
        networks: [
          { id: "n1", title: "Public Net", memberCount: 5, isPersonal: false, joinPolicy: "anyone", createdAt: "2026-01-01" },
          { id: "n2", title: "My Personal", memberCount: 1, isPersonal: true, joinPolicy: "invite_only", createdAt: "2026-01-01" },
        ],
      }),
    );

    // Should not throw; personal network filtered in handler
    await handleNetwork(client, "list", [], {});
  });

  it("creates a network with prompt", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/networks", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        network: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
      });
    });

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await handleNetwork(client, "create", ["New Net"], { prompt: "A test", json: true });
    } finally {
      console.log = original;
    }

    expect(receivedBody.title).toBe("New Net");
    expect(receivedBody.prompt).toBe("A test");
    expect(JSON.parse(logs.at(-1) ?? "{}")).toEqual({
      kind: "created",
      network: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
    });
  });

  it("submits a network request for non-staff users", async () => {
    mock.on("POST", "/api/networks", () =>
      Response.json(
        { error: "Network creation is in early access. Submit a request at POST /network-requests." },
        { status: 403 },
      ),
    );
    mock.on("POST", "/api/network-requests", () =>
      Response.json({
        request: { id: "r1", title: "New Net", status: "pending", submittedAt: "2026-08-07T00:00:00Z" },
      }, { status: 201 }),
    );

    const logs: string[] = [];
    const original = console.log;
    console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
    try {
      await handleNetwork(client, "create", ["New Net"], { json: true });
    } finally {
      console.log = original;
    }

    expect(JSON.parse(logs.at(-1) ?? "{}")).toMatchObject({
      kind: "requested",
      request: { id: "r1", status: "pending" },
    });
  });

  it("shows network details and members", async () => {
    mock.on("GET", "/api/networks/n1", () =>
      Response.json({
        network: { id: "n1", title: "Test Net", prompt: "A network", memberCount: 2, joinPolicy: "anyone" },
      }),
    );
    mock.on("GET", "/api/networks/n1/members", () =>
      Response.json({
        members: [
          { id: "u1", name: "Alice", email: "alice@test.com", permissions: ["owner"], createdAt: "2026-01-01" },
          { id: "u2", name: "Bob", email: "bob@test.com", permissions: ["member"], createdAt: "2026-01-02" },
        ],
      }),
    );

    // Should not throw
    await handleNetwork(client, "show", ["n1"], {});
  });

  it("joins a network", async () => {
    mock.on("POST", "/api/networks/n1/join", () =>
      Response.json({ network: { id: "n1", title: "Public Net" } }),
    );

    await handleNetwork(client, "join", ["n1"], {});
  });

  it("leaves a network", async () => {
    mock.on("POST", "/api/networks/n1/leave", () =>
      Response.json({ success: true }),
    );

    await handleNetwork(client, "leave", ["n1"], {});
  });

  it("invites a user directly by email", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/networks/n1/members/invite", async (req) => {
      receivedBody = await req.json() as Record<string, unknown>;
      return Response.json({
        user: { id: "u1", email: "alice@test.com" },
        created: false,
        alreadyMember: false,
        agentProvisioned: true,
      });
    });

    await handleNetwork(client, "invite", ["n1", "alice@test.com"], {});
    expect(receivedBody).toEqual({ email: "alice@test.com" });
  });
});
