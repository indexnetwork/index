import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, test } from "bun:test";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";
import type { ResolvedToolContext, ToolDeps } from "../../shared/agent/tool.helpers.js";
import { buildMinimalOpportunityCard, createOpportunityTools } from "../opportunity.tools.js";
import { deduplicateByPerson } from "../opportunity.utils.js";

type CapturedDiscoverInput = {
  indexScope: string[];
};

function captureDiscoverToolForScopeTest(
  runDiscoverFromQuery?: (input: CapturedDiscoverInput) => Promise<unknown>,
  indexGraph: { invoke: (input: unknown) => Promise<unknown> } = {
    invoke: async () => ({ readResult: { memberOf: [] } }),
  },
) {
  let captured: { handler: (input: { context: ResolvedToolContext; query: Record<string, unknown> }) => Promise<string> } | undefined;
  const defineTool = (def: { name: string }) => {
    if (def.name === "discover_opportunities") captured = def as never;
    return def;
  };
  const deps = {
    database: {} as never,
    systemDb: {} as never,
    userDb: {} as never,
    cache: {} as never,
    graphs: {
      opportunity: { invoke: async () => ({}) },
      index: indexGraph,
      networkMembership: { invoke: async () => ({}) },
    } as never,
    ...(runDiscoverFromQuery
      ? { opportunityDiscovery: { runDiscoverFromQuery: runDiscoverFromQuery as never } }
      : {}),
  } as unknown as ToolDeps;
  createOpportunityTools(defineTool as never, deps);
  if (!captured) throw new Error("discover_opportunities tool not registered");
  return captured;
}

function makeScopeTestContext(overrides?: Partial<ResolvedToolContext>): ResolvedToolContext {
  return {
    userId: "viewer-1",
    userName: "Viewer",
    userEmail: "viewer@example.com",
    user: { id: "viewer-1", name: "Viewer", email: "viewer@example.com" } as never,
    userProfile: null,
    userNetworks: [
      { networkId: "focused-net", networkTitle: "Focused", isPersonal: false, permissions: ["member"], memberPrompt: null, indexPrompt: null, autoAssign: true, joinedAt: new Date() },
      { networkId: "personal-net", networkTitle: "Personal", isPersonal: true, permissions: ["owner"], memberPrompt: null, indexPrompt: null, autoAssign: true, joinedAt: new Date() },
      { networkId: "other-net", networkTitle: "Other", isPersonal: false, permissions: ["member"], memberPrompt: null, indexPrompt: null, autoAssign: true, joinedAt: new Date() },
    ],
    indexScope: ["focused-net", "personal-net"],
    networkId: "focused-net",
    scopeType: "network",
    scopeId: "focused-net",
    isOnboarding: false,
    hasName: true,
    ...overrides,
  } as ResolvedToolContext;
}

describe("discover_opportunities — scoped discovery reach", () => {
  it("uses focused network only, excluding personal-index assignment reach", async () => {
    let capturedInput: CapturedDiscoverInput | undefined;
    const tool = captureDiscoverToolForScopeTest(async (input) => {
      capturedInput = input;
      return { found: false, message: "No matching opportunities found." };
    });

    const raw = await tool.handler({
      context: makeScopeTestContext(),
      query: { searchQuery: "AI collaborators" },
    });
    const result = JSON.parse(raw) as { success: boolean };

    expect(result.success).toBe(true);
    expect(capturedInput?.indexScope).toEqual(["focused-net"]);
    expect(capturedInput?.indexScope).not.toContain("personal-net");
    expect(capturedInput?.indexScope).not.toContain("other-net");
  });

  it("fails closed when the scope envelope points at a non-membership network", async () => {
    let capturedInput: CapturedDiscoverInput | undefined;
    const tool = captureDiscoverToolForScopeTest(async (input) => {
      capturedInput = input;
      return { found: false, message: "No matching opportunities found." };
    });

    const raw = await tool.handler({
      context: makeScopeTestContext({ scopeId: "missing-net", networkId: "missing-net" }),
      query: { searchQuery: "AI collaborators" },
    });
    const result = JSON.parse(raw) as { success: boolean };

    expect(result.success).toBe(true);
    expect(capturedInput?.indexScope).toEqual([]);
  });
});

