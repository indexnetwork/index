import { describe, it, expect, beforeEach, mock } from "bun:test";
import { z } from "zod";

import { createProfileTools } from "../profile.tools.js";
import type { ToolDeps, ResolvedToolContext } from "../../shared/agent/tool.helpers.js";

interface CapturedTool {
  name: string;
  description: string;
  querySchema: z.ZodType;
  handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
}

function captureTools(deps: ToolDeps): CapturedTool[] {
  const toolDefs: CapturedTool[] = [];
  const defineTool = (def: {
    name: string;
    description: string;
    querySchema: z.ZodType;
    handler: (input: { context: ResolvedToolContext; query: unknown }) => Promise<string>;
  }) => {
    toolDefs.push(def);
    return def;
  };
  createProfileTools(defineTool as unknown as Parameters<typeof createProfileTools>[0], deps);
  return toolDefs;
}

describe("create_user_profile social merge logic", () => {
  let mockSetUserSocials: ReturnType<typeof mock>;
  let mockGetUserSocials: ReturnType<typeof mock>;
  let mockUpdateUser: ReturnType<typeof mock>;
  let mockGetProfile: ReturnType<typeof mock>;
  let mockGetUser: ReturnType<typeof mock>;
  let mockInvokeProfile: ReturnType<typeof mock>;
  let tools: CapturedTool[];
  let createUserProfileTool: CapturedTool;
  let updateUserProfileTool: CapturedTool;

  const baseContext: ResolvedToolContext = {
    userId: "test-user",
    user: { onboarding: { completedAt: "2024-01-01" } },
  } as unknown as ResolvedToolContext;

  beforeEach(() => {
    mockSetUserSocials = mock(async () => {});
    mockGetUserSocials = mock(async () => []);
    mockUpdateUser = mock(async () => ({}));
    mockGetProfile = mock(async () => ({
      identity: { name: "Test", bio: "Bio", location: "NYC" },
      attributes: { skills: ["ts"], interests: ["ai"] },
    }));
    mockGetUser = mock(async () => ({
      id: "test-user",
      name: "Test User",
      email: "test@example.com",
      socials: [],
    }));
    mockInvokeProfile = mock(async () => ({ readResult: { hasProfile: true, profile: { id: "profile-1" } } }));

    const deps = {
      userDb: {
        setUserSocials: mockSetUserSocials,
        getUserSocials: mockGetUserSocials,
        updateUser: mockUpdateUser,
        getProfile: mockGetProfile,
        getUser: mockGetUser,
      },
      systemDb: {},
      database: {},
      graphs: { profile: { invoke: mockInvokeProfile } },
      enricher: { enrichUserProfile: async () => null },
      grantDefaultSystemPermissions: async () => undefined,
    } as unknown as ToolDeps;

    tools = captureTools(deps);
    createUserProfileTool = tools.find((t) => t.name === "create_user_profile")!;
    updateUserProfileTool = tools.find((t) => t.name === "update_user_profile")!;
  });

  it("does not call setUserSocials when no social URLs provided", async () => {
    await createUserProfileTool.handler({
      context: baseContext,
      query: { name: "Alice" },
    });
    expect(mockSetUserSocials).not.toHaveBeenCalled();
  });

  it("calls setUserSocials with linkedin when linkedinUrl provided", async () => {
    await createUserProfileTool.handler({
      context: baseContext,
      query: { linkedinUrl: "https://linkedin.com/in/alice" },
    });
    expect(mockSetUserSocials).toHaveBeenCalledTimes(1);
    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "linkedin", value: "https://linkedin.com/in/alice" });
  });

  it("preserves existing socials when adding new ones with different labels", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "github", value: "alice" },
      { id: "2", userId: "test-user", label: "telegram", value: "alice_tg" },
    ]);

    await createUserProfileTool.handler({
      context: baseContext,
      query: { linkedinUrl: "https://linkedin.com/in/alice" },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "github", value: "alice" });
    expect(arg).toContainEqual({ label: "telegram", value: "alice_tg" });
    expect(arg).toContainEqual({ label: "linkedin", value: "https://linkedin.com/in/alice" });
  });

  it("replaces existing social when new one has the same label", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "linkedin", value: "old-alice" },
      { id: "2", userId: "test-user", label: "github", value: "alice-gh" },
    ]);

    await createUserProfileTool.handler({
      context: baseContext,
      query: { linkedinUrl: "https://linkedin.com/in/new-alice" },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    const linkedins = arg.filter((s) => s.label === "linkedin");
    expect(linkedins).toHaveLength(1);
    expect(linkedins[0].value).toBe("https://linkedin.com/in/new-alice");
    expect(arg).toContainEqual({ label: "github", value: "alice-gh" });
  });

  it("handles multiple social URLs at once", async () => {
    await createUserProfileTool.handler({
      context: baseContext,
      query: {
        linkedinUrl: "https://linkedin.com/in/alice",
        githubUrl: "https://github.com/alice",
        twitterUrl: "https://x.com/alice",
      },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "linkedin", value: "https://linkedin.com/in/alice" });
    expect(arg).toContainEqual({ label: "github", value: "https://github.com/alice" });
    expect(arg).toContainEqual({ label: "twitter", value: "https://x.com/alice" });
  });

  it("replaces all custom socials when websites provided", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "custom", value: "https://old-blog.com" },
      { id: "2", userId: "test-user", label: "linkedin", value: "alice" },
    ]);

    await createUserProfileTool.handler({
      context: baseContext,
      query: { websites: ["https://new-blog.com"] },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    const customs = arg.filter((s) => s.label === "custom");
    expect(customs).toHaveLength(1);
    expect(customs[0].value).toBe("https://new-blog.com");
    expect(arg).toContainEqual({ label: "linkedin", value: "alice" });
  });

  it("preserves existing custom socials when no websites provided", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "custom", value: "https://myblog.com" },
      { id: "2", userId: "test-user", label: "linkedin", value: "alice" },
    ]);

    await createUserProfileTool.handler({
      context: baseContext,
      query: { githubUrl: "https://github.com/alice" },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "custom", value: "https://myblog.com" });
    expect(arg).toContainEqual({ label: "github", value: "https://github.com/alice" });
    expect(arg).toContainEqual({ label: "linkedin", value: "alice" });
  });

  it("auto-detects label for website URLs that match known platforms", async () => {
    await createUserProfileTool.handler({
      context: baseContext,
      query: { websites: ["https://github.com/alice", "https://myblog.com"] },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "github", value: "https://github.com/alice" });
    expect(arg).toContainEqual({ label: "custom", value: "https://myblog.com" });
  });

  it("trims whitespace from social URLs", async () => {
    await createUserProfileTool.handler({
      context: baseContext,
      query: { linkedinUrl: "  https://linkedin.com/in/alice  " },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "linkedin", value: "https://linkedin.com/in/alice" });
  });

  it("update_user_profile merges social-only updates without invoking the graph", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "github", value: "alice-gh" },
      { id: "2", userId: "test-user", label: "telegram", value: "old_tg" },
    ]);

    const result = await updateUserProfileTool.handler({
      context: baseContext,
      query: { socials: { telegram: "@alice_tg" } },
    });

    expect(result).toContain("Profile socials updated");
    expect(mockInvokeProfile).not.toHaveBeenCalled();
    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toEqual([
      { label: "github", value: "alice-gh" },
      { label: "telegram", value: "alice_tg" },
    ]);
  });

  it("update_user_profile lowercases social labels before merging", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "github", value: "old-gh" },
    ]);

    await updateUserProfileTool.handler({
      context: baseContext,
      query: { socials: { GitHub: "new-gh" } },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toEqual([{ label: "github", value: "new-gh" }]);
  });

  it("update_user_profile persists socials while preserving non-overlapping labels before profile edits", async () => {
    mockGetUserSocials.mockResolvedValue([
      { id: "1", userId: "test-user", label: "linkedin", value: "alice-li" },
      { id: "2", userId: "test-user", label: "github", value: "alice-gh" },
    ]);
    mockInvokeProfile
      .mockResolvedValueOnce({ readResult: { hasProfile: true, profile: { id: "profile-1" } } })
      .mockResolvedValueOnce({});

    await updateUserProfileTool.handler({
      context: baseContext,
      query: { action: "set location", details: "Berlin", socials: { telegram: "alice_tg" } },
    });

    const arg = mockSetUserSocials.mock.calls[0][0] as Array<{ label: string; value: string }>;
    expect(arg).toContainEqual({ label: "linkedin", value: "alice-li" });
    expect(arg).toContainEqual({ label: "github", value: "alice-gh" });
    expect(arg).toContainEqual({ label: "telegram", value: "alice_tg" });
    expect(mockInvokeProfile).toHaveBeenCalledTimes(2);
  });
});
