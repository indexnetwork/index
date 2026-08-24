/**
 * Tests for the opportunity presentation cluster.
 *
 * Merged alongside the source: the transforms, the cache keys, the
 * safe-fallback pipeline and the presenter are one module, so their specs are
 * one file with a section per concern.
 */

import { config } from "dotenv";
config({ path: '.env.test', override: true });
import { describe, expect, it, mock, test } from 'bun:test';
import { DEFAULT_EMPTY_FALLBACK_TEXT, DEFAULT_FALLBACK_ACTION, DEFAULT_FALLBACK_HEADLINE, OPPORTUNITY_PRESENTATION_CACHE_VERSION, OpportunityPresenter, presentOpportunity, SAFE_FALLBACK_MAX_CHARS, truncateAtBoundary, buildApiChatCardPresentationCacheKey, buildDeliveryCardPresentationCacheKey, buildRadarCardPresentationCacheKey, getSafePresentationOrSkip, safeFallbackSummary, summarizeSignalsForPresenter, type CardPresenterInput } from "../opportunity.presentation.js";
import type { Opportunity } from '../../../platform/database.js';
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import type { NegotiationContext } from "../negotiation-context.loader.js";

// ──────────────────────────────────────────────────────────────────────
// presentation
// ──────────────────────────────────────────────────────────────────────

/** Config */