describe("discover_opportunities — unscoped discovery reach", () => {
  const unscopedContext = () => makeScopeTestContext({
    networkId: undefined,
    scopeType: undefined,
    scopeId: undefined,
  });

  it("resolves every membership returned by the index graph", async () => {
    let capturedInput: CapturedDiscoverInput | undefined;
    const tool = captureDiscoverToolForScopeTest(
      async (input) => {
        capturedInput = input;
        return { found: false, message: "No matching opportunities found." };
      },
      {
        invoke: async () => ({
          readResult: {
            memberOf: [
              { networkId: "network-1" },
              { networkId: "network-2" },
              { networkId: "network-3" },
            ],
          },
        }),
      },
    );

    const raw = await tool.handler({
      context: unscopedContext(),
      query: { searchQuery: "AI collaborators" },
    });
    const result = JSON.parse(raw) as { success: boolean };

    expect(result.success).toBe(true);
    expect(capturedInput?.indexScope).toEqual(["network-1", "network-2", "network-3"]);
  });

  it("surfaces index-graph errors instead of treating them as no memberships", async () => {
    let discoveryCalled = false;
    const tool = captureDiscoverToolForScopeTest(
      async () => {
        discoveryCalled = true;
        return { found: false };
      },
      { invoke: async () => ({ error: "Failed to fetch network information." }) },
    );

    const raw = await tool.handler({
      context: unscopedContext(),
      query: { searchQuery: "AI collaborators" },
    });
    const result = JSON.parse(raw) as { success: boolean; error?: string };

    expect(result).toEqual({
      success: false,
      error: "Failed to fetch network information.",
    });
    expect(discoveryCalled).toBe(false);
  });

  it("keeps the join-a-network response for genuine zero-membership users", async () => {
    const tool = captureDiscoverToolForScopeTest();

    const raw = await tool.handler({
      context: unscopedContext(),
      query: { searchQuery: "AI collaborators" },
    });
    const result = JSON.parse(raw) as { success: boolean; data?: { message?: string } };

    expect(result.success).toBe(true);
    expect(result.data?.message).toBe(
      "You need to join at least one network (community) to discover opportunities. Use read_networks to see available networks, or create one.",
    );
  });
});

describe("buildMinimalOpportunityCard - IND-113", () => {
  const mockOpportunity = {
    id: "opp-123",
    status: "pending",
    interpretation: {
      reasoning:
        "Seref Yarar introduced you to Lucy Chen, who is actively seeking a product co-founder.",
      confidence: 0.85,
    },
    actors: [
      { userId: "viewer-456", role: "party" },
      { userId: "counterpart-789", role: "party" },
      { userId: "introducer-abc", role: "introducer" },
    ],
    detection: {
      source: "manual",
      createdByName: "Seref Yarar",
    },
  } as unknown as Opportunity;

  it("should not include introducer name in mainText when introducerName is passed", () => {
    const card = buildMinimalOpportunityCard(
      mockOpportunity,
      "viewer-456",
      "counterpart-789",
      "Lucy Chen",
      null,
      "Seref Yarar",
      null,
      undefined,
      undefined,
    );
    expect(card.mainText).not.toContain("Seref Yarar");
    expect(card.mainText).not.toContain("Seref");
    expect(card.mainText).toContain("Lucy Chen");
    expect(typeof card.mainText).toBe("string");
    expect(card.mainText.length).toBeGreaterThan(0);
  });

  it("should include counterpart name in mainText", () => {
    const card = buildMinimalOpportunityCard(
      mockOpportunity,
      "viewer-456",
      "counterpart-789",
      "Lucy Chen",
      null,
      "Seref Yarar",
      null,
      undefined,
      undefined,
    );
    expect(card.mainText).toContain("Lucy Chen");
  });

  it("strips unsupported presence claims from minimal public card prose", () => {
    const unsafeOpportunity = {
      ...mockOpportunity,
      interpretation: {
        reasoning: "Lucy attended the same event as the viewer.",
        confidence: 0.85,
      },
    } as unknown as Opportunity;
    const card = buildMinimalOpportunityCard(
      unsafeOpportunity,
      "viewer-456",
      "counterpart-789",
      "Lucy Chen",
      null,
    );
    expect(card.mainText).toBe("A suggested connection.");
    expect(card.narratorChip.text).toBe("A potential connection worth exploring.");
    expect(card.mainText).not.toContain("attended");
  });

  it("should return safe card when interpretation or reasoning is missing", () => {
    const oppNoInterpretation = {
      id: "opp-no-interp",
      status: "pending",
      actors: [{ userId: "viewer-1", role: "party" }, { userId: "counterpart-1", role: "party" }],
      detection: { source: "manual" },
    } as unknown as Opportunity;
    const card = buildMinimalOpportunityCard(
      oppNoInterpretation,
      "viewer-1",
      "counterpart-1",
      "Alice",
      null,
      undefined,
      null,
      undefined,
      undefined,
    );
    expect(card).toBeDefined();
    expect(typeof card.mainText).toBe("string");
    expect(card.opportunityId).toBe("opp-no-interp");
    expect(card.name).toBe("Alice");
  });
});

