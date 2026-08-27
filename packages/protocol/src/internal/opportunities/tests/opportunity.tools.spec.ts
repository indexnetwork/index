import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, test } from "bun:test";
import type { Opportunity } from "../../../platform/database.js";
import type { ToolDeps } from "../../shared/agent/tool.helpers.js";
import { buildMinimalOpportunityCard, createOpportunityTools } from "../opportunity.tools.js";
import { deduplicateByPerson } from "../opportunity.utils.js";

describe("opportunity tool registry", () => {
  it("does not register retired direct discovery tools", () => {
    const names: string[] = [];
    const defineTool = (definition: { name: string }) => {
      names.push(definition.name);
      return definition;
    };

    createOpportunityTools(defineTool as never, {} as ToolDeps);

    // The retired direct-discovery tools. Named here on purpose: this guard is
    // what stops them coming back.
    expect(names).not.toContain("discover_opportunities");
    expect(names).not.toContain("get_discovery_run");
    expect(names).not.toContain("cancel_discovery_run");
    expect(names).toContain("list_opportunities");
    expect(names).toContain("update_opportunity");
    expect(names).toContain("confirm_opportunity_delivery");
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
    ],
    detection: {
      source: "opportunity_graph",
    },
  } as unknown as Opportunity;

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

  it("uses a safe fallback for list cards when evaluator reasoning is unsafe", () => {
    const rawUuid = "123e4567-e89b-12d3-a456-426614174000";
    const unsafeOpportunity = {
      ...mockOpportunity,
      interpretation: {
        reasoning: `Lucy attended a private event with ${rawUuid}.`,
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

    expect(card.mainText).not.toContain("attended");
    expect(card.mainText).not.toContain(rawUuid);
    expect(card.mainText.length).toBeGreaterThan(0);
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

describe('buildMinimalOpportunityCard - primary action label (IND-161)', () => {
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

  it('uses "Start Chat" as primaryActionLabel for a party viewer', () => {
    const card = buildMinimalOpportunityCard(
      baseOpp, 'viewer-1', 'counterpart-user', 'Real User', null,
    );
    expect(card.primaryActionLabel).toBe('Start Chat');
  });

});

import { buildOpportunityPresentation, attachProfileLink, attachOpportunityAppLink, buildProfileUrl, buildOpportunityAppUrl } from "../opportunity.tools.js";

// ---------------------------------------------------------------------------
// attachProfileLink — profileUrl attachment (no actionable URLs are minted)
// ---------------------------------------------------------------------------

describe("attachProfileLink", () => {
  test("attaches the Index web profile URL when frontendUrl is set", () => {
    const card: Record<string, unknown> & { opportunityId: string } = {
      opportunityId: "opp-1",
      name: "Counterpart",
      status: "pending",
    };
    attachProfileLink(card, { counterpartUserId: "counterpart-1", frontendUrl: "https://app.test" });
    expect(card.profileUrl).toBe("https://app.test/u/counterpart-1?link_preview=false");
  });

  test("is a no-op when frontendUrl is missing", () => {
    const card: Record<string, unknown> & { opportunityId: string } = {
      opportunityId: "opp-2",
      name: "Counterpart",
      status: "draft",
    };
    attachProfileLink(card, { counterpartUserId: "counterpart-2", frontendUrl: undefined });
    expect("profileUrl" in card).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// attachOpportunityAppLink / buildOpportunityAppUrl — the opportunity deep link
// ---------------------------------------------------------------------------

describe("attachOpportunityAppLink", () => {
  test("attaches the universal opportunity link when frontendUrl is set", () => {
    const card: Record<string, unknown> & { opportunityId: string } = {
      opportunityId: "opp-1",
      name: "Counterpart",
      status: "pending",
    };
    attachOpportunityAppLink(card, { frontendUrl: "https://index.network" });
    expect(card.appUrl).toBe("https://index.network/o/opp-1");
  });

  test("is a no-op when frontendUrl is missing", () => {
    const card: Record<string, unknown> & { opportunityId: string } = {
      opportunityId: "opp-2",
      name: "Counterpart",
      status: "draft",
    };
    attachOpportunityAppLink(card, { frontendUrl: undefined });
    expect("appUrl" in card).toBe(false);
  });
});

describe("buildOpportunityAppUrl", () => {
  test("mints the bare /o/<id> universal link the Hermes plugin also mints", () => {
    expect(buildOpportunityAppUrl("opp-3", "https://index.network")).toBe(
      "https://index.network/o/opp-3",
    );
  });

  test("strips trailing slash(es) from frontendUrl before concatenation", () => {
    expect(buildOpportunityAppUrl("opp-4", "https://index.network/")).toBe(
      "https://index.network/o/opp-4",
    );
    expect(buildOpportunityAppUrl("opp-4", "https://index.network///")).toBe(
      "https://index.network/o/opp-4",
    );
  });

  test("returns undefined without a frontendUrl or an opportunity id", () => {
    expect(buildOpportunityAppUrl("opp-5", undefined)).toBeUndefined();
    expect(buildOpportunityAppUrl("", "https://index.network")).toBeUndefined();
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

describe("buildOpportunityPresentation — MCP prose rendering", () => {
  test("renders name/reasoning/status/profileUrl and always includes opportunityId", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-actionable-1",
        name: "Alice",
        mainText: "Both work on protocol design.",
        status: "pending",
        profileUrl: "https://app.test/u/opp-actionable-1-counterpart?link_preview=false",
        feedCategory: "connection",
      }],
      { isMcp: true, leadIn: "Found 1 connection." },
    );

    expect(out).toContain("opportunityId: opp-actionable-1");
    expect(out).not.toContain("digest-opportunity:id=opp-actionable-1");
    expect(out).toContain("profileUrl: https://app.test/u/opp-actionable-1-counterpart?link_preview=false");
    expect(out).toContain("Use opportunityId values only when calling update_opportunity");
  });

  test("includes hidden digest marker only when requested", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-actionable-1",
        name: "Alice",
        mainText: "Both work on protocol design.",
        status: "pending",
        profileUrl: "https://app.test/u/opp-actionable-1-counterpart?link_preview=false",
        feedCategory: "connection",
      }],
      { isMcp: true, leadIn: "Found 1 connection.", includeDigestMarkers: true },
    );

    expect(out).toContain("<!-- digest-opportunity:id=opp-actionable-1 -->");
    expect(out).toContain("opportunityId: opp-actionable-1");
  });

  test("points accept guidance at the Index app and forbids fabricated accept URLs", () => {
    const out = buildOpportunityPresentation(
      [{
        opportunityId: "opp-draft-sender-1",
        name: "Bob",
        mainText: "You can offer DevOps mentorship.",
        status: "draft",
      }],
      { isMcp: true, leadIn: "Found 1 draft." },
    );

    expect(out).toContain("Index app");
    expect(out).toContain("never invent an accept URL");
  });

  test("weaves an attached appUrl into the MCP prose and tells the agent to show it", () => {
    const card: Record<string, unknown> & { opportunityId: string } = {
      opportunityId: "opp-deep-link-1",
      name: "Alice",
      mainText: "Both work on protocol design.",
      status: "pending",
    };
    attachOpportunityAppLink(card, { frontendUrl: "https://index.network" });

    const out = buildOpportunityPresentation([card], {
      isMcp: true,
      leadIn: "Found 1 connection.",
    });

    expect(out).toContain("appUrl: https://index.network/o/opp-deep-link-1");
    expect(out).toContain("For each card that has an appUrl");
    expect(out).toContain("never assemble one from an opportunityId");
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

  test("includes opportunityId for every card and keeps the tool-call instruction", () => {
    const out = buildOpportunityPresentation(
      [
        { opportunityId: "opp-actionable", name: "Alice", status: "pending" },
        { opportunityId: "opp-draft-sender", name: "Bob", status: "draft" },
      ],
      { isMcp: true, leadIn: "Found 2." },
    );

    expect(out).toContain("opportunityId: opp-actionable");
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
      status: "negotiating",
      actors: [
        { userId: VIEWER, role: "party" },
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
