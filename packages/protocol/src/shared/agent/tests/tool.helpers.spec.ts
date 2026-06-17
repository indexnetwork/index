/** Config */
import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, test } from "bun:test";
import type { ChatGraphCompositeDatabase } from "../../interfaces/database.interface.js";
import { ChatContextAccessError, redactSensitiveFields, resolveChatContext } from "../tool.helpers.js";

const userId = "00000000-0000-4000-8000-000000000111";
const networkId = "00000000-0000-4000-8000-000000000222";

function createContextDatabase(overrides?: Partial<ChatGraphCompositeDatabase>) {
  const base = {
    getUser: async () => ({
      id: userId,
      name: "Test User",
      email: "test@example.com",
      location: "Remote",
      socials: { github: "https://github.com/test" },
    }),
    getProfile: async () => ({
      userId,
      identity: { name: "Test User", bio: "Builder", location: "Remote" },
      narrative: { context: "Building useful systems." },
      attributes: { skills: ["TypeScript"], interests: ["AI"] },
      embedding: null,
    }),
    getNetworkMemberships: async () => ([
      {
        networkId,
        networkTitle: "AI Builders",
        indexPrompt: "People building practical AI tools",
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: new Date("2026-01-01"),
      },
    ]),
    getNetwork: async (id: string) => ({ id, title: "AI Builders" }),
    getNetworkMembership: async (idxId: string, uid: string) =>
      idxId === networkId && uid === userId
        ? {
            networkId,
            networkTitle: "AI Builders",
            indexPrompt: "People building practical AI tools",
            permissions: ["member"],
            memberPrompt: null,
            autoAssign: true,
            isPersonal: false,
            joinedAt: new Date("2026-01-01"),
          }
        : null,
    isNetworkMember: async () => true,
    isIndexOwner: async () => false,
  };

  return { ...base, ...overrides } as Pick<
    ChatGraphCompositeDatabase,
    "getUser" | "getProfile" | "getNetworkMemberships" | "getNetworkMembership" | "getNetwork" | "isNetworkMember" | "isIndexOwner"
  >;
}