describe('buildMinimalOpportunityCard - ghost user CTA (IND-161)', () => {
  const baseOpp = {
    id: 'opp-ghost',
    status: 'latent',
    interpretation: { reasoning: 'Strong match on AI interests.', confidence: 0.9 },
    actors: [
      { userId: 'viewer-1', role: 'party' },
      { userId: 'ghost-user', role: 'party' },
    ],
    detection: { source: 'opportunity_graph' },
  } as unknown as Opportunity;

  it('uses "Start Chat" as primaryActionLabel even when counterpart is a ghost user', () => {
    const card = buildMinimalOpportunityCard(
      baseOpp, 'viewer-1', 'ghost-user', 'Ghost User', null,
      undefined, null, undefined, undefined, undefined, undefined, true,
    );
    expect(card.primaryActionLabel).toBe('Start Chat');
    expect(card.isGhost).toBe(true);
  });

  it('uses "Start Chat" as primaryActionLabel when counterpart is not a ghost user', () => {
    const card = buildMinimalOpportunityCard(
      baseOpp, 'viewer-1', 'ghost-user', 'Real User', null,
      undefined, null, undefined, undefined, undefined, undefined, false,
    );
    expect(card.primaryActionLabel).toBe('Start Chat');
    expect(card.isGhost).toBe(false);
  });

  it('uses "Start Chat" as primaryActionLabel when isCounterpartGhost is not provided', () => {
    const card = buildMinimalOpportunityCard(
      baseOpp, 'viewer-1', 'ghost-user', 'Real User', null,
    );
    expect(card.primaryActionLabel).toBe('Start Chat');
    expect(card.isGhost).toBe(false);
  });

  it('uses "Good match" when viewer is the introducer, even for ghost counterpart', () => {
    const introOpp = {
      ...baseOpp,
      actors: [
        { userId: 'introducer-1', role: 'introducer' },
        { userId: 'ghost-user', role: 'party' },
        { userId: 'other-party', role: 'party' },
      ],
    } as unknown as Opportunity;
    const card = buildMinimalOpportunityCard(
      introOpp, 'introducer-1', 'ghost-user', 'Ghost User', null,
      undefined, null, undefined, undefined, undefined, undefined, true,
    );
    expect(card.primaryActionLabel).toBe('Good match');
  });
});

describe('buildMinimalOpportunityCard - introducer discovery (IND-140)', () => {
  const mockIntroducerOpp = {
    id: 'opp-intro-disc',
    status: 'draft',
    interpretation: {
      reasoning: 'Target User and Bob share interest in AI infrastructure.',
      confidence: 0.85,
    },
    actors: [
      { userId: 'target-user', role: 'patient' },
      { userId: 'user-bob', role: 'agent' },
      { userId: 'introducer-user', role: 'introducer' },
    ],
    detection: { source: 'manual', createdByName: 'Introducer Name' },
  } as unknown as Opportunity;

  it('should return viewerRole "introducer" when viewer is the introducer', () => {
    const card = buildMinimalOpportunityCard(
      mockIntroducerOpp,
      'introducer-user',
      'target-user',
      'Target User',
      null,
      undefined,
      null,
      'Introducer Name',
      'Bob',
    );
    expect(card.viewerRole).toBe('introducer');
    expect(card.primaryActionLabel).toBe('Good match');
    expect(card.headline).toBe('Target User → Bob');
  });
});