describe('presentOpportunity', () => {
  const baseOpp: Opportunity = {
    id: 'opp-1',
    detection: { source: 'manual', timestamp: new Date().toISOString() },
    actors: [
      { networkId: 'idx-1', userId: 'alice', role: 'agent' },
      { networkId: 'idx-1', userId: 'bob', role: 'patient' },
    ],
    interpretation: {
      category: 'collaboration',
      reasoning: 'The source user (Alice) has deep React expertise while the candidate (Bob) is building a frontend-heavy product, making this a strong technical collaboration opportunity.',
      confidence: 0.85,
    },
    context: { networkId: 'idx-1' },
    confidence: '0.85',
    status: 'pending',
    createdAt: new Date(),
    updatedAt: new Date(),
    expiresAt: null,
  };

  test('agent role: title and description for viewer as agent', () => {
    const result = presentOpportunity(
      baseOpp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('You can help Bob');
    expect(result.description).toContain('Bob might benefit from connecting with you');
    expect(result.callToAction).toBe('View Opportunity');
  });

  test('patient role: title and description for viewer as patient', () => {
    const result = presentOpportunity(
      baseOpp,
      'bob',
      { id: 'alice', name: 'Alice', avatar: null },
      null,
      'card'
    );
    expect(result.title).toBe('Alice might be able to help you');
    expect(result.description).toContain("Alice has skills that align");
  });

  test('does not append unsupported raw reasoning claims', () => {
    const unsafe: Opportunity = {
      ...baseOpp,
      interpretation: {
        ...baseOpp.interpretation,
        reasoning: 'Alice and Bob attended the same event.',
      },
    };
    const result = presentOpportunity(
      unsafe,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'card',
    );
    expect(result.description).not.toContain('attended');
    expect(result.description).toContain('A promising connection.');
  });

  test('throws when viewer is not an actor', () => {
    expect(() =>
      presentOpportunity(
        baseOpp,
        'charlie',
        { id: 'alice', name: 'Alice', avatar: null },
        null,
        'card'
      )
    ).toThrow('Viewer is not an actor in this opportunity');
  });

  test('notification format truncates long description', () => {
    const longSummary = 'A'.repeat(150);
    const opp: Opportunity = {
      ...baseOpp,
      interpretation: { ...baseOpp.interpretation, reasoning: longSummary },
    };
    const result = presentOpportunity(
      opp,
      'alice',
      { id: 'bob', name: 'Bob', avatar: null },
      null,
      'notification'
    );
    expect(result.description.length).toBeLessThanOrEqual(100);
    if (result.description.length >= 100) {
      expect(result.description.slice(-3)).toBe('...');
    }
  });
});

describe('truncateAtBoundary', () => {
  test('returns text unchanged when within the limit', () => {
    const text = 'Short and sweet.';
    expect(truncateAtBoundary(text, 300)).toBe(text);
  });

  test('never cuts mid-word', () => {
    const text =
      "Eric is a computational neuroscientist with a background in engineering and explicitly develops systems for humans to better understand and interact with AI. His focus on individual cognition makes this a strong match.";
    const out = truncateAtBoundary(text, 120);
    expect(out.length).toBeLessThanOrEqual(120);
    // The last token must be a complete word from the source, not a fragment.
    const lastWord = out.replace(/[\u2026.!?]+$/, '').trim().split(/\s+/).pop() ?? '';
    expect(text).toContain(lastWord);
  });

  test('prefers a sentence boundary when one is available', () => {
    const text =
      'You both work on developer tooling. They are hiring a founding engineer right now and could use your distributed-systems background.';
    const out = truncateAtBoundary(text, 60);
    expect(out).toBe('You both work on developer tooling.');
  });

  test('falls back to a word boundary with an ellipsis', () => {
    const text =
      'Acomplicatedrunonphrasewithoutanyearlysentencebreak that keeps going well past the limit and onward';
    const out = truncateAtBoundary(text, 40);
    expect(out.length).toBeLessThanOrEqual(41); // body + ellipsis char
    expect(out.endsWith('\u2026')).toBe(true);
  });
});

// ──────────────────────────────────────────────────────────────────────
// presentation-cache
// ──────────────────────────────────────────────────────────────────────

describe("opportunity presentation cache namespace", () => {
  it("versions every presentation key family with v2", () => {
    expect(OPPORTUNITY_PRESENTATION_CACHE_VERSION).toBe("v2");
    expect(buildRadarCardPresentationCacheKey("opp", "pending", "viewer"))
      .toBe("radar:v2:card:opp:pending:viewer");
    expect(buildDeliveryCardPresentationCacheKey("opp", "pending", "viewer"))
      .toBe("delivery:v2:card:opp:pending:viewer");
    expect(buildApiChatCardPresentationCacheKey("opp", "viewer"))
      .toBe("chat:v2:card:opp:viewer");
  });
});

// ──────────────────────────────────────────────────────────────────────
// safe-presentation
// ──────────────────────────────────────────────────────────────────────

const UUID = "123e4567-e89b-12d3-a456-426614174000";

describe("safeFallbackSummary", () => {
  it("strips UUIDs from raw reasoning", () => {
    const out = safeFallbackSummary(
      `Alex Chen (${UUID}) is building AI tooling that matches your interests.`,
    );
    expect(out).not.toContain(UUID);
    expect(out).toContain("Alex Chen");
  });

  it("returns emptyText for empty/null/whitespace reasoning", () => {
    expect(safeFallbackSummary(null)).toBe(DEFAULT_EMPTY_FALLBACK_TEXT);
    expect(safeFallbackSummary(undefined)).toBe(DEFAULT_EMPTY_FALLBACK_TEXT);
    expect(safeFallbackSummary("   \n  ")).toBe(DEFAULT_EMPTY_FALLBACK_TEXT);
    expect(safeFallbackSummary("", { emptyText: "Custom copy." })).toBe(
      "Custom copy.",
    );
  });

  it("normalizes whitespace", () => {
    const out = safeFallbackSummary("Line one.\n\nLine   two\ttabbed.");
    expect(out).toBe("Line one. Line two tabbed.");
  });

  it("truncates at a boundary without cutting mid-word", () => {
    const long = "word ".repeat(200).trim() + ".";
    const out = safeFallbackSummary(long, { maxChars: 100 });
    expect(out.length).toBeLessThanOrEqual(101); // + ellipsis char
    expect(out.endsWith("\u2026") || out.endsWith(".")).toBe(true);
    expect(out).not.toMatch(/wor\u2026$/); // never mid-word
  });

  it("defaults to SAFE_FALLBACK_MAX_CHARS", () => {
    const long = "sentence about a match. ".repeat(50);
    const out = safeFallbackSummary(long);
    expect(out.length).toBeLessThanOrEqual(SAFE_FALLBACK_MAX_CHARS + 1);
  });

  it("rewrites viewer-centric: prefers sentences describing the counterpart", () => {
    const out = safeFallbackSummary(
      "Sam Viewer is a designer seeking collaborators. Alex Chen builds open-source agent tooling and wants design help.",
      { counterpartName: "Alex Chen", viewerName: "Sam Viewer" },
    );
    expect(out.startsWith("Alex Chen")).toBe(true);
  });

  it("strips introducer mentions when introducerName is provided", () => {
    const out = safeFallbackSummary(
      "Maya Introducer introduced you to Alex Chen, who builds agent tooling.",
      { counterpartName: "Alex Chen", introducerName: "Maya Introducer" },
    );
    expect(out).not.toContain("Maya");
  });

  it("removes unsafe claims while retaining safe sentences", () => {
    const out = safeFallbackSummary(
      "Alex Chen builds agent tooling. You both attended the same session. Alex is looking for design feedback.",
      { counterpartName: "Alex Chen" },
    );
    expect(out).toContain("Alex Chen builds agent tooling.");
    expect(out).toContain("Alex is looking for design feedback.");
    expect(out).not.toContain("attended");
  });

  it("uses deterministic empty copy when all reasoning is unsafe", () => {
    expect(
      safeFallbackSummary("Alice and Bob attended the same event."),
    ).toBe(DEFAULT_EMPTY_FALLBACK_TEXT);
  });
});

describe("getSafePresentationOrSkip", () => {
  const genuine = {
    headline: "A React expert who needs your design skills",
    personalizedSummary: "You both care about design systems.",
    suggestedAction: "Send a message.",
  };

  it("returns genuine presenter output untouched, isFallback false", () => {
    const res = getSafePresentationOrSkip({ homeCardPresentation: genuine });
    expect(res).toEqual({
      headline: genuine.headline,
      summary: genuine.personalizedSummary,
      suggestedAction: genuine.suggestedAction,
      isFallback: false,
    });
  });

  it("treats presenter output tagged isFallback as fallback (the silent-fallback pitfall)", () => {
    const res = getSafePresentationOrSkip({
      homeCardPresentation: { ...genuine, isFallback: true },
      matchReason: `Raw reasoning with ${UUID} inside.`,
    });
    expect(res?.isFallback).toBe(true);
    expect(res?.summary).not.toContain(UUID);
  });

  it("skips (returns null) when allowFallback is false and no genuine output exists", () => {
    expect(
      getSafePresentationOrSkip(
        { matchReason: "raw" },
        { allowFallback: false },
      ),
    ).toBeNull();
    expect(
      getSafePresentationOrSkip(
        { homeCardPresentation: { ...genuine, isFallback: true } },
        { allowFallback: false },
      ),
    ).toBeNull();
  });

  it("still returns genuine output when allowFallback is false", () => {
    const res = getSafePresentationOrSkip(
      { homeCardPresentation: genuine },
      { allowFallback: false },
    );
    expect(res?.isFallback).toBe(false);
  });

  it("builds sanitized fallback from matchReason, then interpretation.reasoning", () => {
    const fromMatchReason = getSafePresentationOrSkip({
      matchReason: `Match reason with ${UUID}.`,
      interpretation: { reasoning: "interp reasoning" },
    });
    expect(fromMatchReason?.summary).toContain("Match reason");
    expect(fromMatchReason?.summary).not.toContain(UUID);

    const fromInterp = getSafePresentationOrSkip({
      interpretation: { reasoning: `Interp reasoning with ${UUID}.` },
    });
    expect(fromInterp?.summary).toContain("Interp reasoning");
    expect(fromInterp?.summary).not.toContain(UUID);
  });

  it("uses default headline/action and empty-text default when nothing is available", () => {
    const res = getSafePresentationOrSkip({});
    expect(res).toEqual({
      headline: DEFAULT_FALLBACK_HEADLINE,
      summary: DEFAULT_EMPTY_FALLBACK_TEXT,
      suggestedAction: DEFAULT_FALLBACK_ACTION,
      isFallback: true,
    });
  });

  it("ignores empty/blank presenter summaries", () => {
    const res = getSafePresentationOrSkip({
      homeCardPresentation: { ...genuine, personalizedSummary: "  " },
      matchReason: "Fallback source text.",
    });
    expect(res?.isFallback).toBe(true);
    expect(res?.summary).toContain("Fallback source text");
  });

  it("validates genuine presenter fields before returning them", () => {
    const res = getSafePresentationOrSkip({
      homeCardPresentation: {
        headline: "Both attended the same event.",
        personalizedSummary:
          "You both attended the same event. Alex builds privacy tools.",
        suggestedAction: "Message this fellow member of the network.",
      },
    });
    expect(res).toEqual({
      headline: DEFAULT_FALLBACK_HEADLINE,
      summary: "Alex builds privacy tools.",
      suggestedAction: DEFAULT_FALLBACK_ACTION,
      isFallback: false,
    });
  });

  it("fails closed when a genuine presenter summary is fully unsafe", () => {
    const res = getSafePresentationOrSkip({
      homeCardPresentation: {
        ...genuine,
        personalizedSummary: "You both attended the same session.",
      },
      matchReason: "They are fellow members of the event network.",
    });
    expect(res?.isFallback).toBe(true);
    expect(res?.summary).toBe(DEFAULT_EMPTY_FALLBACK_TEXT);
  });
});

// ──────────────────────────────────────────────────────────────────────
// presenter
// ──────────────────────────────────────────────────────────────────────

/** Test-only type to override the private invokeWithTimeout method via index access. */
type PresenterWithInvokeOverride = {
  invokeWithTimeout: (...args: unknown[]) => unknown;
};

describe("summarizeSignalsForPresenter", () => {
  it("excludes pool-discriminator disposition from LLM context", () => {
    expect(summarizeSignalsForPresenter([
      { type: "semantic_match", weight: 0.8, detail: "Complementary goals" },
      { type: "pool_discriminator", weight: -1, detail: "Builders vs advisors: Builders" },
    ])).toBe("semantic_match: Complementary goals");
    expect(summarizeSignalsForPresenter([
      { type: "pool_discriminator", weight: -1, detail: "Builders vs advisors: Builders" },
    ])).toBe("Match based on profile and intent alignment.");
  });
});

// ---------------------------------------------------------------------------
// Zero mutual intents – fallback path (no LLM needed)
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – zero mutual intents label", () => {
  let presenter: OpportunityPresenter;

  const baseInput: CardPresenterInput = {
    viewerContext: "Name: Alice\nBio: Engineer",
    otherPartyContext: "Name: Bob\nBio: Designer",
    matchReasoning: "Both interested in AI tooling and design systems.",
    category: "collaboration",
    confidence: 0.8,
    signalsSummary: "Complementary skills",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
  };

  // Patch the presenter to always hit the fallback path
  function createFallbackPresenter(): OpportunityPresenter {
    const p = new OpportunityPresenter() as unknown as PresenterWithInvokeOverride;
    // Force the LLM call to throw, triggering the catch/fallback branch
    p.invokeWithTimeout = mock(() => {
      throw new Error("Forced fallback for testing");
    });
    return p as unknown as OpportunityPresenter;
  }

  it("should return 'Shared interests' when mutualIntentCount is 0", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({ ...baseInput, mutualIntentCount: 0 });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is undefined", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({ ...baseInput, mutualIntentCount: undefined });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is null", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({ ...baseInput, mutualIntentCount: null as unknown as number });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return numeric label when mutualIntentCount > 0", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({ ...baseInput, mutualIntentCount: 3 });
    expect(result.mutualIntentsLabel).toBe("3 mutual intents");
  });

  it("should return singular label when mutualIntentCount is 1", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({ ...baseInput, mutualIntentCount: 1 });
    expect(result.mutualIntentsLabel).toBe("1 mutual intent");
  });

  it("should return 'Connector match' for introducer role regardless of count", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentCard({
      ...baseInput,
      viewerRole: "introducer",
      isIntroduction: true,
      introducerName: "Carol",
      mutualIntentCount: 0,
    });
    expect(result.mutualIntentsLabel).toBe("Connector match");
  });
});

