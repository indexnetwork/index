import { describe, expect, it } from "bun:test";

import { viewerCentricCardSummary, narratorRemarkFromReasoning } from "../opportunity.card-text";

// ═══════════════════════════════════════════════════════════════════════════════
// viewerCentricCardSummary
// ═══════════════════════════════════════════════════════════════════════════════

describe("viewerCentricCardSummary", () => {
  // ── Existing behavior (should remain unchanged) ──

  it("returns fallback when reasoning is empty", () => {
    expect(viewerCentricCardSummary("", "Alex Chen")).toBe(
      "A suggested connection.",
    );
  });

  it("returns full reasoning when counterpartName is empty", () => {
    const reasoning = "Two developers with complementary skills.";
    expect(viewerCentricCardSummary(reasoning, "")).toBe(reasoning);
  });

  it("returns sentences starting from counterpart mention", () => {
    const reasoning =
      "The source user needs a React developer. Alex Chen is a full-stack engineer focused on React and Node.";
    expect(viewerCentricCardSummary(reasoning, "Alex Chen")).toBe(
      "Alex Chen is a full-stack engineer focused on React and Node.",
    );
  });

  it("returns full reasoning when counterpart name not found", () => {
    const reasoning = "Both users have complementary skills in web development.";
    expect(viewerCentricCardSummary(reasoning, "Unknown Person")).toBe(
      reasoning,
    );
  });

  // ── Bug 2: Viewer self-referencing text ──

  it("strips viewer-describing prefix from compound sentence mentioning both names", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher building an AI operations toolkit and looking for technical collaborators.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).not.toMatch(/^Yankı/);
    expect(result).toContain("Elena Petrova");
  });

  it("strips viewer-describing prefix when sentence starts with viewer first name", () => {
    const reasoning =
      "Yankı is looking to recruit designers for a game development studio. Yuki Tanaka is a visual artist and illustrator with a focus on character design.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Yuki Tanaka",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toMatch(/^Yuki Tanaka/);
  });

  it("works without viewerName (backwards compatible)", () => {
    const reasoning =
      "Alex Chen is a full-stack engineer focused on React and Node.";
    expect(viewerCentricCardSummary(reasoning, "Alex Chen")).toBe(reasoning);
  });

  it("prefers sentences that start with counterpart name over compound sentences", () => {
    const reasoning =
      "The viewer is interested in AI and could work with Elena Petrova. Elena Petrova is an applied AI researcher building an AI operations toolkit.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "The viewer",
    );
    expect(result).toMatch(/^Elena Petrova is an applied AI researcher/);
  });

  it("handles single compound sentence with both names by extracting counterpart part", () => {
    const reasoning =
      "Yankı Ekin Yüksel is interested in AI in software development and could potentially collaborate with Elena Petrova, an applied AI researcher building an AI operations toolkit.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Elena Petrova",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toContain("Elena Petrova");
    expect(result).not.toMatch(/^Yankı/);
  });

  it("replaces viewer name with you/your so card addresses viewer in second person", () => {
    const reasoning =
      "Given Yankı's interest in game development and shadow puppetry, Yuki Tanaka is a strong match. She is a visual artist and illustrator with a focus on character design.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Yuki Tanaka",
      500,
      "Yankı Ekin Yüksel",
    );
    expect(result).toContain("your interest");
    expect(result).not.toContain("Yankı's");
    expect(result).toContain("Yuki Tanaka");
  });

  // ── IND-113: Introducer stripping ──

  it("strips introducer from summary with counterpart", () => {
    const reasoning = "Seref Yarar introduced you to Lucy, who is actively seeking a product co-founder.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Lucy",
      200,
      "Viewer Name",
      "Seref Yarar"
    );
    expect(result).not.toContain("Seref");
    expect(result).toContain("Lucy");
  });

  it("strips introducer when viewerName is not provided", () => {
    const reasoning = "Bob thinks you should meet Alice because your skills align.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      undefined,
      "Bob"
    );
    expect(result).not.toContain("Bob");
    expect(result).toContain("Alice");
  });

  it("does not modify text when introducerName is undefined", () => {
    const reasoning = "Alice is seeking a co-founder for her marketplace.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      "Viewer",
      undefined
    );
    expect(result).toBe(reasoning);
  });

  it("handles reasoning with viewer-centric transform then introducer strip", () => {
    const reasoning = "Bob thinks Viewer should meet Alice.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Alice",
      200,
      "Viewer",
      "Bob"
    );
    expect(result).not.toContain("Bob");
    expect(result).toContain("Alice");
  });

  it("truncates correctly after introducer removal", () => {
    const reasoning = "Seref introduced you to Lucy, who has very long description about many things she is working on and seeking help with.";
    const result = viewerCentricCardSummary(
      reasoning,
      "Lucy",
      50,
      undefined,
      "Seref"
    );
    expect(result.length).toBeLessThanOrEqual(53); // 50 + "..."
    expect(result).not.toContain("Seref");
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// narratorRemarkFromReasoning — STRESS TEST SUITE
// ═══════════════════════════════════════════════════════════════════════════════

/** Every narrator remark must satisfy these invariants. */
function assertNarratorInvariants(
  result: string,
  opts?: { counterpartName?: string; viewerName?: string },
) {
  expect(result.length).toBeGreaterThan(0);
  expect(result.length).toBeLessThanOrEqual(80);
  expect(result).not.toMatch(/\.\.\.$/); // never truncated
  if (opts?.counterpartName) {
    expect(result.toLowerCase()).not.toContain(opts.counterpartName.toLowerCase());
    // Also check first name
    const first = opts.counterpartName.split(/\s+/)[0];
    if (first && first.length > 1) {
      expect(result.toLowerCase()).not.toContain(first.toLowerCase());
    }
  }
  if (opts?.viewerName) {
    expect(result.toLowerCase()).not.toContain(opts.viewerName.toLowerCase());
    const first = opts.viewerName.split(/\s+/)[0];
    if (first && first.length > 1) {
      expect(result.toLowerCase()).not.toContain(first.toLowerCase());
    }
  }
}

const FALLBACK = "A potential connection worth exploring.";

/** Words that should NEVER appear in narrator text — they are process/meta-language. */
const FORBIDDEN_META_WORDS = [
  "discoverer", "explicitly", "assertive", "commissive", "directive",
  "illocutionary", "felicity", "utterance", "inference", "preparatory",
  "sincerity", "evaluator", "classifier", "semantic", "pragmatic",
  "verification", "reconciliation",
];

function assertNoMetaLanguage(result: string) {
  const lower = result.toLowerCase();
  for (const word of FORBIDDEN_META_WORDS) {
    expect(lower).not.toContain(word);
  }
}

describe("narratorRemarkFromReasoning", () => {
  // ─────────────────────────────────────────────────────────────
  // BASIC BEHAVIOR
  // ─────────────────────────────────────────────────────────────

  it("returns fallback when reasoning is empty", () => {
    expect(narratorRemarkFromReasoning("", "Alex Chen")).toBe(FALLBACK);
  });

  it("returns fallback when reasoning is only whitespace", () => {
    expect(narratorRemarkFromReasoning("   \n\t  ", "Alex Chen")).toBe(FALLBACK);
  });

  it("returns fallback when reasoning is only the counterpart name", () => {
    const result = narratorRemarkFromReasoning("Alex Chen", "Alex Chen");
    assertNarratorInvariants(result, { counterpartName: "Alex Chen" });
  });

  it("returns fallback when reasoning has only stop words", () => {
    const result = narratorRemarkFromReasoning(
      "The users are both looking for someone with potential to collaborate.",
      "Someone"
    );
    assertNarratorInvariants(result, { counterpartName: "Someone" });
  });

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 1: KNOWN DOMAIN PHRASES
  // ─────────────────────────────────────────────────────────────

  it("extracts AI and machine learning", () => {
    const result = narratorRemarkFromReasoning(
      "Both users share deep expertise in AI and machine learning, making them strong collaborators.",
      "Alex Chen"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex Chen" });
    expect(result.toLowerCase()).toMatch(/ai|machine learning/);
  });

  it("extracts React and Node", () => {
    const result = narratorRemarkFromReasoning(
      "Strong overlap in React and Node development experience.",
      "Dana Lee"
    );
    assertNarratorInvariants(result, { counterpartName: "Dana Lee" });
    expect(result).toMatch(/React|Node/);
  });

  it("extracts game development", () => {
    const result = narratorRemarkFromReasoning(
      "Both are passionate about game development and interactive storytelling.",
      "Yuki Tanaka"
    );
    assertNarratorInvariants(result, { counterpartName: "Yuki Tanaka" });
    expect(result.toLowerCase()).toContain("game development");
  });

  it("extracts blockchain and smart contracts", () => {
    const result = narratorRemarkFromReasoning(
      "Shared interest in blockchain infrastructure and smart contracts for DeFi applications.",
      "Vitalik"
    );
    assertNarratorInvariants(result, { counterpartName: "Vitalik" });
    expect(result.toLowerCase()).toMatch(/blockchain|smart contracts|defi/i);
  });

  it("extracts UX and product design", () => {
    const result = narratorRemarkFromReasoning(
      "Strong alignment on UX research methods and product design principles.",
      "Maya"
    );
    assertNarratorInvariants(result, { counterpartName: "Maya" });
    expect(result.toLowerCase()).toMatch(/ux|product design/);
  });

  it("extracts Python and data science", () => {
    const result = narratorRemarkFromReasoning(
      "Both experienced in Python for data science and deep learning applications.",
      "Raj"
    );
    assertNarratorInvariants(result, { counterpartName: "Raj" });
    expect(result.toLowerCase()).toMatch(/python|data science|deep learning/i);
  });

  it("extracts DevOps and cloud computing", () => {
    const result = narratorRemarkFromReasoning(
      "Complementary skills in DevOps practices and cloud computing infrastructure.",
      "Kim"
    );
    assertNarratorInvariants(result, { counterpartName: "Kim" });
    expect(result.toLowerCase()).toMatch(/devops|cloud computing/i);
  });

  it("extracts NLP and natural language processing", () => {
    const result = narratorRemarkFromReasoning(
      "Both working on NLP and natural language processing systems for enterprise.",
      "Dr. Li"
    );
    assertNarratorInvariants(result, { counterpartName: "Dr. Li" });
    expect(result.toLowerCase()).toMatch(/nlp|natural language processing/);
  });

  it("extracts Rust and Solidity", () => {
    const result = narratorRemarkFromReasoning(
      "Both fluent in Rust and Solidity, building low-level protocol infrastructure.",
      "Carlos"
    );
    assertNarratorInvariants(result, { counterpartName: "Carlos" });
    expect(result).toMatch(/Rust|Solidity/);
  });

  it("extracts startup and co-founding", () => {
    const result = narratorRemarkFromReasoning(
      "Both looking for a co-founding partner to launch a startup in edtech.",
      "Sam"
    );
    assertNarratorInvariants(result, { counterpartName: "Sam" });
    expect(result.toLowerCase()).toMatch(/startup|co-?founding/);
  });

  it("extracts creative writing and content creation", () => {
    const result = narratorRemarkFromReasoning(
      "Shared passion for creative writing and content creation across platforms.",
      "Mia"
    );
    assertNarratorInvariants(result, { counterpartName: "Mia" });
    expect(result.toLowerCase()).toMatch(/creative writing|content creation/);
  });

  it("extracts photography and illustration", () => {
    const result = narratorRemarkFromReasoning(
      "Both skilled in photography and illustration for editorial work.",
      "Yui"
    );
    assertNarratorInvariants(result, { counterpartName: "Yui" });
    expect(result.toLowerCase()).toMatch(/photography|illustration/);
  });

  it("extracts venture capital and angel investing", () => {
    const result = narratorRemarkFromReasoning(
      "Interested in venture capital and angel investing in climate tech.",
      "Marcus"
    );
    assertNarratorInvariants(result, { counterpartName: "Marcus" });
    expect(result.toLowerCase()).toMatch(/venture capital|angel invest/);
  });

  it("extracts Figma and Unity", () => {
    const result = narratorRemarkFromReasoning(
      "Both use Figma for prototyping and Unity for interactive 3D experiences.",
      "Lena"
    );
    assertNarratorInvariants(result, { counterpartName: "Lena" });
    expect(result).toMatch(/Figma|Unity/);
  });

  it("caps at 3 terms even when many are present", () => {
    const result = narratorRemarkFromReasoning(
      "Expert in AI, ML, NLP, DevOps, React, Python, and data science.",
      "Max"
    );
    assertNarratorInvariants(result, { counterpartName: "Max" });
    // The remark should have at most 3 terms joined
    const termMatches = result.match(/AI|ML|NLP|DevOps|React|Python|data science/gi) ?? [];
    expect(termMatches.length).toBeLessThanOrEqual(3);
  });

  // ─────────────────────────────────────────────────────────────
  // STRATEGY 2: CAPITALIZED TOPIC EXTRACTION (FALLBACK)
  // ─────────────────────────────────────────────────────────────

  it("extracts multi-word capitalized phrases when no known terms", () => {
    const result = narratorRemarkFromReasoning(
      "Both interested in Shadow Puppetry and Experimental Theater.",
      "Omar"
    );
    assertNarratorInvariants(result, { counterpartName: "Omar" });
    expect(result.toLowerCase()).toMatch(/shadow puppetry|experimental theater/);
  });

  it("extracts single capitalized words as last resort", () => {
    const result = narratorRemarkFromReasoning(
      "Strong overlap in Ceramics and Woodworking traditions.",
      "Hana"
    );
    assertNarratorInvariants(result, { counterpartName: "Hana" });
    expect(result.toLowerCase()).toMatch(/ceramics|woodworking/);
  });

  it("prefers multi-word capitalized phrases over single words", () => {
    const result = narratorRemarkFromReasoning(
      "Shared passion for Urban Farming and Vertical Gardens.",
      "Kai"
    );
    assertNarratorInvariants(result, { counterpartName: "Kai" });
    expect(result.toLowerCase()).toMatch(/urban farming|vertical gardens/);
  });

  // ─────────────────────────────────────────────────────────────
  // IND-123: META-LANGUAGE MUST NOT LEAK INTO NARRATOR TEXT
  // ─────────────────────────────────────────────────────────────

  it("rejects meta-language: discoverer, explicitly, states", () => {
    const result = narratorRemarkFromReasoning(
      "The discoverer explicitly states an intent to connect with visual artists for creative collaboration projects.",
      "Elena"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena" });
    assertNoMetaLanguage(result);
    expect(result.toLowerCase()).not.toContain("discoverer");
    expect(result.toLowerCase()).not.toContain("explicitly");
    expect(result.toLowerCase()).not.toContain("states");
  });

  it("rejects meta-language: expressed, demonstrated, indicates", () => {
    const result = narratorRemarkFromReasoning(
      "The user expressed a strong interest and demonstrated commitment. This indicates a solid match.",
      "Zara"
    );
    assertNarratorInvariants(result, { counterpartName: "Zara" });
    assertNoMetaLanguage(result);
  });

  it("rejects meta-language: commissive, assertive, directive speech acts", () => {
    const result = narratorRemarkFromReasoning(
      "The commissive speech act indicates sincerity. The directive classification suggests genuine intent.",
      "Bob"
    );
    assertNarratorInvariants(result, { counterpartName: "Bob" });
    assertNoMetaLanguage(result);
  });

  it("rejects meta-language: illocutionary, felicity, utterance", () => {
    const result = narratorRemarkFromReasoning(
      "The illocutionary force of the utterance satisfies felicity conditions for a valid match.",
      "Carol"
    );
    assertNarratorInvariants(result, { counterpartName: "Carol" });
    assertNoMetaLanguage(result);
  });

  it("rejects meta-language: evaluator, verification, reconciliation", () => {
    const result = narratorRemarkFromReasoning(
      "The evaluator determined through verification and reconciliation that these profiles align.",
      "Dave"
    );
    assertNarratorInvariants(result, { counterpartName: "Dave" });
    assertNoMetaLanguage(result);
  });

  it("rejects process words: inference, preparatory, sincerity condition", () => {
    const result = narratorRemarkFromReasoning(
      "Inference suggests the preparatory and sincerity conditions are met for this collaboration.",
      "Eve"
    );
    assertNarratorInvariants(result, { counterpartName: "Eve" });
    assertNoMetaLanguage(result);
  });

  it("rejects: the discoverer is looking for artists for collaboration", () => {
    // This is the exact failing case from IND-123
    const result = narratorRemarkFromReasoning(
      "The discoverer is looking for artists for collaboration. The agent has expressed interest in visual arts and creative projects.",
      "Elena Petrova"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena Petrova" });
    expect(result.toLowerCase()).not.toContain("discoverer");
  });

  it("rejects: user profile indicates, intent classification", () => {
    const result = narratorRemarkFromReasoning(
      "The user profile indicates a strong background. Intent classification confirms alignment with the target profile.",
      "Frank"
    );
    assertNarratorInvariants(result, { counterpartName: "Frank" });
    assertNoMetaLanguage(result);
  });

  it("rejects: semantic overlap, pragmatic analysis", () => {
    const result = narratorRemarkFromReasoning(
      "Semantic overlap detected. Pragmatic analysis confirms genuine collaboration potential.",
      "Gina"
    );
    assertNarratorInvariants(result, { counterpartName: "Gina" });
    assertNoMetaLanguage(result);
  });

  it("rejects long evaluator meta-commentary with no domain terms", () => {
    const result = narratorRemarkFromReasoning(
      "Based on the analysis of both profiles, there appears to be a meaningful connection between these two individuals. The system has determined that their respective backgrounds and stated intentions suggest a productive relationship could form.",
      "Hannah"
    );
    assertNarratorInvariants(result, { counterpartName: "Hannah" });
    // Should fall through to relationship match or fallback, not grab random long words
    assertNoMetaLanguage(result);
  });

  // ─────────────────────────────────────────────────────────────
  // RELATIONSHIP PHRASE FALLBACK
  // ─────────────────────────────────────────────────────────────

  it("catches 'complementary skills' when no domain terms", () => {
    const result = narratorRemarkFromReasoning(
      "These two have complementary skills that could lead to a great partnership.",
      "Ivy"
    );
    assertNarratorInvariants(result, { counterpartName: "Ivy" });
    expect(result.toLowerCase()).toContain("complementary skills");
  });

  it("catches 'potential collaboration' when no domain terms", () => {
    const result = narratorRemarkFromReasoning(
      "There is clear potential collaboration between these two professionals.",
      "Jack"
    );
    assertNarratorInvariants(result, { counterpartName: "Jack" });
    expect(result.toLowerCase()).toContain("potential collaboration");
  });

  it("catches 'similar interests' as relationship phrase", () => {
    const result = narratorRemarkFromReasoning(
      "They share similar interests and could benefit from connecting.",
      "Kelly"
    );
    assertNarratorInvariants(result, { counterpartName: "Kelly" });
    expect(result.toLowerCase()).toContain("similar interests");
  });

  it("catches 'looking for a designer' as relationship phrase", () => {
    const result = narratorRemarkFromReasoning(
      "One is looking for a designer with strong visual skills.",
      "Leo"
    );
    assertNarratorInvariants(result, { counterpartName: "Leo" });
    expect(result.toLowerCase()).toContain("looking for a designer");
  });

  // ─────────────────────────────────────────────────────────────
  // NAME STRIPPING
  // ─────────────────────────────────────────────────────────────

  it("strips counterpart full name", () => {
    const result = narratorRemarkFromReasoning(
      "Alex Chen has strong React skills and is looking for backend collaborators.",
      "Alex Chen"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex Chen" });
  });

  it("strips counterpart first name", () => {
    const result = narratorRemarkFromReasoning(
      "Alex is an expert in AI. Strong match for the viewer.",
      "Alex Chen"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex Chen" });
  });

  it("strips viewer full name", () => {
    const result = narratorRemarkFromReasoning(
      "Yankı Ekin Yüksel and the counterpart share AI expertise.",
      "Elena Petrova",
      "Yankı Ekin Yüksel"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena Petrova", viewerName: "Yankı Ekin Yüksel" });
  });

  it("strips viewer first name", () => {
    const result = narratorRemarkFromReasoning(
      "Yankı is interested in AI. The counterpart works in machine learning.",
      "Elena Petrova",
      "Yankı Ekin Yüksel"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena Petrova", viewerName: "Yankı Ekin Yüksel" });
  });

  it("strips both names simultaneously", () => {
    const result = narratorRemarkFromReasoning(
      "Yankı Ekin Yüksel and Elena Petrova both work in AI and machine learning research.",
      "Elena Petrova",
      "Yankı Ekin Yüksel"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena Petrova", viewerName: "Yankı Ekin Yüksel" });
  });

  // ─────────────────────────────────────────────────────────────
  // UUID STRIPPING
  // ─────────────────────────────────────────────────────────────

  it("strips UUIDs from reasoning", () => {
    const result = narratorRemarkFromReasoning(
      "Match e037ca5a-d5ce-426e-80d1-376abc123def between users based on complementary skills.",
      "Someone"
    );
    assertNarratorInvariants(result, { counterpartName: "Someone" });
    expect(result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  it("strips multiple UUIDs", () => {
    const result = narratorRemarkFromReasoning(
      "User a1b2c3d4-e5f6-7890-abcd-ef1234567890 matched with b2c3d4e5-f6a7-8901-bcde-f12345678901 on AI.",
      "Someone"
    );
    assertNarratorInvariants(result, { counterpartName: "Someone" });
    expect(result).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}/);
  });

  // ─────────────────────────────────────────────────────────────
  // DETERMINISM
  // ─────────────────────────────────────────────────────────────

  it("produces consistent output for same input", () => {
    const reasoning = "Both experienced in Python for data science applications.";
    const r1 = narratorRemarkFromReasoning(reasoning, "Alex");
    const r2 = narratorRemarkFromReasoning(reasoning, "Alex");
    expect(r1).toBe(r2);
  });

  it("produces different remarks for different reasoning texts", () => {
    const r1 = narratorRemarkFromReasoning(
      "Both share expertise in AI and machine learning.",
      "Alex Chen"
    );
    const r2 = narratorRemarkFromReasoning(
      "One is looking for a designer, the other is a UX specialist.",
      "Yuki Tanaka"
    );
    expect(r1).not.toBe(r2);
  });

  // ─────────────────────────────────────────────────────────────
  // INTRODUCER HANDLING
  // ─────────────────────────────────────────────────────────────

  it("extracts domain terms from reasoning with introducer", () => {
    const result = narratorRemarkFromReasoning(
      "Seref introduced you to Lucy, who works in AI and machine learning.",
      "Lucy",
      "Viewer"
    );
    assertNarratorInvariants(result, { counterpartName: "Lucy", viewerName: "Viewer" });
    expect(result).toContain("AI");
  });

  it("handles reasoning without clear domain terms after introducer removal", () => {
    const result = narratorRemarkFromReasoning(
      "Seref introduced you to Lucy. You should connect.",
      "Lucy",
      "Viewer"
    );
    assertNarratorInvariants(result, { counterpartName: "Lucy", viewerName: "Viewer" });
  });

  // ─────────────────────────────────────────────────────────────
  // EDGE CASES: MALFORMED / ADVERSARIAL INPUT
  // ─────────────────────────────────────────────────────────────

  it("handles reasoning that is a single word", () => {
    const result = narratorRemarkFromReasoning("Match", "Alex");
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles reasoning that is only punctuation", () => {
    const result = narratorRemarkFromReasoning("...", "Alex");
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles reasoning with only numbers", () => {
    const result = narratorRemarkFromReasoning("12345 67890 99999", "Alex");
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles extremely long reasoning without blowing up", () => {
    const long = "AI and machine learning are important. ".repeat(500);
    const result = narratorRemarkFromReasoning(long, "Alex");
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles reasoning with special characters", () => {
    const result = narratorRemarkFromReasoning(
      "Both interested in C++ and C# development for game engines <script>alert('xss')</script>.",
      "Alex"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles reasoning with newlines and tabs", () => {
    const result = narratorRemarkFromReasoning(
      "Both work in AI.\n\nThey share\tinterests in machine learning.",
      "Alex"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles counterpartName that is a single character", () => {
    const result = narratorRemarkFromReasoning(
      "X is an expert in AI and machine learning.",
      "X"
    );
    assertNarratorInvariants(result);
  });

  it("handles counterpartName with regex-special characters", () => {
    const result = narratorRemarkFromReasoning(
      "C++ Expert (Senior) matches well with the viewer's needs in systems programming.",
      "C++ Expert (Senior)"
    );
    assertNarratorInvariants(result);
  });

  it("handles reasoning that is just the viewer name repeated", () => {
    const result = narratorRemarkFromReasoning(
      "Yankı Ekin Yüksel Yankı Ekin Yüksel Yankı Ekin Yüksel",
      "Elena",
      "Yankı Ekin Yüksel"
    );
    assertNarratorInvariants(result, { counterpartName: "Elena", viewerName: "Yankı Ekin Yüksel" });
  });

  it("handles empty counterpartName", () => {
    const result = narratorRemarkFromReasoning(
      "Both interested in AI.",
      ""
    );
    assertNarratorInvariants(result);
  });

  it("handles unicode characters in reasoning", () => {
    const result = narratorRemarkFromReasoning(
      "Shared interest in café culture, résumé writing, and naïve art.",
      "José"
    );
    assertNarratorInvariants(result);
  });

  it("does not pick up articles/prepositions capitalized at sentence start", () => {
    const result = narratorRemarkFromReasoning(
      "The users have overlapping goals. Between them, a productive relationship could form.",
      "Someone"
    );
    assertNarratorInvariants(result, { counterpartName: "Someone" });
    expect(result.toLowerCase()).not.toMatch(/^(shared interest|overlap|common ground|aligned|mutual interest) in the\b/);
  });

  it("handles emoji in reasoning", () => {
    const result = narratorRemarkFromReasoning(
      "Both love AI 🤖 and machine learning 🧠 applications!",
      "Alex"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  // ─────────────────────────────────────────────────────────────
  // REAL-WORLD EVALUATOR REASONING PATTERNS
  // ─────────────────────────────────────────────────────────────

  it("handles typical evaluator: both users share expertise in X", () => {
    const result = narratorRemarkFromReasoning(
      "Both users share deep expertise in frontend development and user experience design, suggesting productive knowledge exchange.",
      "Alex Chen"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex Chen" });
    expect(result.toLowerCase()).toMatch(/frontend development|user experience/);
  });

  it("handles typical evaluator: one seeks, other provides", () => {
    const result = narratorRemarkFromReasoning(
      "One party is seeking a React developer while the other has extensive React and TypeScript experience, creating a natural fit.",
      "Sam Kim"
    );
    assertNarratorInvariants(result, { counterpartName: "Sam Kim" });
    expect(result).toMatch(/React|TypeScript/);
  });

  it("handles typical evaluator: overlapping intents in domain X", () => {
    const result = narratorRemarkFromReasoning(
      "Overlapping intents around open source tooling and DevOps automation suggest collaboration value.",
      "Pat"
    );
    assertNarratorInvariants(result, { counterpartName: "Pat" });
    expect(result.toLowerCase()).toMatch(/open source|devops/i);
  });

  it("handles typical evaluator: complementary backgrounds", () => {
    const result = narratorRemarkFromReasoning(
      "Complementary backgrounds — one in mobile development, the other in backend development — suggest strong team potential.",
      "Robin"
    );
    assertNarratorInvariants(result, { counterpartName: "Robin" });
    expect(result.toLowerCase()).toMatch(/mobile development|backend development/);
  });

  it("handles typical evaluator: strong alignment on X", () => {
    const result = narratorRemarkFromReasoning(
      "Strong alignment on blockchain infrastructure and decentralized finance protocols.",
      "Priya"
    );
    assertNarratorInvariants(result, { counterpartName: "Priya" });
    expect(result.toLowerCase()).toMatch(/blockchain|decentralized finance/);
  });

  it("handles typical evaluator: mutual interest in niche domain", () => {
    const result = narratorRemarkFromReasoning(
      "Mutual interest in computer vision applications for autonomous vehicles.",
      "Chen Wei"
    );
    assertNarratorInvariants(result, { counterpartName: "Chen Wei" });
    expect(result.toLowerCase()).toMatch(/computer vision/);
  });

  it("handles evaluator with generic reasoning and no domain terms", () => {
    const result = narratorRemarkFromReasoning(
      "These two individuals have backgrounds that could lead to a productive working relationship based on their stated goals.",
      "Anonymous"
    );
    assertNarratorInvariants(result, { counterpartName: "Anonymous" });
  });

  it("handles evaluator mixing domain terms with meta-language", () => {
    const result = narratorRemarkFromReasoning(
      "The evaluator determined that both profiles indicate strong Python and data science capabilities, suggesting the inference is well-founded.",
      "Raj"
    );
    assertNarratorInvariants(result, { counterpartName: "Raj" });
    // Should extract domain terms, not meta-language
    expect(result.toLowerCase()).toMatch(/python|data science/i);
    assertNoMetaLanguage(result);
  });

  it("handles evaluator with role-based language", () => {
    const result = narratorRemarkFromReasoning(
      "The agent profile shows deep learning expertise while the patient seeks mentoring in neural network architecture.",
      "Dr. Singh"
    );
    assertNarratorInvariants(result, { counterpartName: "Dr. Singh" });
    expect(result.toLowerCase()).toMatch(/deep learning|mentoring/);
  });

  it("handles evaluator referencing intent types", () => {
    const result = narratorRemarkFromReasoning(
      "Both parties have active intents around freelance consulting in the SaaS space.",
      "Jordan"
    );
    assertNarratorInvariants(result, { counterpartName: "Jordan" });
    expect(result.toLowerCase()).toMatch(/freelanc|consulting|saas/i);
  });

  it("handles evaluator with confidence language", () => {
    const result = narratorRemarkFromReasoning(
      "High confidence match based on shared interest in music production and audio engineering.",
      "DJ Max"
    );
    assertNarratorInvariants(result, { counterpartName: "DJ Max" });
    expect(result.toLowerCase()).toMatch(/music production/);
  });

  it("handles evaluator with introduction context", () => {
    const result = narratorRemarkFromReasoning(
      "The introducer connected these two based on their shared interest in social impact ventures and community building.",
      "Maya",
      "Viewer"
    );
    assertNarratorInvariants(result, { counterpartName: "Maya", viewerName: "Viewer" });
    expect(result.toLowerCase()).toMatch(/social impact|community building/);
  });

  it("handles evaluator with vague signals", () => {
    const result = narratorRemarkFromReasoning(
      "Some alignment detected. The profiles suggest potential for a meaningful professional connection.",
      "Sam"
    );
    assertNarratorInvariants(result, { counterpartName: "Sam" });
  });

  it("handles evaluator with only relationship-type words and nothing else", () => {
    const result = narratorRemarkFromReasoning(
      "Strong match between the two users.",
      "Lex"
    );
    assertNarratorInvariants(result, { counterpartName: "Lex" });
    expect(result.toLowerCase()).toContain("strong match");
  });

  // ─────────────────────────────────────────────────────────────
  // MIXED DOMAINS
  // ─────────────────────────────────────────────────────────────

  it("picks up to 3 terms from a multi-domain reasoning", () => {
    const result = narratorRemarkFromReasoning(
      "Overlap in AI, blockchain, and user experience design for decentralized applications.",
      "Zoe"
    );
    assertNarratorInvariants(result, { counterpartName: "Zoe" });
  });

  it("handles creative + tech overlap", () => {
    const result = narratorRemarkFromReasoning(
      "One party does illustration and animation, the other needs character design for a Unity game.",
      "Yumi"
    );
    assertNarratorInvariants(result, { counterpartName: "Yumi" });
    expect(result.toLowerCase()).toMatch(/illustration|animation|character design|unity/i);
  });

  it("handles business + tech overlap", () => {
    const result = narratorRemarkFromReasoning(
      "Shared interest in digital marketing and SaaS product development.",
      "Mark"
    );
    assertNarratorInvariants(result, { counterpartName: "Mark" });
    expect(result.toLowerCase()).toMatch(/digital marketing|saas/i);
  });

  // ─────────────────────────────────────────────────────────────
  // CASE SENSITIVITY
  // ─────────────────────────────────────────────────────────────

  it("handles lowercase domain terms by falling through to fallback", () => {
    // Lowercase "ai" and "react" don't match the case-sensitive acronym/proper-noun
    // pattern — this is intentional to avoid false positives (e.g. "react" the verb).
    // Real evaluator output uses proper casing ("AI", "React").
    const result = narratorRemarkFromReasoning(
      "Both work in ai and react development.",
      "Alex"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex" });
  });

  it("handles UPPERCASE domain terms (AI, ML, NLP)", () => {
    const result = narratorRemarkFromReasoning(
      "Shared expertise in AI, ML, and NLP systems.",
      "Alex"
    );
    assertNarratorInvariants(result, { counterpartName: "Alex" });
    expect(result).toMatch(/AI|ML|NLP/);
  });

  it("handles mixed case (Machine Learning, Deep Learning)", () => {
    const result = narratorRemarkFromReasoning(
      "Both focused on Machine Learning and Deep Learning research.",
      "Dr. Kim"
    );
    assertNarratorInvariants(result, { counterpartName: "Dr. Kim" });
    expect(result.toLowerCase()).toMatch(/machine learning|deep learning/);
  });

  // ─────────────────────────────────────────────────────────────
  // FULL INVARIANT SWEEP (bulk)
  // ─────────────────────────────────────────────────────────────

  const bulkCases: Array<{ reasoning: string; counterpart: string; viewer?: string }> = [
    { reasoning: "Looking for a co-founder in the fintech space.", counterpart: "Alice" },
    { reasoning: "Both are experienced TypeScript and JavaScript developers.", counterpart: "Bob" },
    { reasoning: "Interested in NFT marketplaces and DAO governance structures.", counterpart: "Carol" },
    { reasoning: "The agent is a Kotlin developer seeking Swift collaboration for cross-platform.", counterpart: "Dave" },
    { reasoning: "Mutual interest in DeSci and research funding mechanisms.", counterpart: "Eve", viewer: "Frank" },
    { reasoning: "One builds with Blender, the other needs 3D modeling for product visualization.", counterpart: "Grace" },
    { reasoning: "The discoverer wants to find mentors for entrepreneurship journey.", counterpart: "Hank" },
    { reasoning: "Both actively involved in filmmaking and music production.", counterpart: "Iris" },
    { reasoning: "Overlapping goals around full-stack web development and consulting.", counterpart: "Jules" },
    { reasoning: "The user mentioned interest in Unreal Engine and Go for server-side game logic.", counterpart: "Kim" },
    { reasoning: "Profile alignment: both in animation and graphic design for educational content.", counterpart: "Leo" },
    { reasoning: "The system identified a shared passion for social impact ventures.", counterpart: "Mona" },
    { reasoning: "Both users expressed interest in freelancing within the creative industry.", counterpart: "Nora" },
    { reasoning: "The evaluator noted semantic overlap in photography and visual art disciplines.", counterpart: "Oscar" },
    { reasoning: "Clear potential for mentoring in cloud computing and backend development.", counterpart: "Pat" },
  ];

  for (const { reasoning, counterpart, viewer } of bulkCases) {
    it(`invariants hold: "${reasoning.slice(0, 60)}..."`, () => {
      const result = narratorRemarkFromReasoning(reasoning, counterpart, viewer);
      assertNarratorInvariants(result, { counterpartName: counterpart, viewerName: viewer });
      assertNoMetaLanguage(result);
    });
  }
});