import { resolveActionableLinkKind, buildOpportunityPresentation, attachActionableLinks, buildProfileUrl } from "../opportunity.tools.js";

describe("resolveActionableLinkKind — actionability matrix", () => {
  test("accepted + non-introducer → outreach", () => {
    expect(resolveActionableLinkKind({ status: "accepted", viewerRole: "party" })).toBe("outreach");
    expect(resolveActionableLinkKind({ status: "accepted", viewerRole: "agent" })).toBe("outreach");
    expect(resolveActionableLinkKind({ status: "accepted", viewerRole: "patient" })).toBe("outreach");
    expect(resolveActionableLinkKind({ status: "accepted", viewerRole: "peer" })).toBe("outreach");
  });

  test("accepted + introducer → null", () => {
    expect(resolveActionableLinkKind({ status: "accepted", viewerRole: "introducer" })).toBeNull();
  });

  test("pending + non-introducer without actedAt → connect", () => {
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "party" })).toBe("connect");
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "patient" })).toBe("connect");
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "agent" })).toBe("connect");
  });

  test("pending + non-introducer with actedAt → null", () => {
    expect(
      resolveActionableLinkKind({
        status: "pending",
        viewerRole: "agent",
        viewerActedAt: "2026-06-26T16:21:49.649Z",
      }),
    ).toBeNull();
  });

  test("pending + introducer → null", () => {
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "introducer" })).toBeNull();
  });

  test("draft + introducer + unapproved → approve_introduction", () => {
    expect(
      resolveActionableLinkKind({ status: "draft", viewerRole: "introducer", viewerApproved: false }),
    ).toBe("approve_introduction");
    // undefined defaults to "unapproved" for fresh drafts coming from discover_opportunities
    expect(
      resolveActionableLinkKind({ status: "draft", viewerRole: "introducer" }),
    ).toBe("approve_introduction");
  });

  test("draft + introducer + approved → null", () => {
    expect(
      resolveActionableLinkKind({ status: "draft", viewerRole: "introducer", viewerApproved: true }),
    ).toBeNull();
  });

  test("draft + non-introducer → send_direct (sender releases the draft)", () => {
    expect(resolveActionableLinkKind({ status: "draft", viewerRole: "party" })).toBe("send_direct");
    expect(resolveActionableLinkKind({ status: "draft", viewerRole: "agent" })).toBe("send_direct");
  });

  test("draft/latent + non-introducer with actedAt → null (send_direct suppressed)", () => {
    expect(
      resolveActionableLinkKind({
        status: "draft",
        viewerRole: "party",
        viewerActedAt: "2026-06-26T16:21:49.649Z",
      }),
    ).toBeNull();
    expect(
      resolveActionableLinkKind({
        status: "latent",
        viewerRole: "agent",
        viewerActedAt: "2026-06-26T16:21:49.649Z",
      }),
    ).toBeNull();
  });

  test("accepted + non-introducer with actedAt → outreach (acting doesn't kill outreach)", () => {
    expect(
      resolveActionableLinkKind({
        status: "accepted",
        viewerRole: "party",
        viewerActedAt: "2026-06-26T16:21:49.649Z",
      }),
    ).toBe("outreach");
  });

  test("terminal / internal / unknown statuses → null", () => {
    expect(resolveActionableLinkKind({ status: "rejected", viewerRole: "party" })).toBeNull();
    expect(resolveActionableLinkKind({ status: "expired", viewerRole: "introducer", viewerApproved: false })).toBeNull();
    expect(resolveActionableLinkKind({ status: "stalled", viewerRole: "party" })).toBeNull();
  });

  test("latent + introducer + unapproved → approve_introduction (connector-flow before approval)", () => {
    expect(
      resolveActionableLinkKind({ status: "latent", viewerRole: "introducer", viewerApproved: false }),
    ).toBe("approve_introduction");
    // undefined defaults match "unapproved" — same as draft.
    expect(
      resolveActionableLinkKind({ status: "latent", viewerRole: "introducer" }),
    ).toBe("approve_introduction");
  });

  test("latent + introducer + approved → null (negotiation in flight)", () => {
    expect(
      resolveActionableLinkKind({ status: "latent", viewerRole: "introducer", viewerApproved: true }),
    ).toBeNull();
  });

  test("latent + non-introducer → send_direct (parallel to the draft case)", () => {
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "party" })).toBe("send_direct");
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "agent" })).toBe("send_direct");
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "patient" })).toBe("send_direct");
  });
});