// ---------------------------------------------------------------------------
// Regex safety net – exercises presentCard() with mocked LLM success path
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – sanitizer rewrites zero-count LLM output", () => {
  const baseInput: CardPresenterInput = {
    viewerContext: "Name: Alice\nBio: Engineer",
    otherPartyContext: "Name: Bob\nBio: Designer",
    matchReasoning: "Both interested in AI tooling and design systems.",
    category: "collaboration",
    confidence: 0.8,
    signalsSummary: "Complementary skills",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
  };

  function createLlmMockPresenter(mutualIntentsLabel: string): OpportunityPresenter {
    const p = new OpportunityPresenter() as unknown as PresenterWithInvokeOverride;
    p.invokeWithTimeout = mock(() => ({
      presentation: {
        headline: "A great match",
        personalizedSummary: "You both care about design systems.",
        digestSummary: "You might like meeting Bob because you both care about design systems.",
        suggestedAction: "Reach out to Bob.",
        narratorRemark: "Worth a look.",
        greeting: "Saw we both care about design systems and would love to compare notes.",
        primaryActionLabel: "Start Chat",
        secondaryActionLabel: "Skip",
        mutualIntentsLabel,
      },
    }));
    return p as unknown as OpportunityPresenter;
  }

  it("should rewrite '0 mutual intents' to 'Shared interests'", async () => {
    const presenter = createLlmMockPresenter("0 mutual intents");
    const result = await presenter.presentCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should rewrite '0 overlapping intents' to 'Shared interests'", async () => {
    const presenter = createLlmMockPresenter("0 overlapping intents");
    const result = await presenter.presentCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should NOT rewrite '3 mutual intents'", async () => {
    const presenter = createLlmMockPresenter("3 mutual intents");
    const result = await presenter.presentCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("3 mutual intents");
  });

  it("should NOT rewrite 'Shared interests'", async () => {
    const presenter = createLlmMockPresenter("Shared interests");
    const result = await presenter.presentCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });
});

