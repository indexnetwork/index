import { describe, it, expect } from "bun:test";
import { safeFallbackSummary, getSafePresentationOrSkip, SAFE_FALLBACK_MAX_CHARS, DEFAULT_EMPTY_FALLBACK_TEXT, DEFAULT_FALLBACK_HEADLINE, DEFAULT_FALLBACK_ACTION } from "../opportunity.safe-presentation.js";

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