// ---------------------------------------------------------------------------
// attachActionableLinks — mutation and resilience
// ---------------------------------------------------------------------------

type TestCard = Record<string, unknown> & {
  opportunityId: string;
  viewerRole: string;
  status: string;
};

function makeCard(
  overrides: Partial<TestCard> & { opportunityId: string; viewerRole: string; status: string },
): TestCard {
  return { name: "Counterpart", ...overrides };
}

function makeMintSpy(url = "https://api.test/c/AAAAAAAAAA") {
  const calls: Array<{ userId: string; opportunityId: string; kind: string; greeting?: string | null }> = [];
  const mintConnectLink = async (args: { userId: string; opportunityId: string; kind: string; greeting?: string | null }) => {
    calls.push(args);
    return { url };
  };
  return { mintConnectLink, calls };
}

describe("attachActionableLinks — mutation and resilience", () => {
  test("pending + party → mints connect, attaches all fields", async () => {
    const card = makeCard({ opportunityId: "opp-1", viewerRole: "party", status: "pending" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-1",
      counterpartUserId: "counterpart-1",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(1);
    expect(calls[0]).toMatchObject({ userId: "user-1", opportunityId: "opp-1", kind: "connect", greeting: null });
    expect(card.acceptUrl).toBe("https://api.test/c/AAAAAAAAAA");
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-1?link_preview=false");
    expect(card.feedCategory).toBe("connection");
  });

  test("accepted + party → mints outreach, feedCategory=connection", async () => {
    const card = makeCard({ opportunityId: "opp-2", viewerRole: "party", status: "accepted" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-2",
      counterpartUserId: "counterpart-2",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("outreach");
    expect(card.feedCategory).toBe("connection");
  });

  test("draft + introducer + viewerApproved=false → mints approve_introduction, feedCategory=connector-flow", async () => {
    const card = makeCard({ opportunityId: "opp-3", viewerRole: "introducer", status: "draft" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-3",
      viewerApproved: false,
      counterpartUserId: "counterpart-3",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("approve_introduction");
    expect(card.feedCategory).toBe("connector-flow");
  });

  test("draft + introducer + viewerApproved=true → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-4", viewerRole: "introducer", status: "draft" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-4",
      viewerApproved: true,
      counterpartUserId: "counterpart-4",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-4?link_preview=false");
    expect(card.feedCategory).toBeUndefined();
  });

  test("draft + party (sender) → mints send_direct, feedCategory=connection, profileUrl attached", async () => {
    const card = makeCard({ opportunityId: "opp-5", viewerRole: "party", status: "draft" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-5",
      counterpartUserId: "counterpart-5",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(1);
    expect(calls[0].kind).toBe("send_direct");
    expect(card.acceptUrl).toBe("https://api.test/c/AAAAAAAAAA");
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-5?link_preview=false");
    expect(card.feedCategory).toBe("connection");
  });

  test("pending + introducer → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-6", viewerRole: "introducer", status: "pending" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-6",
      counterpartUserId: "counterpart-6",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-6?link_preview=false");
  });

  test("pending + already-acted viewer → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-6b", viewerRole: "agent", status: "pending" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-6b",
      viewerActedAt: "2026-06-26T16:21:49.649Z",
      counterpartUserId: "counterpart-6b",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-6b?link_preview=false");
  });

  test("accepted + introducer → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-7", viewerRole: "introducer", status: "accepted" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-7",
      counterpartUserId: "counterpart-7",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-7?link_preview=false");
  });

  test("rejected (any role) → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-8", viewerRole: "party", status: "rejected" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-8",
      counterpartUserId: "counterpart-8",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-8?link_preview=false");
  });

  test("profileUrl uses the web URL when counterpart has no socials", async () => {
    const card = makeCard({ opportunityId: "opp-9", viewerRole: "party", status: "pending" });
    const { mintConnectLink } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-9",
      counterpartUserId: "counterpart-9",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(card.profileUrl).toBe(`https://app.test/u/counterpart-9?link_preview=false`);
  });

  test("profileUrl is undefined when frontendUrl is missing", async () => {
    const card = makeCard({ opportunityId: "opp-10", viewerRole: "party", status: "pending" });
    const { mintConnectLink } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-10",
      counterpartUserId: "counterpart-10",
      mintConnectLink,
      frontendUrl: undefined,
    });
    expect("profileUrl" in card).toBe(false);
    expect(card.acceptUrl).toBe("https://api.test/c/AAAAAAAAAA");
    expect(card.feedCategory).toBe("connection");
  });

  test("mint error is swallowed; card has no acceptUrl/feedCategory but profileUrl is preserved", async () => {
    const card = makeCard({ opportunityId: "opp-11", viewerRole: "party", status: "pending" });
    const mintConnectLink = async (_args: { userId: string; opportunityId: string; kind: string; greeting?: string | null }) => {
      throw new Error("DB down");
    };
    await expect(
      attachActionableLinks(card, {
        viewerId: "user-11",
        counterpartUserId: "counterpart-11",
        mintConnectLink,
        frontendUrl: "https://app.test",
      }),
    ).resolves.toBeUndefined();
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-11?link_preview=false");
    expect(card.feedCategory).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// buildProfileUrl — edge cases
// ---------------------------------------------------------------------------

describe("buildProfileUrl — always the Index web profile (IND-289)", () => {
  test("returns the web profile URL when frontendUrl is set", () => {
    expect(
      buildProfileUrl("user-1", "https://app.test"),
    ).toBe("https://app.test/u/user-1?link_preview=false");
  });

  test("returns undefined when frontendUrl is missing", () => {
    expect(buildProfileUrl("user-5", undefined)).toBeUndefined();
  });

  test("strips trailing slash(es) from frontendUrl before concatenation", () => {
    expect(
      buildProfileUrl("user-6", "https://app.test/"),
    ).toBe("https://app.test/u/user-6?link_preview=false");
    expect(
      buildProfileUrl("user-6", "https://app.test///"),
    ).toBe("https://app.test/u/user-6?link_preview=false");
  });
});

describe("buildOpportunityPresentation — MCP opportunityId omission", () => {
  test("omits opportunityId line when card has an acceptUrl", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-actionable-1",
        name: "Alice",
        mainText: "Both work on protocol design.",
        status: "pending",
        acceptUrl: "https://api.test/c/Abc1234567",
        profileUrl: "https://app.test/u/opp-actionable-1-counterpart?link_preview=false",
        feedCategory: "connection",
      }],
      { isMcp: true, leadIn: "Found 1 connection." },
    );

    expect(out).not.toContain("opportunityId: opp-actionable-1");
    expect(out).not.toContain("digest-opportunity:id=opp-actionable-1");
    expect(out).toContain("acceptUrl: https://api.test/c/Abc1234567");
    expect(out).not.toContain("Use opportunityId values only when calling update_opportunity");
  });

  test("includes hidden digest marker for actionable cards only when requested", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-actionable-1",
        name: "Alice",
        mainText: "Both work on protocol design.",
        status: "pending",
        acceptUrl: "https://api.test/c/Abc1234567",
        profileUrl: "https://app.test/u/opp-actionable-1-counterpart?link_preview=false",
        feedCategory: "connection",
      }],
      { isMcp: true, leadIn: "Found 1 connection.", includeDigestMarkers: true },
    );

    expect(out).not.toContain("opportunityId: opp-actionable-1");
    expect(out).toContain("<!-- digest-opportunity:id=opp-actionable-1 -->");
    expect(out).toContain("acceptUrl: https://api.test/c/Abc1234567");
  });

  test("keeps opportunityId line when card has NO acceptUrl (draft sender etc.)", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-draft-sender-1",
        name: "Bob",
        mainText: "You can offer DevOps mentorship.",
        status: "draft",
      }],
      { isMcp: true, leadIn: "Found 1 draft." },
    );

    expect(out).toContain("opportunityId: opp-draft-sender-1");
    expect(out).toContain("Use opportunityId values only when calling update_opportunity");
  });

  test("strips unsupported claims from MCP card prose", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-unsafe",
        name: "Alice",
        mainText: "Alice attended the same event as you.",
        status: "pending",
      }],
      { isMcp: true, leadIn: "Found 1." },
    );

    expect(out).not.toContain("attended");
    expect(out).toContain("A suggested connection.");
  });

  test("mixed actionability: keeps id only for non-actionable cards, keeps instruction", () => {
    const out = buildOpportunityPresentation(
      [
        { opportunityId: "opp-actionable", name: "Alice", status: "pending", acceptUrl: "https://api.test/c/Abc1234567" },
        { opportunityId: "opp-draft-sender", name: "Bob", status: "draft" },
      ],
      { isMcp: true, leadIn: "Found 2." },
    );

    expect(out).not.toContain("opportunityId: opp-actionable");
    expect(out).toContain("opportunityId: opp-draft-sender");
    expect(out).toContain("Use opportunityId values only when calling update_opportunity");
  });
});