describe("OpportunityPresenter - claim post-validation", () => {
  const baseInput: CardPresenterInput = {
    viewerContext: "Name: Alice",
    otherPartyContext: "Name: Bob",
    matchReasoning: "Alice and Bob attended the same event.",
    category: "collaboration",
    confidence: 0.8,
    signalsSummary: "profile alignment",
    indexName: "Event network",
    viewerRole: "party",
    opportunityStatus: "pending",
  };

  it("sanitizes every prose field from present() and marks deterministic fallback", async () => {
    const presenter = new OpportunityPresenter() as unknown as PresenterWithInvokeOverride;
    presenter.invokeWithTimeout = mock(() => ({
      presentation: {
        headline: "A fellow member of the event",
        personalizedSummary: "You both attended the same session.",
        suggestedAction: "Message this resident of Berlin.",
        greeting: "Great to meet another attendee from the same event.",
      },
    }));

    const result = await (presenter as unknown as OpportunityPresenter).present(baseInput);
    expect(result.headline).toBe("A promising connection");
    expect(result.personalizedSummary).toBe("A promising connection.");
    expect(result.suggestedAction).toBe("Take a look and decide whether to reach out.");
    expect(result.greeting).toBe("");
    expect(result.isFallback).toBe(true);
  });

  it("sanitizes every card prose field before returning", async () => {
    const presenter = new OpportunityPresenter() as unknown as PresenterWithInvokeOverride;
    presenter.invokeWithTimeout = mock(() => ({
      presentation: {
        headline: "Bob attended the event",
        personalizedSummary: "You both attended the same session. Bob builds privacy tools.",
        digestSummary: "You are fellow members of the event network.",
        suggestedAction: "Message this resident of Berlin.",
        narratorRemark: "Co-attendees with shared interests.",
        mutualIntentsLabel: "Fellow members of the network",
        greeting: "Great to meet another attendee.",
      },
    }));

    const result = await (presenter as unknown as OpportunityPresenter).presentCard(baseInput);
    expect(result.headline).toBe("A promising connection");
    expect(result.personalizedSummary).toBe("Bob builds privacy tools.");
    expect(result.digestSummary).toBe("You might like meeting them based on your current interests.");
    expect(result.suggestedAction).toBe("Take a look and decide whether to reach out.");
    expect(result.narratorRemark).toBe("Worth a look.");
    expect(result.mutualIntentsLabel).toBe("Shared interests");
    expect(result.greeting).toBe("");
    expect(result.isFallback).toBe(true);
  });
});