describe("resolveChatContext", () => {
  test("preloads user, full profile, and named memberships", async () => {
    const db = createContextDatabase();
    const ctx = await resolveChatContext({ database: db, userId });

    expect(ctx.user.id).toBe(userId);
    expect(ctx.userProfile).not.toBeNull();
    expect(ctx.userNetworks.length).toBe(1);
    expect(ctx.userNetworks[0].networkTitle).toBe("AI Builders");
    expect(ctx.userName).toBe("Test User");
    expect(ctx.userEmail).toBe("test@example.com");
  });

  test("propagates contactsEnabled onto the resolved context (true)", async () => {
    const db = createContextDatabase();
    const ctx = await resolveChatContext({ database: db, userId, contactsEnabled: true });
    expect(ctx.contactsEnabled).toBe(true);
  });

  test("propagates contactsEnabled onto the resolved context (false)", async () => {
    const db = createContextDatabase();
    const ctx = await resolveChatContext({ database: db, userId, contactsEnabled: false });
    expect(ctx.contactsEnabled).toBe(false);
  });

  test("leaves contactsEnabled undefined when not provided (fail-closed at consumers)", async () => {
    const db = createContextDatabase();
    const ctx = await resolveChatContext({ database: db, userId });
    expect(ctx.contactsEnabled).toBeUndefined();
  });

  test("clamps indexScope to [scopedIndex, personalIndex] when networkId is provided", async () => {
    const personalIndexId = "00000000-0000-0000-0000-000000000099";
    const otherIndexId = "00000000-0000-0000-0000-000000000088";
    const memberships = [
      {
        networkId,
        networkTitle: "AI Builders",
        indexPrompt: null,
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: new Date("2026-01-01"),
      },
      {
        networkId: personalIndexId,
        networkTitle: "Personal",
        indexPrompt: null,
        permissions: ["owner"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: true,
        joinedAt: new Date("2026-01-02"),
      },
      {
        networkId: otherIndexId,
        networkTitle: "Other Community",
        indexPrompt: null,
        permissions: ["member"],
        memberPrompt: null,
        autoAssign: true,
        isPersonal: false,
        joinedAt: new Date("2026-01-03"),
      },
    ];
    const db = createContextDatabase({
      getNetworkMemberships: async () => memberships,
      isIndexOwner: async () => false,
      isNetworkMember: async () => true,
    });

    const ctx = await resolveChatContext({ database: db, userId, networkId });
    expect(ctx.indexScope.sort()).toEqual([networkId, personalIndexId].sort());
    // Other Community should NOT be in scope despite being a membership.
    expect(ctx.indexScope).not.toContain(otherIndexId);
  });

  test("indexScope spans all memberships when networkId is not provided", async () => {
    const personalIndexId = "00000000-0000-0000-0000-000000000099";
    const otherIndexId = "00000000-0000-0000-0000-000000000088";
    const memberships = [
      { networkId, networkTitle: "AI Builders", indexPrompt: null, permissions: ["member"], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
      { networkId: personalIndexId, networkTitle: "Personal", indexPrompt: null, permissions: ["owner"], memberPrompt: null, autoAssign: true, isPersonal: true, joinedAt: new Date() },
      { networkId: otherIndexId, networkTitle: "Other", indexPrompt: null, permissions: ["member"], memberPrompt: null, autoAssign: true, isPersonal: false, joinedAt: new Date() },
    ];
    const db = createContextDatabase({
      getNetworkMemberships: async () => memberships,
    });

    const ctx = await resolveChatContext({ database: db, userId });
    expect(ctx.indexScope.sort()).toEqual([networkId, personalIndexId, otherIndexId].sort());
  });

  test("maps scoped membership role to member", async () => {
    const db = createContextDatabase({
      isIndexOwner: async () => false,
      isNetworkMember: async () => true,
    });

    const ctx = await resolveChatContext({ database: db, userId, networkId });
    expect(ctx.scopedMembershipRole).toBe("member");
    expect(ctx.isOwner).toBe(false);
    expect(ctx.scopedIndex?.title).toBe("AI Builders");
  });

  test("maps scoped membership role to owner", async () => {
    const db = createContextDatabase({
      isIndexOwner: async () => true,
      isNetworkMember: async () => true,
    });

    const ctx = await resolveChatContext({ database: db, userId, networkId });
    expect(ctx.scopedMembershipRole).toBe("owner");
    expect(ctx.isOwner).toBe(true);
  });

  test("throws when scoped index is provided for non-member", async () => {
    const db = createContextDatabase({
      isNetworkMember: async () => false,
    });

    const err = await resolveChatContext({ database: db, userId, networkId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatContextAccessError);
    expect((err as ChatContextAccessError).statusCode).toBe(403);
    expect((err as ChatContextAccessError).code).toBe("INDEX_MEMBERSHIP_REQUIRED");
  });

  test("throws ChatContextAccessError with 404 USER_NOT_FOUND when getUser returns null", async () => {
    const db = createContextDatabase({
      getUser: async () => null,
    });

    const err = await resolveChatContext({ database: db, userId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatContextAccessError);
    expect((err as ChatContextAccessError).statusCode).toBe(404);
    expect((err as ChatContextAccessError).code).toBe("USER_NOT_FOUND");
  });

  test("throws ChatContextAccessError with 404 INDEX_NOT_FOUND when networkId provided and getNetwork returns null", async () => {
    const db = createContextDatabase({
      getNetwork: async () => null,
    });

    const err = await resolveChatContext({ database: db, userId, networkId }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ChatContextAccessError);
    expect((err as ChatContextAccessError).statusCode).toBe(404);
    expect((err as ChatContextAccessError).code).toBe("INDEX_NOT_FOUND");
  });

  test("uses getNetworkMembership when membership missing from userNetworks (prompt not lost)", async () => {
    const customPrompt = "Custom index purpose for fallback test";
    const db = createContextDatabase({
      getNetworkMemberships: async () => [], // list empty but user is still member
      getNetworkMembership: async (idxId: string, uid: string) =>
        idxId === networkId && uid === userId
          ? {
              networkId,
              networkTitle: "AI Builders",
              indexPrompt: customPrompt,
              permissions: ["member"],
              memberPrompt: null,
              autoAssign: true,
              isPersonal: false,
              joinedAt: new Date("2026-01-01"),
            }
          : null,
    });

    const ctx = await resolveChatContext({ database: db, userId, networkId });
    expect(ctx.scopedIndex).not.toBeUndefined();
    expect(ctx.scopedIndex?.prompt).toBe(customPrompt);
  });
});

describe("redactSensitiveFields", () => {
  test("replaces top-level secret field with [redacted]", () => {
    const out = redactSensitiveFields({ url: "https://a", secret: "s3cr3t" });
    expect(out).toEqual({ url: "https://a", secret: "[redacted]" });
  });

  test("matches keys case-insensitively and ignores underscores", () => {
    const out = redactSensitiveFields({
      client_secret: "a",
      ClientSecret: "b",
      CLIENT_SECRET: "c",
      API_KEY: "d",
      accessToken: "e",
    });
    expect(out).toEqual({
      client_secret: "[redacted]",
      ClientSecret: "[redacted]",
      CLIENT_SECRET: "[redacted]",
      API_KEY: "[redacted]",
      accessToken: "[redacted]",
    });
  });

  test("redacts nested object fields", () => {
    const out = redactSensitiveFields({
      config: { apiKey: "k", public: { host: "example.com" } },
      headers: { authorization: "Bearer x", token: "t" },
    });
    expect(out).toEqual({
      config: { apiKey: "[redacted]", public: { host: "example.com" } },
      headers: { authorization: "Bearer x", token: "[redacted]" },
    });
  });

  test("redacts fields inside arrays of objects", () => {
    const out = redactSensitiveFields({
      agents: [
        { id: "a", secret: "one" },
        { id: "b", secret: "two" },
      ],
    });
    expect(out).toEqual({
      agents: [
        { id: "a", secret: "[redacted]" },
        { id: "b", secret: "[redacted]" },
      ],
    });
  });

  test("passes primitives through untouched", () => {
    expect(redactSensitiveFields(null)).toBe(null);
    expect(redactSensitiveFields("plain")).toBe("plain");
    expect(redactSensitiveFields(42)).toBe(42);
    expect(redactSensitiveFields(true)).toBe(true);
  });

  test("does not mutate the input object", () => {
    const input = { url: "https://a", secret: "original" };
    const out = redactSensitiveFields(input) as Record<string, unknown>;
    expect(input.secret).toBe("original");
    expect(out.secret).toBe("[redacted]");
  });

  test("leaves non-sensitive field names alone even if their values look like secrets", () => {
    const out = redactSensitiveFields({ notes: "the password is hunter2" });
    expect(out).toEqual({ notes: "the password is hunter2" });
  });
});
