import { config } from "dotenv";
config({ path: ".env.development", override: true });

import { describe, expect, it } from "bun:test";
import { OpportunityPresenter, type HomeCardPresenterInput } from "../opportunity.presenter";

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