describe("OpportunityPresenter - IND-113: Introducer should not appear in body text", () => {
  const presenter = new OpportunityPresenter();

  const createIntroducerInput = (
    introducerName: string,
    counterpartName: string,
  ): CardPresenterInput => ({
    viewerContext: `Name: Test Viewer\nBio: UX designer with AI expertise\nActive intents:\n- Looking for collaboration opportunities`,
    otherPartyContext: `Name: ${counterpartName}\nBio: Building a marketplace startup\nSkills: product management, operations`,
    matchReasoning: `${introducerName} introduced you to ${counterpartName}, who is actively seeking a product co-founder for a niche APAC marketplace. Both parties have complementary skills in design and product development.`,
    category: "collaboration",
    confidence: 0.85,
    signalsSummary: "Complementary skills in design and product",
    indexName: "Test Index",
    viewerRole: "party",
    opportunityStatus: "pending",
    isIntroduction: true,
    introducerName,
    mutualIntentCount: 1,
  });

  it("should NOT include introducer name in personalizedSummary for introduction opportunities", async () => {
    const input = createIntroducerInput("Seref Yarar", "Lucy Chen");

    const result = await presenter.presentCard(input);

    // Body text should NOT contain introducer
    expect(result.personalizedSummary).not.toContain("Seref");
    expect(result.personalizedSummary).not.toContain("Yarar");
    expect(result.personalizedSummary).not.toContain("introduced you");

    // Body text SHOULD contain counterpart
    expect(result.personalizedSummary).toContain("Lucy");

    // Narrator remark: non-empty string, within display length (e.g. ≤80)
    expect(typeof result.narratorRemark).toBe("string");
    expect(result.narratorRemark.length).toBeGreaterThan(0);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);

    // Print output for manual review
    console.log("Headline:", result.headline);
    console.log("Summary:", result.personalizedSummary);
    console.log("NarratorRemark:", result.narratorRemark);
  }, 30000); // 30s timeout for LLM

  it("should include counterpart name in personalizedSummary", async () => {
    const input = createIntroducerInput("Bob Smith", "Alice Johnson");

    const result = await presenter.presentCard(input);

    expect(result.personalizedSummary).toContain("Alice");
    expect(result.personalizedSummary.length).toBeGreaterThan(50);
  }, 30000);

  it("should set appropriate narratorRemark for introduction", async () => {
    const input = createIntroducerInput("Jane Doe", "Mark Wilson");

    const result = await presenter.presentCard(input);

    expect(typeof result.narratorRemark).toBe("string");
    expect(result.narratorRemark.length).toBeGreaterThan(0);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);
  }, 30000);
});

