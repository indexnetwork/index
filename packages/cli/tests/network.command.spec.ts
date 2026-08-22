import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { handleNetwork } from "../src/network.command";
import { stripAnsi } from "../src/output";
import { createMockServer } from "./helpers/mock-http";

async function captureTerminal(run: () => Promise<void>): Promise<string> {
  const logs: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => logs.push(args.map(String).join(" "));
  try {
    await run();
  } finally {
    console.log = original;
  }
  return stripAnsi(logs.join("\n"));
}

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

  it("describes direct creation and early-access requests in command help", async () => {
    const terminal = await captureTerminal(() => handleNetwork(client, undefined, [], {}));
    expect(terminal).toContain("Create directly or submit an early-access request");
    expect(terminal).toContain("Create directly or request early access with a description");
  });

  it("lists every network returned by the API", async () => {
    mock.on("GET", "/api/networks", () =>
      Response.json({
        networks: [
          { id: "n1", title: "Public Net", memberCount: 5, joinPolicy: "anyone", createdAt: "2026-01-01" },
          { id: "n2", title: "Private Net", memberCount: 1, joinPolicy: "invite_only", createdAt: "2026-01-01" },
        ],
      }),
    );

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

  it("prints the created network terminal result", async () => {
    mock.on("POST", "/api/networks", () =>
      Response.json({
        network: { id: "n1", key: "new-net", title: "New Net", joinPolicy: "invite_only" },
      }),
    );

    const terminal = await captureTerminal(() => handleNetwork(client, "create", ["New Net"], {}));
    expect(terminal).toContain("Network created: New Net");
    expect(terminal).toContain("Key: new-net");
    expect(terminal).toContain("ID: n1");
    expect(terminal).toContain("Join Policy: invite only");
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

  it("prints the submitted network request terminal result", async () => {
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

    const terminal = await captureTerminal(() => handleNetwork(client, "create", ["New Net"], {}));
    expect(terminal).toContain("Network request submitted: New Net");
    expect(terminal).toContain("Status: pending");
    expect(terminal).toContain("Request ID: r1");
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

    const terminal = await captureTerminal(() => handleNetwork(client, "invite", ["n1", "alice@test.com"], {}));
    expect(receivedBody).toEqual({ email: "alice@test.com" });
    expect(terminal).toContain("Invitation sent to alice@test.com.");
  });

  it("reports when the invitee is already a network member", async () => {
    mock.on("POST", "/api/networks/n1/members/invite", () =>
      Response.json({
        user: { id: "u1", email: "member@test.com" },
        created: false,
        alreadyMember: true,
        agentProvisioned: true,
      }),
    );

    const terminal = await captureTerminal(() => handleNetwork(client, "invite", ["n1", "member@test.com"], {}));
    expect(terminal).toContain("member@test.com is already a network member.");
  });

  it("reports when an invitation creates a pending account", async () => {
    mock.on("POST", "/api/networks/n1/members/invite", () =>
      Response.json({
        user: { id: "u2", email: "new@test.com" },
        created: true,
        alreadyMember: false,
        agentProvisioned: true,
      }, { status: 201 }),
    );

    const terminal = await captureTerminal(() => handleNetwork(client, "invite", ["n1", "new@test.com"], {}));
    expect(terminal).toContain("Invitation sent to new@test.com.");
    expect(terminal).toContain("Created a pending account for this invitee.");
  });
});
