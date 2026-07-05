/**
 * Shared safe-presentation primitive for all user-facing opportunity surfaces.
 *
 * Historically every surface (home feed, list/discover cards, minimal chat
 * cards, notification emails/Telegram, chat context, delivery cards) invented
 * its own fallback chain for the case where genuine LLM presenter output is
 * unavailable — some sliced raw `interpretation.reasoning` with no
 * sanitization at all. This module is the single standard:
 *
 *   raw reasoning
 *     → whitespace-normalize
 *     → viewer-centric rewrite (incl. UUID stripping + introducer-mention stripping)
 *     → boundary-aware truncation
 *     → per-surface empty-text default
 *
 * Surfaces choose *policy* (send a sanitized fallback vs skip entirely) via
 * `allowFallback`; they no longer choose (or forget) sanitization steps.
 *
 * See `.pi/skills/opportunity-presentation-safety/SKILL.md` for the review
 * checklist this module exists to satisfy.
 */

import { truncateAtBoundary, viewerCentricCardSummary } from "./opportunity.presentation.js";

/** Default max length for fallback summaries (matches presenter internal fallback). */
export const SAFE_FALLBACK_MAX_CHARS = 300;

/** Default copy when no reasoning text is available at all. */
export const DEFAULT_EMPTY_FALLBACK_TEXT = "A promising connection.";

/** Default headline for fallback presentations (matches presenter internal fallback). */
export const DEFAULT_FALLBACK_HEADLINE = "A promising connection";

/** Default CTA for fallback presentations (matches presenter internal fallback). */
export const DEFAULT_FALLBACK_ACTION =
  "Take a look and decide whether to reach out.";

export interface SafeFallbackOptions {
  /** Display name of the counterpart shown on the card (enables viewer-centric rewrite). */
  counterpartName?: string;
  /** Display name of the viewer; sentences describing the viewer are skipped/rewritten to "you". */
  viewerName?: string;
  /** Introducer display name; introducer mentions are stripped from the summary body. */
  introducerName?: string | null;
  /** Max output length (boundary-aware). Default {@link SAFE_FALLBACK_MAX_CHARS}. */
  maxChars?: number;
  /** Copy returned when reasoning is empty/blank. Default {@link DEFAULT_EMPTY_FALLBACK_TEXT}. */
  emptyText?: string;
}

/**
 * Produce safe user-facing fallback copy from raw match reasoning.
 *
 * This is the ONE sanitization standard: UUID stripping, introducer-mention
 * stripping, and viewer-centric rewrite (via {@link viewerCentricCardSummary}),
 * followed by whitespace normalization and boundary-aware truncation (via
 * {@link truncateAtBoundary}). Never returns raw reasoning verbatim beyond
 * these guarantees, and never returns an empty string.
 *
 * @param rawReasoning - Raw `interpretation.reasoning` / `matchReason` text (may be null/undefined).
 * @param opts - Per-surface knobs (names for rewrite, max length, empty-text copy).
 */
export function safeFallbackSummary(
  rawReasoning: string | null | undefined,
  opts: SafeFallbackOptions = {},
): string {
  const emptyText = opts.emptyText ?? DEFAULT_EMPTY_FALLBACK_TEXT;
  const maxChars = opts.maxChars ?? SAFE_FALLBACK_MAX_CHARS;

  const normalized = (rawReasoning ?? "").replace(/\s+/g, " ").trim();
  if (!normalized) return emptyText;

  // viewerCentricCardSummary handles UUID stripping, introducer-mention
  // stripping, and the viewer-centric rewrite. Pass Infinity so truncation is
  // handled by boundary-aware logic below instead of a mid-word hard slice.
  const rewritten = viewerCentricCardSummary(
    normalized,
    opts.counterpartName ?? "",
    Number.POSITIVE_INFINITY,
    opts.viewerName,
    opts.introducerName ?? undefined,
  );

  const truncated = truncateAtBoundary(rewritten, maxChars);
  return truncated || emptyText;
}

/** Minimal presenter-output shape the primitive inspects (subset of HomeCardPresentationResult). */
export interface SafePresentationCandidate {
  headline?: string;
  personalizedSummary?: string;
  suggestedAction?: string;
  /** Set by OpportunityPresenter when its LLM call failed and it returned fallback-shaped copy. */
  isFallback?: boolean;
}

/** Opportunity-ish source object accepted by {@link getSafePresentationOrSkip}. */
export interface SafePresentationSource {
  /** Presenter output attached to the record, when available. */
  homeCardPresentation?: SafePresentationCandidate | null;
  /** Pre-truncated raw reasoning carried on discovery/list card data. */
  matchReason?: string | null;
  /** Full opportunity interpretation, when the caller holds the record. */
  interpretation?: { reasoning?: string | null } | null;
}

export interface SafePresentationOptions extends SafeFallbackOptions {
  /**
   * Policy switch: when false, return null instead of fallback copy so the
   * surface can skip rendering entirely (e.g. scheduled digests where sending
   * degraded copy is worse than sending nothing). Default true.
   */
  allowFallback?: boolean;
}

/** Resolved safe presentation for a surface to render. */
export interface SafePresentation {
  headline: string;
  summary: string;
  suggestedAction: string;
  /** True when copy was derived from raw reasoning rather than genuine LLM presenter output. */
  isFallback: boolean;
}

/**
 * Resolve the safe user-facing presentation for an opportunity, or signal skip.
 *
 * Resolution order:
 * 1. Genuine presenter output (`homeCardPresentation` present, non-empty, and
 *    NOT tagged `isFallback` by the presenter) — returned as-is.
 * 2. Otherwise, if `allowFallback` (default true): sanitized fallback copy
 *    built from `matchReason` / `interpretation.reasoning` via
 *    {@link safeFallbackSummary}.
 * 3. Otherwise `null` — the surface must skip this opportunity.
 *
 * Raw `interpretation.reasoning` / `matchReason` never reaches the caller
 * unsanitized through this function.
 */
export function getSafePresentationOrSkip(
  source: SafePresentationSource,
  opts: SafePresentationOptions = {},
): SafePresentation | null {
  const candidate = source.homeCardPresentation;
  if (candidate?.personalizedSummary?.trim() && !candidate.isFallback) {
    return {
      headline: candidate.headline?.trim() || DEFAULT_FALLBACK_HEADLINE,
      summary: candidate.personalizedSummary,
      suggestedAction:
        candidate.suggestedAction?.trim() || DEFAULT_FALLBACK_ACTION,
      isFallback: false,
    };
  }

  if (opts.allowFallback === false) return null;

  const rawReasoning =
    source.matchReason ?? source.interpretation?.reasoning ?? "";
  return {
    headline: DEFAULT_FALLBACK_HEADLINE,
    summary: safeFallbackSummary(rawReasoning, opts),
    suggestedAction: DEFAULT_FALLBACK_ACTION,
    isFallback: true,
  };
}