// ──────────────────────────────────────────────────────────────────────
// presenter.negotiation
// ──────────────────────────────────────────────────────────────────────

type PresenterWithInvokeOverride = {
  invokeWithTimeout: (...args: unknown[]) => unknown;
};

const BASE_INPUT: CardPresenterInput = {
  viewerContext: "Name: Alice\nBio: Engineer",
  otherPartyContext: "Name: Bob\nBio: Designer",
  matchReasoning: "Both interested in AI tooling and design systems.",
  category: "collaboration",
  confidence: 0.8,
  signalsSummary: "Complementary skills",
  indexName: "Test Index",
  viewerRole: "peer",
  opportunityStatus: "pending",
};

function makeNegotiatingContext(turnCount: number, turnCap: number): NegotiationContext {
  return { status: "negotiating", conversationId: "conversation-test", turnCount, turnCap };
}

function makeCompletedContext(
  status: NegotiationContext["status"],
  opts: { pauseReason?: "counterparty_silent" | "needs_principal" | "ready_for_verdict"; turnCount?: number } = {},
): NegotiationContext {
  return {
    status,
    conversationId: "conversation-test",
    turnCount: opts.turnCount ?? 2,
    turnCap: 6,
    ...(opts.pauseReason ? { pause: { reason: opts.pauseReason } } : {}),
    turns: [
      {
        verb: "outreach",
        reasoning: "Start the conversation with the React opening.",
        message: "Opening pitch",
      },
      {
        verb: "counter",
        reasoning: "Push back because roles align on design systems.",
        message: "Closing note",
      },
    ],
  };
}

