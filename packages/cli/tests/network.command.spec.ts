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

  it("lists networks, filtering out personal indexes", async () => {
    mock.on("GET", "/api/indexes", () =>
      Response.json({
        indexes: [
          { id: "n1", title: "Public Net", memberCount: 5, isPersonal: false, joinPolicy: "anyone", createdAt: "2026-01-01" },
          { id: "n2", title: "My Personal", memberCount: 1, isPersonal: true, joinPolicy: "invite_only", createdAt: "2026-01-01" },
        ],
      }),
    );

    // Should not throw; personal index filtered in handler
    await handleNetwork(client, "list", [], {});
  });

  it("creates a network with prompt", async () => {
    let receivedBody: Record<string, unknown> = {};
    mock.on("POST", "/api/indexes", async (req) => {
      receivedBody = (await req.json()) as Record<string, unknown>;
      return Response.json({
        index: { id: "n1", title: "New Net", joinPolicy: "invite_only" },
      });
    });

    await handleNetwork(client, "create", ["New Net"], { prompt: "A test" });
    expect(receivedBody.title).toBe("New Net");
    expect(receivedBody.prompt).toBe("A test");
  });

  it("shows network details and members", async () => {
    mock.on("GET", "/api/indexes/n1", () =>
      Response.json({
        index: { id: "n1", title: "Test Net", prompt: "A network", memberCount: 2, joinPolicy: "anyone" },
      }),
    );
    mock.on("GET", "/api/indexes/n1/members", () =>
      Response.json({
        members: [
          { userId: "u1", user: { name: "Alice", email: "alice@test.com" }, permissions: ["owner"], createdAt: "2026-01-01" },
          { userId: "u2", user: { name: "Bob", email: "bob@test.com" }, permissions: ["member"], createdAt: "2026-01-02" },
        ],
      }),
    );

    // Should not throw
    await handleNetwork(client, "show", ["n1"], {});
  });

  it("joins a network", async () => {
    mock.on("POST", "/api/indexes/n1/join", () =>
      Response.json({ index: { id: "n1", title: "Public Net" } }),
    );

    await handleNetwork(client, "join", ["n1"], {});
  });

  it("leaves a network", async () => {
    mock.on("POST", "/api/indexes/n1/leave", () =>
      Response.json({ success: true }),
    );

    await handleNetwork(client, "leave", ["n1"], {});
  });

  it("invites a user by email", async () => {
    mock.on("GET", "/api/indexes/search-users", () =>
      Response.json({
        users: [{ id: "u1", name: "Alice", email: "alice@test.com" }],
      }),
    );
    mock.on("POST", "/api/indexes/n1/members", async (req) => {
      const body = (await req.json()) as Record<string, unknown>;
      expect(body.userId).toBe("u1");
      return Response.json({ member: { userId: "u1" }, message: "Invited" });
    });

    await handleNetwork(client, "invite", ["n1", "alice@test.com"], {});
  });

  it("handles invite when user not found", async () => {
    mock.on("GET", "/api/indexes/search-users", () =>
      Response.json({ users: [] }),
    );

    // Should not throw, just print error
    await handleNetwork(client, "invite", ["n1", "unknown@test.com"], {});
  });
});
