import { describe, it, expect, beforeAll, afterAll } from "bun:test";

import { parseArgs } from "../src/args.parser";
import { ApiClient } from "../src/api.client";
import { profileCard } from "../src/output";
import { createMockServer } from "./helpers/mock-http";

describe("parseArgs — profile command", () => {
  it("parses 'profile' with no args as view-own", () => {
    const result = parseArgs(["profile"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBeUndefined();
    expect(result.userId).toBeUndefined();
  });

  it("parses 'profile show <user-id>'", () => {
    const result = parseArgs(["profile", "show", "user-abc-123"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("show");
    expect(result.userId).toBe("user-abc-123");
  });

  it("parses 'profile sync'", () => {
    const result = parseArgs(["profile", "sync"]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("sync");
  });

  it("parses 'profile --api-url <url>'", () => {
    const result = parseArgs(["profile", "--api-url", "http://localhost:4000"]);
    expect(result.command).toBe("profile");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });

  it("parses 'profile show <user-id> --api-url <url>'", () => {
    const result = parseArgs([
      "profile",
      "show",
      "user-abc-123",
      "--api-url",
      "http://localhost:4000",
    ]);
    expect(result.command).toBe("profile");
    expect(result.subcommand).toBe("show");
    expect(result.userId).toBe("user-abc-123");
    expect(result.apiUrl).toBe("http://localhost:4000");
  });
});

// ── API client — profile methods ────────────────────────────────────

describe("ApiClient — profile methods", () => {
  let mock: ReturnType<typeof createMockServer>;
  let client: ApiClient;

  beforeAll(async () => {
    mock = await createMockServer();
    client = new ApiClient(mock.url, "test-token-123");
  });

  afterAll(async () => {
    await mock.stop();
  });

  describe("getUser", () => {
    it("returns user profile data", async () => {
      mock.on("GET", "/api/users/user-abc-123", () =>
        Response.json({
          user: {
            id: "user-abc-123",
            name: "Alice",
            intro: "ML engineer working on robotics",
            avatar: "https://example.com/avatar.jpg",
            location: "San Francisco, US",
            socials: [{ label: "linkedin", value: "https://linkedin.com/in/alice" }],
            isGhost: false,
            createdAt: "2026-01-15T00:00:00Z",
            updatedAt: "2026-03-20T00:00:00Z",
          },
        }),
      );

      const user = await client.getUser("user-abc-123");
      expect(user.id).toBe("user-abc-123");
      expect(user.name).toBe("Alice");
      expect(user.intro).toBe("ML engineer working on robotics");
      expect(user.location).toBe("San Francisco, US");
      expect(user.isGhost).toBe(false);
    });

    it("sends the authorization header", async () => {
      let receivedAuth = "";
      mock.on("GET", "/api/users/user-xyz", (req) => {
        receivedAuth = req.headers.get("authorization") ?? "";
        return Response.json({
          user: { id: "user-xyz", name: "Bob", isGhost: false, createdAt: "2026-01-01" },
        });
      });

      await client.getUser("user-xyz");
      expect(receivedAuth).toBe("Bearer test-token-123");
    });

    it("throws on 401", async () => {
      mock.on("GET", "/api/users/user-bad", () =>
        Response.json({ error: "Unauthorized" }, { status: 401 }),
      );

      try {
        await client.getUser("user-bad");
        expect(true).toBe(false);
      } catch (e: unknown) {
        expect((e as Error).message).toContain("expired");
      }
    });
  });

});

// ── Profile card rendering ──────────────────────────────────────────

describe("profileCard", () => {
  it("renders without throwing for a full profile", () => {
    expect(() =>
      profileCard({
        id: "user-abc-123",
        name: "Alice",
        intro: "ML engineer working on robotics",
        avatar: "https://example.com/avatar.jpg",
        location: "San Francisco, US",
        socials: [
          { label: "linkedin", value: "https://linkedin.com/in/alice" },
          { label: "github", value: "https://github.com/alice" },
        ],
        isGhost: false,
        createdAt: "2026-01-15T00:00:00Z",
        updatedAt: "2026-03-20T00:00:00Z",
      }),
    ).not.toThrow();
  });

  it("renders without throwing for a ghost user with minimal data", () => {
    expect(() =>
      profileCard({
        id: "user-ghost",
        name: null,
        intro: null,
        avatar: null,
        location: null,
        socials: null,
        isGhost: true,
        createdAt: "2026-01-15T00:00:00Z",
        updatedAt: null,
      }),
    ).not.toThrow();
  });

  it("returns a string containing the user name", () => {
    const output = profileCard({
      id: "user-abc",
      name: "Bob",
      intro: "Developer",
      avatar: null,
      location: "Berlin, DE",
      socials: null,
      isGhost: false,
      createdAt: "2026-01-01T00:00:00Z",
      updatedAt: null,
    });
    // eslint-disable-next-line no-control-regex
    const plain = output.replace(/\x1b\[[0-9;]*m/g, "");
    expect(plain).toContain("Bob");
    expect(plain).toContain("Berlin, DE");
    expect(plain).toContain("Developer");
  });
});
