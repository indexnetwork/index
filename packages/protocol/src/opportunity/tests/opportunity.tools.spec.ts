import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it, test } from "bun:test";
import type { Opportunity } from "../../shared/interfaces/database.interface.js";
import { buildMinimalOpportunityCard } from "../opportunity.tools.js";

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

  test("pending + non-introducer → connect", () => {
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "party" })).toBe("connect");
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "patient" })).toBe("connect");
    expect(resolveActionableLinkKind({ status: "pending", viewerRole: "agent" })).toBe("connect");
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

  test("draft + non-introducer → null (sender needs update_opportunity)", () => {
    expect(resolveActionableLinkKind({ status: "draft", viewerRole: "party" })).toBeNull();
    expect(resolveActionableLinkKind({ status: "draft", viewerRole: "agent" })).toBeNull();
  });

  test("terminal / unknown statuses → null", () => {
    expect(resolveActionableLinkKind({ status: "rejected", viewerRole: "party" })).toBeNull();
    expect(resolveActionableLinkKind({ status: "expired", viewerRole: "introducer", viewerApproved: false })).toBeNull();
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

  test("latent + non-introducer → null (chat surface filters this case out anyway)", () => {
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "party" })).toBeNull();
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "agent" })).toBeNull();
    expect(resolveActionableLinkKind({ status: "latent", viewerRole: "patient" })).toBeNull();
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
      counterpartUser: { socials: [{ label: "telegram", value: "alice" }] },
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
      counterpartUser: null,
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
      counterpartUser: null,
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
      counterpartUser: null,
      counterpartUserId: "counterpart-4",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-4?link_preview=false");
    expect(card.feedCategory).toBeUndefined();
  });

  test("draft + party (sender) → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-5", viewerRole: "party", status: "draft" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-5",
      counterpartUser: null,
      counterpartUserId: "counterpart-5",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-5?link_preview=false");
    expect(card.feedCategory).toBeUndefined();
  });

  test("pending + introducer → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-6", viewerRole: "introducer", status: "pending" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-6",
      counterpartUser: null,
      counterpartUserId: "counterpart-6",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(calls.length).toBe(0);
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-6?link_preview=false");
  });

  test("accepted + introducer → no mint, profileUrl still attached", async () => {
    const card = makeCard({ opportunityId: "opp-7", viewerRole: "introducer", status: "accepted" });
    const { mintConnectLink, calls } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-7",
      counterpartUser: null,
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
      counterpartUser: null,
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
      counterpartUser: { socials: [] },
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
      counterpartUser: { socials: [] },
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
        counterpartUser: null,
        counterpartUserId: "counterpart-11",
        mintConnectLink,
        frontendUrl: "https://app.test",
      }),
    ).resolves.toBeUndefined();
    expect(card.acceptUrl).toBeUndefined();
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-11?link_preview=false");
    expect(card.feedCategory).toBeUndefined();
  });

  test("profileUrl ignores Telegram socials and always points at the Index web profile (IND-289)", async () => {
    const card = makeCard({ opportunityId: "opp-12", viewerRole: "party", status: "pending" });
    const { mintConnectLink } = makeMintSpy();
    await attachActionableLinks(card, {
      viewerId: "user-12",
      counterpartUser: { socials: [{ label: "telegram", value: "@bobby" }] },
      counterpartUserId: "counterpart-12",
      mintConnectLink,
      frontendUrl: "https://app.test",
    });
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-12?link_preview=false");
  });
});

// ---------------------------------------------------------------------------
// buildProfileUrl — edge cases
// ---------------------------------------------------------------------------

describe("buildProfileUrl — always the Index web URL (IND-289)", () => {
  test("returns the web profile URL when frontendUrl is set", () => {
    expect(
      buildProfileUrl({ socials: [] }, "user-1", "https://app.test"),
    ).toBe("https://app.test/u/user-1?link_preview=false");
  });

  test("ignores Telegram socials — always uses the web URL", () => {
    expect(
      buildProfileUrl(
        { socials: [{ label: "telegram", value: "alice" }] },
        "user-2",
        "https://app.test",
      ),
    ).toBe("https://app.test/u/user-2?link_preview=false");
  });

  test("socials is null → still returns the web URL", () => {
    expect(
      buildProfileUrl({ socials: null }, "user-3", "https://app.test"),
    ).toBe("https://app.test/u/user-3?link_preview=false");
  });

  test("counterpartUser itself is null → still returns the web URL", () => {
    expect(
      buildProfileUrl(null, "user-4", "https://app.test"),
    ).toBe("https://app.test/u/user-4?link_preview=false");
  });

  test("returns undefined when frontendUrl is missing", () => {
    expect(buildProfileUrl({ socials: [] }, "user-5", undefined)).toBeUndefined();
  });

  test("strips trailing slash(es) from frontendUrl before concatenation", () => {
    expect(
      buildProfileUrl(null, "user-6", "https://app.test/"),
    ).toBe("https://app.test/u/user-6?link_preview=false");
    expect(
      buildProfileUrl(null, "user-6", "https://app.test///"),
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
    expect(out).toContain("acceptUrl: https://api.test/c/Abc1234567");
    expect(out).not.toContain("Use opportunityId values only when calling update_opportunity");
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