/** Captures the (system, human) messages the presenter would pass to the LLM. */
function capturingPresenter(fakeLLMResult?: unknown): {
  presenter: OpportunityPresenter;
  getLastHumanContent: () => string | undefined;
  getCallCount: () => number;
} {
  let lastHuman: string | undefined;
  let calls = 0;
  const presenter = new OpportunityPresenter();
  const overridable = presenter as unknown as PresenterWithInvokeOverride;
  overridable.invokeWithTimeout = mock(async (..._args: unknown[]) => {
    calls += 1;
    const messages = _args[1] as (SystemMessage | HumanMessage)[];
    const human = messages.find((m): m is HumanMessage => m instanceof HumanMessage);
    lastHuman = human?.content as string | undefined;
    // Return a valid parsed shape so downstream code doesn't throw.
    return (
      fakeLLMResult ?? {
        presentation: {
          headline: "Match",
          personalizedSummary: "You would both get value.",
          digestSummary: "You might like meeting Bob because you would both get value.",
          suggestedAction: "Reach out.",
          narratorRemark: "Worth a look.",
          greeting: "Saw we may both get value from connecting and would love to compare notes.",
          mutualIntentsLabel: "Shared interests",
        },
      }
    );
  });
  return {
    presenter,
    getLastHumanContent: () => lastHuman,
    getCallCount: () => calls,
  };
}

describe("OpportunityPresenter – negotiation branch", () => {
  it("returns templated chip without invoking the LLM for status `negotiating`", async () => {
    const { presenter, getCallCount } = capturingPresenter();

    const result = await presenter.presentCard({
      ...BASE_INPUT,
      opportunityStatus: "negotiating",
      negotiationContext: makeNegotiatingContext(3, 8),
    });

    expect(getCallCount()).toBe(0);
    expect(result.narratorRemark).toBe("Currently negotiating · turn 3 of 8");
    expect(result.headline).toBe("Negotiation in progress");
  });

  it("drops the `of N` when turnCap is 0 (unlimited)", async () => {
    const { presenter } = capturingPresenter();
    const result = await presenter.presentCard({
      ...BASE_INPUT,
      opportunityStatus: "negotiating",
      negotiationContext: makeNegotiatingContext(1, 0),
    });
    expect(result.narratorRemark).toBe("Currently negotiating · turn 1");
  });

  it("injects NEGOTIATION CONTEXT block into the prompt for `pending`", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentCard({
      ...BASE_INPUT,
      opportunityStatus: "pending",
      negotiationContext: makeCompletedContext("pending"),
    });

    const human = getLastHumanContent();
    expect(human).toBeDefined();
    expect(human!).toContain("NEGOTIATION CONTEXT:");
    expect(human!).toContain("Negotiation status: pending");
    expect(human!).toContain("Turns exchanged: 2 of 6");
    expect(human!).toContain("Turn 1 (outreach):");
  });

  it("includes `counterpart went silent` phrasing for a counterparty_silent pause", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentCard({
      ...BASE_INPUT,
      opportunityStatus: "stalled",
      negotiationContext: makeCompletedContext("stalled", { pauseReason: "counterparty_silent", turnCount: 6 }),
    });

    const human = getLastHumanContent();
    expect(human!).toContain("counterpart went silent before responding");
  });

  it("does NOT include NEGOTIATION CONTEXT block when negotiationContext is absent", async () => {
    const { presenter, getLastHumanContent } = capturingPresenter();

    await presenter.presentCard({
      ...BASE_INPUT,
      opportunityStatus: "pending",
    });

    const human = getLastHumanContent();
    expect(human!).not.toContain("NEGOTIATION CONTEXT:");
  });
});