// ---------------------------------------------------------------------------
// deduplicateByPerson — per-person dedup in the selection layer
// ---------------------------------------------------------------------------

describe("deduplicateByPerson", () => {
  function makeOpp(id: string, counterpartId: string, viewerId: string, confidence?: number) {
    return {
      id,
      status: "pending",
      actors: [
        { userId: viewerId, role: "party" },
        { userId: counterpartId, role: "party" },
      ],
      interpretation: confidence != null ? { confidence } : null,
    };
  }

  const VIEWER = "viewer-1";

  it("keeps only the highest-confidence opportunity per counterpart", () => {
    const opps = [
      makeOpp("opp-low", "ashish", VIEWER, 0.6),
      makeOpp("opp-high", "ashish", VIEWER, 0.9),
      makeOpp("opp-mid", "ashish", VIEWER, 0.75),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-high");
  });

  it("passes through single-opportunity counterparts unchanged", () => {
    const opps = [
      makeOpp("opp-a", "alice", VIEWER, 0.8),
      makeOpp("opp-b", "bob", VIEWER, 0.7),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("opp-a");
    expect(result[1].id).toBe("opp-b");
  });

  it("deduplicates per person while preserving different counterparts", () => {
    const opps = [
      makeOpp("opp-a1", "ashish", VIEWER, 0.6),
      makeOpp("opp-m1", "maya", VIEWER, 0.8),
      makeOpp("opp-a2", "ashish", VIEWER, 0.9),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result.map((o) => o.id)).toEqual(["opp-m1", "opp-a2"]);
  });

  it("prefers the opportunity with a score over one without", () => {
    const opps = [
      makeOpp("opp-no-score", "ashish", VIEWER),       // interpretation: null
      makeOpp("opp-has-score", "ashish", VIEWER, 0.5),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-has-score");
  });

  it("on equal confidence, keeps the first encountered (stable)", () => {
    const opps = [
      makeOpp("opp-first", "ashish", VIEWER, 0.8),
      makeOpp("opp-second", "ashish", VIEWER, 0.8),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(1);
    expect(result[0].id).toBe("opp-first");
  });

  it("passes through opportunities with no derivable counterpart", () => {
    const oppNoCounterpart = {
      id: "opp-edge",
      status: "latent",
      actors: [
        { userId: VIEWER, role: "introducer" },
        { userId: "intro-target", role: "introducer" },
      ],
      interpretation: { confidence: 0.7 },
    };
    const opps = [oppNoCounterpart, makeOpp("opp-normal", "bob", VIEWER, 0.8)];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result).toHaveLength(2);
    expect(result[0].id).toBe("opp-edge");
    expect(result[1].id).toBe("opp-normal");
  });

  it("preserves original input order among winners", () => {
    const opps = [
      makeOpp("opp-c1", "charlie", VIEWER, 0.5),
      makeOpp("opp-a1", "ashish", VIEWER, 0.6),
      makeOpp("opp-b1", "bob", VIEWER, 0.7),
      makeOpp("opp-a2", "ashish", VIEWER, 0.9),
    ];
    const result = deduplicateByPerson(opps, VIEWER);
    expect(result.map((o) => o.id)).toEqual(["opp-c1", "opp-b1", "opp-a2"]);
  });
});
