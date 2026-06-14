import { config } from "dotenv";
config({ path: ".env.test", override: true });

import { describe, expect, it, mock } from "bun:test";
import { OpportunityPresenter, type HomeCardPresenterInput } from "../opportunity.presenter.js";

/** Test-only type to override the private invokeWithTimeout method via index access. */
type PresenterWithInvokeOverride = {
  invokeWithTimeout: (...args: unknown[]) => unknown;
};

// ---------------------------------------------------------------------------
// Zero mutual intents – fallback path (no LLM needed)
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – zero mutual intents label", () => {
  let presenter: OpportunityPresenter;

  const baseInput: HomeCardPresenterInput = {
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
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 0 });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is undefined", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: undefined });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return 'Shared interests' when mutualIntentCount is null", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: null as unknown as number });
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should return numeric label when mutualIntentCount > 0", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 3 });
    expect(result.mutualIntentsLabel).toBe("3 mutual intents");
  });

  it("should return singular label when mutualIntentCount is 1", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({ ...baseInput, mutualIntentCount: 1 });
    expect(result.mutualIntentsLabel).toBe("1 mutual intent");
  });

  it("should return 'Connector match' for introducer role regardless of count", async () => {
    presenter = createFallbackPresenter();
    const result = await presenter.presentHomeCard({
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
// Regex safety net – exercises presentHomeCard() with mocked LLM success path
// ---------------------------------------------------------------------------

describe("OpportunityPresenter – sanitizer rewrites zero-count LLM output", () => {
  const baseInput: HomeCardPresenterInput = {
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
    const result = await presenter.presentHomeCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should rewrite '0 overlapping intents' to 'Shared interests'", async () => {
    const presenter = createLlmMockPresenter("0 overlapping intents");
    const result = await presenter.presentHomeCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });

  it("should NOT rewrite '3 mutual intents'", async () => {
    const presenter = createLlmMockPresenter("3 mutual intents");
    const result = await presenter.presentHomeCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("3 mutual intents");
  });

  it("should NOT rewrite 'Shared interests'", async () => {
    const presenter = createLlmMockPresenter("Shared interests");
    const result = await presenter.presentHomeCard(baseInput);
    expect(result.mutualIntentsLabel).toBe("Shared interests");
  });
});

describe("OpportunityPresenter - IND-113: Introducer should not appear in body text", () => {
  const presenter = new OpportunityPresenter();

  const createIntroducerInput = (
    introducerName: string,
    counterpartName: string,
  ): HomeCardPresenterInput => ({
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

    const result = await presenter.presentHomeCard(input);

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

    const result = await presenter.presentHomeCard(input);

    expect(result.personalizedSummary).toContain("Alice");
    expect(result.personalizedSummary.length).toBeGreaterThan(50);
  }, 30000);

  it("should set appropriate narratorRemark for introduction", async () => {
    const input = createIntroducerInput("Jane Doe", "Mark Wilson");

    const result = await presenter.presentHomeCard(input);

    expect(typeof result.narratorRemark).toBe("string");
    expect(result.narratorRemark.length).toBeGreaterThan(0);
    expect(result.narratorRemark.length).toBeLessThanOrEqual(80);
  }, 30000);
});
