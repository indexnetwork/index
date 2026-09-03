/**
 * The opportunity presentation cluster.
 *
 * One file for the whole path from a persisted opportunity to the copy a user
 * reads: the pure text transforms, the cache-key builders, the safe-fallback
 * pipeline, and the LLM presenter itself. They were four modules that only ever
 * called each other in one direction, and following a card's copy meant hopping
 * between them.
 *
 * Sections, in dependency order:
 *   1. Pure presentation transforms
 *   2. Presentation cache keys
 *   3. Safe-presentation pipeline (fallbacks that never leak raw reasoning)
 *   4. OpportunityPresenter (LLM card and chat copy)
 */

import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.labels.js";
import { stripUnsupportedOpportunityClaims } from "../shared/utils/claim-safety.js";
import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { Timed } from "../shared/observability/performance.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import type { Opportunity } from "../../platform/database.js";
import type { CompositeToolDatabase } from "../../platform/database.js";
import type { NegotiationContext } from "./negotiation-context.loader.js";


// ──────────────────────────────────────────────────────────────────────
// ── 1. Pure presentation transforms ──
// ──────────────────────────────────────────────────────────────────────

/**
 * Pure presentation layer for opportunities.
 * Generates title, description, and CTA based on viewer context — no DB access.
 */


export interface OpportunityPresentation {
  title: string;
  description: string;
  callToAction: string;
}

export interface UserInfo {
  id: string;
  name: string;
  avatar: string | null;
}

/**
 * Generate presentation copy for an opportunity based on viewer context.
 * Pure function — no side effects, no database access.
 */
export function presentOpportunity(
  opp: Opportunity,
  viewerId: string,
  otherPartyInfo: UserInfo,
  format: 'card' | 'email' | 'notification'
): OpportunityPresentation {
  const myActor = opp.actors.find((a) => a.userId === viewerId);

  if (!myActor) {
    throw new Error('Viewer is not an actor in this opportunity');
  }

  const otherName = otherPartyInfo.name;
  const safeReasoning =
    stripUnsupportedOpportunityClaims(stripUuids(opp.interpretation.reasoning)) ||
    'A promising connection.';
  let title: string;
  let description: string;
  let descriptionIsReasoning = false;

  switch (myActor.role) {
    case 'agent':
      title = `You can help ${otherName}`;
      description = `Based on your expertise, ${otherName} might benefit from connecting with you.`;
      break;
    case 'patient':
      title = `${otherName} might be able to help you`;
      description = `${otherName} has skills that align with what you're looking for.`;
      break;
    case 'peer':
      title = `Potential collaboration with ${otherName}`;
      description = `You and ${otherName} have complementary interests.`;
      break;
    case 'mentee':
      title = `${otherName} could mentor you`;
      description = `${otherName} has experience that could help guide your journey.`;
      break;
    case 'mentor':
      title = `${otherName} is looking for guidance`;
      description = `Your expertise could help ${otherName} on their path.`;
      break;
    case 'founder':
      title = `${otherName} might be interested in your venture`;
      description = `${otherName}'s investment focus aligns with what you're building.`;
      break;
    case 'investor':
      title = `${otherName} is building something interesting`;
      description = `${otherName}'s venture might fit your investment thesis.`;
      break;
    case 'party':
    default:
      title = `Opportunity with ${otherName}`;
      description = safeReasoning;
      descriptionIsReasoning = true;
      break;
  }

  if (!descriptionIsReasoning) {
    description += `\n\n${safeReasoning}`;
  }

  if (format === 'notification') {
    description =
      description.length > 100 ? description.slice(0, 97) + '...' : description;
  }

  return {
    title,
    description,
    callToAction: 'View Opportunity',
  };
}

/**
 * Strips UUID patterns from user-facing text to prevent internal ID leaks.
 */

const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

export function stripUuids(text: string): string {
  return text
    .replace(/\(([^)]*)\)/g, (_match, inner: string) => {
      if (!UUID_PATTERN.test(inner)) {
        UUID_PATTERN.lastIndex = 0;
        return _match;
      }
      UUID_PATTERN.lastIndex = 0;
      const cleaned = inner
        .replace(UUID_PATTERN, '')
        .replace(/,\s*,/g, ',')
        .replace(/\b(?:from|and)\b/gi, '')
        .replace(/^[\s,]+|[\s,]+$/g, '');
      return cleaned ? `(${cleaned})` : '';
    })
    .replace(UUID_PATTERN, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/**
 * Truncate user-facing text to at most `maxChars` without cutting mid-word.
 *
 * Prefers a sentence boundary, then a word boundary, and only falls back to a
 * hard slice if no boundary exists within the limit. An ellipsis is appended
 * when the text is actually shortened. Used by presenter fallbacks so a degraded
 * card never shows a sentence chopped mid-word (e.g. "His focus on 'indiv").
 */
export function truncateAtBoundary(text: string, maxChars: number): string {
  const trimmed = text.trim();
  if (trimmed.length <= maxChars) return trimmed;

  const slice = trimmed.slice(0, maxChars);

  // Prefer ending on the last completed sentence within the limit.
  const lastSentence = Math.max(
    slice.lastIndexOf(". "),
    slice.lastIndexOf("! "),
    slice.lastIndexOf("? "),
  );
  if (lastSentence >= maxChars * 0.5) {
    return slice.slice(0, lastSentence + 1).trim();
  }

  // Otherwise back off to the last whole word and add an ellipsis.
  const lastSpace = slice.lastIndexOf(" ");
  const body = lastSpace > 0 ? slice.slice(0, lastSpace) : slice;
  return body.replace(/[\s,;:.!?'"-]+$/, "").trim() + "\u2026";
}

// Helper function
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Viewer-centric text for opportunity cards.
 * The card is shown to the viewer (logged-in user) and should introduce the
 * counterpart, not describe the viewer to themselves.
 */

/**
 * Splits text into sentences using (?<=[.!?])\s+ (period/exclamation/question followed by whitespace).
 * Note: splits after any such punctuation, including abbreviations like "Dr." or "e.g.".
 */
function splitSentences(text: string): string[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  return trimmed
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Returns viewer-centric main text for an opportunity card.
 * Prefers the part of the reasoning that describes the counterpart (the person
 * on the card), so the viewer sees an introduction to the counterpart rather
 * than a description of themselves.
 *
 * @param reasoning - Raw interpretation.reasoning (may describe both parties).
 * @param counterpartName - Display name of the suggested connection (e.g. "Alex Chen").
 * @param maxChars - Max length of returned string (default MINIMAL_MAIN_TEXT_MAX_CHARS).
 * @param viewerName - Optional display name of the viewer (signed-in user). When provided, sentences or prefixes describing the viewer are skipped so the card introduces the counterpart, not the viewer.
 * @returns Viewer-centric snippet mentioning the counterpart when possible; if counterpartName is empty, returns reasoning truncated to maxChars. Never null; may be "A suggested connection." when reasoning is empty.
 */
export function viewerCentricCardSummary(
  reasoning: string,
  counterpartName: string,
  maxChars: number = MINIMAL_MAIN_TEXT_MAX_CHARS,
  viewerName?: string,
): string {
  const raw = stripUnsupportedOpportunityClaims(stripUuids(reasoning));
  if (!raw) return "A suggested connection.";

  const name = counterpartName.trim();
  if (!name) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    out = replaceViewerNameWithYou(out, viewerName);
    return out;
  }

  const sentences = splitSentences(raw);
  const nameLower = name.toLowerCase();
  const firstWordOfName = name.split(/\s+/)[0]?.toLowerCase();
  const hasCounterpartName = (s: string) =>
    s.toLowerCase().includes(nameLower) ||
    (firstWordOfName && firstWordOfName.length > 1 && s.toLowerCase().includes(firstWordOfName));

  const viewer = viewerName?.trim().toLowerCase();
  const viewerFirstWord = viewerName?.trim().split(/\s+/)[0]?.toLowerCase();
  const startsWithViewer = (s: string) => {
    if (!viewer) return false;
    const sl = s.toLowerCase();
    return sl.startsWith(viewer) ||
      (viewerFirstWord && viewerFirstWord.length > 1 && sl.startsWith(viewerFirstWord));
  };

  // When viewerName is provided, prefer sentences that mention the counterpart
  // but do NOT start with the viewer's name.
  if (viewer) {
    // First pass: find a sentence that mentions counterpart and doesn't start with viewer
    const cleanIdx = sentences.findIndex(
      (s) => hasCounterpartName(s) && !startsWithViewer(s),
    );
    if (cleanIdx !== -1) {
      const result = sentences.slice(cleanIdx).join(" ").trim();
      let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
      out = replaceViewerNameWithYou(out, viewerName, [name]);
      return out;
    }

    // Second pass: sentence mentions counterpart but starts with viewer (compound sentence).
    // Try to extract the counterpart portion after the counterpart's name.
    const compoundIdx = sentences.findIndex(
      (s) => hasCounterpartName(s) && startsWithViewer(s),
    );
    if (compoundIdx !== -1) {
      const sentence = sentences[compoundIdx];
      // Find where the counterpart name appears and extract from there
      // Use case-insensitive Unicode-aware regex so the index is correct
      // even when toLowerCase() changes string length (e.g. Turkish İ→i, German ß→ss).
      const cpMatch = sentence.match(new RegExp(escapeRegex(name), "iu"));
      const cpIdx = cpMatch?.index ?? -1;
      if (cpIdx > 0) {
        const extracted = sentence.slice(cpIdx).trim();
        const rest = sentences.slice(compoundIdx + 1).join(" ").trim();
        const result = rest ? `${extracted} ${rest}` : extracted;
        let out = result.length <= maxChars ? result : result.slice(0, maxChars) + "...";
        out = replaceViewerNameWithYou(out, viewerName, [name]);
        return out;
      }
    }
  }

  // Fallback: original logic without viewer awareness
  const idx = sentences.findIndex(hasCounterpartName);
  if (idx === -1) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    out = replaceViewerNameWithYou(out, viewerName, [name]);
    return out;
  }

  const fromCounterpart = sentences.slice(idx).join(" ").trim();
  let out =
    fromCounterpart.length <= maxChars
      ? fromCounterpart
      : fromCounterpart.slice(0, maxChars) + "...";
  out = replaceViewerNameWithYou(out, viewerName, [name]);
  return out;
}

/** Max length for narrator chip text (matches LLM presenter schema). */
const NARRATOR_MAX_CHARS = 80;

const FALLBACK_REMARK = "A potential connection worth exploring.";

/**
 * Generates a short narrator remark from opportunity reasoning for the narrator chip.
 * Used by the minimal (no-LLM) card path so each card gets a unique remark
 * instead of the same static text.
 *
 * Extracts domain keywords (e.g. "AI", "design", "machine learning") from the
 * reasoning and frames them in a short template like "Shared interest in AI and design."
 *
 * This is a regex-based heuristic — an alternative is OpportunityPresenter.presentCard()
 * which generates narratorRemark via LLM with much higher quality (already used by
 * home.graph.ts and opportunity.discover.ts). See buildMinimalOpportunityCard() in
 * opportunity.tools.ts for the trade-off discussion.
 *
 * @param reasoning - Raw interpretation.reasoning text.
 * @param counterpartName - Display name of the counterpart (stripped from output).
 * @param viewerName - Optional display name of the viewer (stripped from output).
 * @returns A short remark (max ~80 chars) suitable for the narrator chip. Never truncated with "...".
 */
export function narratorRemarkFromReasoning(
  reasoning: string,
  counterpartName: string,
  viewerName?: string,
): string {
  const raw = stripUnsupportedOpportunityClaims(stripUuids(reasoning)).trim();
  if (!raw) return FALLBACK_REMARK;

  // Strip all person names from the text so we work only with topics.
  let cleaned = raw;
  for (const name of [counterpartName, viewerName]) {
    if (!name?.trim()) continue;
    const full = name.trim();
    cleaned = cleaned.replace(new RegExp(escapeRegex(full), "gi"), "").trim();
    const first = full.split(/\s+/)[0];
    if (first && first.length > 1) {
      cleaned = cleaned.replace(new RegExp(`\\b${escapeRegex(first)}\\b`, "gi"), "").trim();
    }
  }

  // Extract domain/topic noun phrases from the cleaned text.
  // Match multi-word capitalized phrases (e.g. "AI operations toolkit") and
  // known domain terms.
  const domainTerms = extractDomainTerms(cleaned);

  if (domainTerms.length > 0) {
    // Build "Shared interest in X and Y." or "Overlap in X, Y, and Z."
    const prefixes = [
      "Shared interest in",
      "Overlap in",
      "Common ground in",
      "Aligned on",
      "Mutual interest in",
    ];
    // Pick prefix deterministically based on first term's char code
    const prefixIdx = domainTerms[0].charCodeAt(0) % prefixes.length;
    const prefix = prefixes[prefixIdx];
    const joined = joinTerms(domainTerms, NARRATOR_MAX_CHARS - prefix.length - 2); // -2 for " " and "."
    const remark = `${prefix} ${joined}.`;
    if (remark.length <= NARRATOR_MAX_CHARS) return remark;
  }

  // Fallback: try to extract a short relationship phrase
  const relationshipMatch = cleaned.match(
    /\b(complementary skills|shared expertise|overlapping intents|similar interests|strong match|mutual fit|potential collaboration|looking for (?:a |an )?[\w\s]{3,20})\b/i,
  );
  if (relationshipMatch) {
    const phrase = relationshipMatch[0];
    const remark = `Spotted ${phrase.toLowerCase()}.`;
    if (remark.length <= NARRATOR_MAX_CHARS) return remark;
  }

  return FALLBACK_REMARK;
}

/**
 * Extracts domain/topic terms from text by matching known patterns:
 * - Acronyms (AI, ML, UX, API)
 * - Multi-word domain phrases (machine learning, game development)
 * - Capitalized proper nouns that look like topics
 */
function extractDomainTerms(text: string): string[] {
  const seen = new Set<string>();
  const terms: string[] = [];

  // Known domain phrases (order matters — longer first)
  const knownPhrases = [
    /\b(machine learning|artificial intelligence|software development|game development|web development|data science|deep learning|natural language processing|computer vision|cloud computing|mobile development|product design|user experience|graphic design|character design|frontend development|backend development|full[- ]stack|smart contracts|visual art|creative writing|content creation|digital marketing|venture capital|angel invest(?:ing|ment)|open source|blockchain|cryptocurrency|decentralized finance|social impact|community building|music production|film(?:making| production)|photography|illustration|animation|3D modeling|startup|co-?founding|entrepreneurship|research|consulting|mentoring|freelanc(?:e|ing))\b/gi,
    /\b(AI|ML|UX|UI|API|NLP|SaaS|DeFi|DevOps|DeSci|NFT|DAO|React|Node|Python|TypeScript|JavaScript|Rust|Solidity|Go|Swift|Kotlin|Figma|Blender|Unity|Unreal)\b/g,
  ];

  for (const pattern of knownPhrases) {
    for (const match of text.matchAll(pattern)) {
      const term = match[1] ?? match[0];
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        // Preserve case for short acronyms/proper nouns; lowercase multi-word phrases
        if (term.length <= 5 && /^[A-Z]/.test(term)) {
          terms.push(term); // Keep React, AI, ML, etc. as-is
        } else {
          terms.push(key);
        }
      }
    }
  }

  // If no known phrases found, look for capitalized multi-word phrases
  // that look like explicit topic references (e.g. "Visual Art", "Smart Contracts").
  // Only accept capitalized words to avoid grabbing meta-language from evaluator reasoning
  // (e.g. "discoverer", "explicitly", "states" which are about the matching process, not topics).
  if (terms.length === 0) {
    // Multi-word capitalized phrases first (e.g. "Visual Art", "Creative Writing")
    const multiWordPattern = /\b([A-Z][a-z]+(?:\s+[A-Z][a-z]+)+)\b/g;
    for (const match of text.matchAll(multiWordPattern)) {
      const term = match[1];
      const key = term.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        terms.push(key);
        if (terms.length >= 3) break;
      }
    }

    // Single capitalized words as last resort (skip common sentence-starters and meta-words)
    if (terms.length === 0) {
      const skipCapitalized = new Set([
        // Articles / conjunctions / prepositions (capitalized at sentence start)
        "the", "and", "but", "for", "from", "with", "without", "between",
        "into", "about", "after", "before", "over", "under", "through",
        // Common sentence starters / pronouns / determiners
        "both", "their", "they", "this", "that", "these", "those",
        "here", "there", "would", "could", "should", "also", "very",
        "one", "another", "other", "each", "some", "many", "most",
        "such", "clear", "high", "good", "well", "just", "even",
        // Generic matching/relationship language
        "strong", "match", "based", "making", "looking", "seeking",
        "connection", "relationship", "opportunity", "overlap",
        "complementary", "potential", "interested", "collaborate",
        // Evaluator meta-language (about the matching process, not topics)
        "intent", "intents", "profile", "user", "users", "person",
        "discoverer", "explicitly", "states", "expressed", "mentioned",
        "indicates", "suggests", "demonstrates", "describes", "involves",
        "inference", "preparatory", "sincerity", "evaluator", "classifier",
        "semantic", "pragmatic", "verification", "reconciliation",
        "assertive", "commissive", "directive", "illocutionary",
        "felicity", "utterance", "detected", "analysis", "confirmed",
        "genuine", "conditions", "determined",
        // Discourse markers
        "particularly", "specifically", "especially", "primarily",
        "overall", "furthermore", "however", "therefore", "moreover",
      ]);
      const capWords = text.match(/\b[A-Z][a-z]{2,}\b/g) ?? [];
      for (const w of capWords) {
        const key = w.toLowerCase();
        if (!skipCapitalized.has(key) && !seen.has(key)) {
          seen.add(key);
          terms.push(key);
          if (terms.length >= 3) break;
        }
      }
    }
  }

  return terms.slice(0, 3); // Max 3 terms
}

/** Joins terms into "X, Y, and Z" form, dropping terms if too long. */
function joinTerms(terms: string[], maxLen: number): string {
  if (terms.length === 1) return terms[0];
  // Try all terms first
  for (let count = terms.length; count >= 1; count--) {
    const subset = terms.slice(0, count);
    let joined: string;
    if (subset.length === 1) {
      joined = subset[0];
    } else if (subset.length === 2) {
      joined = `${subset[0]} and ${subset[1]}`;
    } else {
      joined = `${subset.slice(0, -1).join(", ")}, and ${subset[subset.length - 1]}`;
    }
    if (joined.length <= maxLen) return joined;
  }
  return terms[0].slice(0, maxLen);
}

/**
 * Replaces viewer's name with "you"/"your" so the card addresses the viewer in second person.
 * Applied to mainText when viewerName is provided.
 * @param otherNames - Other actor names in the card; first-name replacement is
 *   skipped when the viewer's first name matches any other actor's first name.
 */
function replaceViewerNameWithYou(text: string, viewerName?: string, otherNames?: string[]): string {
  if (!viewerName?.trim()) return text;
  const full = viewerName.trim();
  const first = full.split(/\s+/)[0];
  let out = text;
  // Possessive: "Yankı's" → "your", "Yankı Ekin Yüksel's" → "your"
  out = out.replace(new RegExp(`\\b${escapeRegex(full)}'s\\b`, "gi"), "your");

  const otherFirstNames = (otherNames ?? [])
    .map(n => n.trim().split(/\s+/)[0]?.toLowerCase())
    .filter(Boolean);
  const firstNameCollides = first && otherFirstNames.includes(first.toLowerCase());

  if (first && first.length > 1 && !firstNameCollides) {
    out = out.replace(new RegExp(`\\b${escapeRegex(first)}'s\\b`, "gi"), "your");
  }
  // Standalone: full name then first name so we don't break "Yankı Ekin Yüksel"
  out = out.replace(new RegExp(`\\b${escapeRegex(full)}\\b`, "gi"), "you");
  if (first && first.length > 1 && !firstNameCollides) {
    out = out.replace(new RegExp(`\\b${escapeRegex(first)}\\b`, "gi"), "you");
  }
  return out;
}


// ──────────────────────────────────────────────────────────────────────
// ── 2. Presentation cache keys ──
// ──────────────────────────────────────────────────────────────────────

/** Cache namespace for opportunity presentation copy. Bump to invalidate copy safety changes. */
export const OPPORTUNITY_PRESENTATION_CACHE_VERSION = "v2";

export function buildRadarCardPresentationCacheKey(
  opportunityId: string,
  status: string,
  viewerId: string,
  focusedViewerIntentId?: string,
): string {
  const scope = focusedViewerIntentId ? `:intent:${focusedViewerIntentId}` : "";
  return `radar:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${status}:${viewerId}${scope}`;
}

export function buildApiChatCardPresentationCacheKey(
  opportunityId: string,
  viewerId: string,
): string {
  return `chat:${OPPORTUNITY_PRESENTATION_CACHE_VERSION}:card:${opportunityId}:${viewerId}`;
}


// ──────────────────────────────────────────────────────────────────────
// ── 3. Safe-presentation pipeline ──
// ──────────────────────────────────────────────────────────────────────

/**
 * Shared safe-presentation primitive for all user-facing opportunity surfaces.
 *
 * Historically every surface (radar, list/discover cards, minimal chat
 * cards, notification emails/Telegram, chat context, delivery cards) invented
 * its own fallback chain for the case where genuine LLM presenter output is
 * unavailable — some sliced raw `interpretation.reasoning` with no
 * sanitization at all. This module is the single standard:
 *
 *   raw reasoning
 *     → whitespace-normalize
 *     → viewer-centric rewrite (incl. UUID stripping)
 *     → boundary-aware truncation
 *     → per-surface empty-text default
 *
 * Surfaces choose *policy* (send a sanitized fallback vs skip entirely) via
 * `allowFallback`; they no longer choose (or forget) sanitization steps.
 *
 * See `packages/protocol/s./opportunity/AGENTS.md` for the review checklist this
 * module exists to satisfy.
 */


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
  /** Max output length (boundary-aware). Default {@link SAFE_FALLBACK_MAX_CHARS}. */
  maxChars?: number;
  /** Copy returned when reasoning is empty/blank. Default {@link DEFAULT_EMPTY_FALLBACK_TEXT}. */
  emptyText?: string;
}

/**
 * Produce safe user-facing fallback copy from raw match reasoning.
 *
 * This is the ONE sanitization standard: UUID stripping,
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
  const claimSafeInput = stripUnsupportedOpportunityClaims(normalized);
  if (!claimSafeInput) return emptyText;

  // viewerCentricCardSummary handles UUID stripping,
  // stripping, and the viewer-centric rewrite. Pass Infinity so truncation is
  // handled by boundary-aware logic below instead of a mid-word hard slice.
  const rewritten = viewerCentricCardSummary(
    claimSafeInput,
    opts.counterpartName ?? "",
    Number.POSITIVE_INFINITY,
    opts.viewerName,
  );

  // Claim validation intentionally runs after viewer-centric rewriting: rewrite
  // heuristics may select or join different source sentences, and the final
  // user-facing sentence set is what must be safe.
  const claimSafe = stripUnsupportedOpportunityClaims(rewritten);
  const truncated = truncateAtBoundary(claimSafe, maxChars);
  return truncated || emptyText;
}

/** Minimal presenter-output shape the primitive inspects (subset of CardPresentationResult). */
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
 *    NOT tagged `isFallback` by the presenter) — claim-validated before return.
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
    const summary = stripUnsupportedOpportunityClaims(candidate.personalizedSummary);
    if (summary) {
      return {
        headline:
          stripUnsupportedOpportunityClaims(candidate.headline) ||
          DEFAULT_FALLBACK_HEADLINE,
        summary,
        suggestedAction:
          stripUnsupportedOpportunityClaims(candidate.suggestedAction) ||
          DEFAULT_FALLBACK_ACTION,
        isFallback: false,
      };
    }
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


// ──────────────────────────────────────────────────────────────────────
// ── 4. OpportunityPresenter ──
// ──────────────────────────────────────────────────────────────────────

/**
 * Opportunity Presenter Agent
 *
 * Generates personalized, second-person explanations of why an opportunity
 * matters to the viewing user. Uses full opportunity data (interpretation,
 * actors, profiles, intents, index) to produce headline, personalizedSummary,
 * and suggestedAction for chat tools and user-facing surfaces.
 */




/**
 * Minimal database interface required by gatherPresenterContext.
 * Any database adapter that implements these three methods can be passed.
 */
export type PresenterDatabase = Pick<
  CompositeToolDatabase,
  "getProfile" | "getActiveIntents" | "getNetwork"
>;

const presentLog = protocolLogger("OpportunityPresenter:present");
const presentCardLog = protocolLogger("OpportunityPresenter:presentCard");
const LLM_TIMEOUT_MS = 20_000;


const GREETING_DESCRIPTION =
  "A 2-4 sentence first-person message the viewer could send to the counterpart, in the viewer's voice, referencing what they have in common. Plain prose only — no markdown, no greeting prefix like 'Hey {Name},'. Example body: 'Saw we're both working on regenerative coordination tooling — your post on consent flows resonated. Would love to compare notes if you have time this week.'";

// ──────────────────────────────────────────────────────────────
// SCHEMA & TYPES
// ──────────────────────────────────────────────────────────────

const PresentationSchema = z.object({
  headline: z
    .string()
    .describe(
      "Short, compelling headline for this opportunity (e.g., 'A React expert who needs your design skills')",
    ),
  personalizedSummary: z
    .string()
    .describe(
      "2-3 sentence explanation using 'you' language, explaining why this opportunity is specifically valuable for the viewer based on their intents and profile",
    ),
  suggestedAction: z.string().describe("Brief suggested next step"),
  greeting: z.string().max(500).describe(GREETING_DESCRIPTION),
});

const responseFormat = z.object({
  presentation: PresentationSchema,
});

export type OpportunityPresentationResult = z.infer<typeof PresentationSchema> & {
  /** True when any output field used resilience fallback copy. */
  isFallback?: boolean;
  /** Diagnostic category; never changes production fallback policy. */
  fallbackReason?: "timeout" | "error" | "sanitization";
};

/** Input for card presenter call; extends PresenterInput with optional mutual intent count. */
export interface CardPresenterInput extends PresenterInput {
  /** Number of overlapping intents (for generating mutualIntentsLabel). */
  mutualIntentCount?: number;
  /**
   * Snapshot of the opportunity's negotiation, if one exists. When status is
   * `negotiating`, the presenter returns a templated chip without invoking
   * the LLM. For `pending`/`accepted`/`rejected`, the full
   * transcript and outcome ground the LLM's explanation.
   */
  negotiationContext?: NegotiationContext;
}

/** LLM-generated fields for card presentation (buttons are hardcoded by callers, not LLM-generated). */
export const CardLLMSchema = z.object({
  headline: z
    .string()
    .describe("Short, compelling headline for this opportunity"),
  personalizedSummary: z
    .string()
    .describe(
      "2-3 sentence explanation in 'you' language for the main card body",
    ),
  suggestedAction: z
    .string()
    .describe("Brief suggested next step (e.g. CTA line)"),
  narratorRemark: z
    .string()
    .max(80)
    .describe(
      "One short sentence for the narrator chip, max ~80 chars (e.g. who is suggesting and why)",
    ),
  mutualIntentsLabel: z
    .string()
    .max(48)
    .describe(
      "Short line for the subtitle under the other party name (e.g. '3 mutual intents', 'Shared interests', 'Aligned goals'). NEVER output '0 mutual intents' — use a qualitative phrase like 'Shared interests' when no numeric count is available.",
    ),
  greeting: z.string().max(500).describe(GREETING_DESCRIPTION),
});

/** LLM-generated result from presentCard (callers append button labels from opportunity.constants). */
export type CardLLMResult = z.infer<typeof CardLLMSchema> & {
  /**
   * True when the LLM call failed and this is fallback-shaped copy built from
   * raw match reasoning. Callers with strict quality requirements (digests,
   * long-lived caches) should check this before sending/persisting — fallback
   * output is otherwise indistinguishable from genuine LLM output.
   */
  isFallback?: boolean;
};

/** Full card display contract including hardcoded button labels (assembled by callers). */
export type CardPresentationResult = CardLLMResult & {
  primaryActionLabel: string;
  secondaryActionLabel: string;
};

const homeCardResponseFormat = z.object({
  presentation: CardLLMSchema,
});

/** Input for a single presenter call (all context pre-assembled). */
export interface PresenterInput {
  viewerContext: string;
  otherPartyContext: string;
  matchReasoning: string;
  category: string;
  confidence: number;
  signalsSummary: string;
  indexName: string;
  viewerRole: string;
  opportunityStatus?: string;
  /** True when this opportunity was created via an explicit introduction (not automatic discovery). */
  /** Name of the person who made the introduction, if applicable. */
}

// ──────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
You are an expert at presenting connection opportunities to users in a way that feels personal and compelling.

Your goal: Given raw context about the viewer (their profile, intents), the other person(s), and why the system matched them, produce a short headline, a personalized summary, and a suggested action.

Rules:
1. Address the VIEWER directly using "you" and "your". This is for them.
2. Be concise and compelling — not analytical or third-party. No "The source user" or "The candidate"; use names or "they" where needed.
3. Do not leak private or confidential details. Use only the context provided.
4. Vary user-facing nouns naturally. Do not repeatedly use the same label in one response.
5. If possible, avoid repeating "opportunity" in both headline and summary. Prefer alternatives like "connection", "thought partner", "mutual fit", "valuable conversation", or "peer".
6. Prefer first names in user-facing copy. Do not repeatedly use full names unless needed to disambiguate.
7. Network assignment, network title/type, and network/event metadata are retrieval context only. They are NEVER proof that a person attended or will attend, belongs to a group, resides in a place, knows anyone from the network, or shared a session, time, place, or location with anyone. Do not make co-attendance, membership, residence, shared-session, or same-place/same-time claims from network co-membership.


**Role-Specific Presentation:**


**If viewer is "patient" or "party":**
- Reference their specific intents, skills, or interests that align with this opportunity.
- If this is an introduction: mention who introduced them and frame it as a personal recommendation.
- Headline: one short line that hooks (e.g., "[Name] thinks you should meet [Other]" or "A React expert who needs your design skills").
- Personalized summary: 2-3 sentences. Why is this opportunity for *them*? If introduced, lead with the introduction.
- Suggested action: encourage action ("Send a message to start the conversation" or "Share this intro").

**If viewer is "agent":**
- They are seeing this because someone already reached out.
- If this is an introduction: mention who made the introduction.
- Reference their skills/expertise that make them a match.
- Headline: what the other person needs that they can provide.
- Personalized summary: 2-3 sentences. Why someone reached out to them.
- Suggested action: "Someone is interested in connecting — check their message" or "Review and respond".

**If viewer is "peer":**
- Mutual opportunity. Reference shared or complementary interests.
- If this is an introduction: mention who connected them.
- Headline: the mutual connection angle.
- Personalized summary: 2-3 sentences. Why this is mutually valuable.
- Suggested action: "Send an intro to connect" or "Start a conversation".
`;

const homeCardSystemPrompt = `
You are an expert at presenting connection opportunities for an opportunity card.

Given context about the viewer, the other person, and why they were matched, produce:
1. headline: one short hook line.
2. personalizedSummary: 2-3 sentences in "you" language (main body text).
3. suggestedAction: one brief suggested next step.
4. narratorRemark: one short sentence for the narrator chip (who is suggesting and why; max ~80 chars).
5. greeting: a 2-4 sentence first-person message the viewer could send to the counterpart. Plain prose, no greeting prefix, no markdown.
7. mutualIntentsLabel: short subtitle under the other party's name. Examples: "3 mutual intents", "Shared interests", "Aligned goals" — keep it brief. NEVER output "0 mutual intents" or any zero-count label; use a qualitative phrase instead.

Rules:
- Address the viewer with "you"/"your". Be concise and compelling.
- narratorRemark should feel like a single sentence from the narrator (Index or a person), not meta-commentary.
- narratorRemark is displayed with the narrator name prepended (e.g. "Index: …" or "Alice: …"). Do NOT start narratorRemark with the narrator's name or repeat it; write only the remark (e.g. "Based on your overlapping intents" or "introduced you two, sensing a valuable connection").
- Vary wording for the match itself. Do not repeat "opportunity" across headline, summary, and narratorRemark when alternatives fit.
- Prefer first names in user-facing copy. Avoid repeated full names unless disambiguation is necessary.
- Network assignment, network title/type, and network/event metadata are retrieval context only. They are NEVER proof that a person attended or will attend, belongs to a group, resides in a place, knows anyone from the network, or shared a session, time, place, or location with anyone. Do not make co-attendance, membership, residence, shared-session, or same-place/same-time claims from network co-membership.
- If you cannot fit every detail, choose one clear reason and stop. Do not rely on downstream truncation.

**Negotiation-grounded explanations (ONLY when NEGOTIATION CONTEXT is provided):**
When NEGOTIATION CONTEXT is provided, this opportunity passed through an agent-to-agent negotiation. Use the transcript to ground your explanation in the concrete reasoning the agents exchanged.
- Personalize the summary with *why* the negotiation produced this match — reference the roles the agents agreed on, the specific concerns raised, and how they were resolved.
- For status "accepted": the agents agreed; the card should confidently explain *why* they agreed.
- For status "rejected": the agents declined. The card should explain the reason briefly so the user understands — not dwell on it.
- Do NOT invent turn content. Only reference what is in the NEGOTIATION CONTEXT block.

`;

// ──────────────────────────────────────────────────────────────
// DETERMINISTIC OUTPUT VALIDATION
// ──────────────────────────────────────────────────────────────

function sanitizePresenterField(
  value: string,
  fallback: string,
  allowEmpty = fallback === "",
): { value: string; usedFallback: boolean } {
  const cleaned = stripUnsupportedOpportunityClaims(stripUuids(value));
  if (cleaned || allowEmpty) {
    return { value: cleaned, usedFallback: false };
  }
  return { value: fallback, usedFallback: true };
}

// ──────────────────────────────────────────────────────────────
// CLASS
// ──────────────────────────────────────────────────────────────

export class OpportunityPresenter {
  private model: Runnable;
  private homeCardModel: Runnable;

  constructor() {
    this.model = createStructuredModel("opportunityPresenter", responseFormat, {
      name: "opportunity_presenter",
    });
    this.homeCardModel = createStructuredModel("opportunityPresenter", homeCardResponseFormat, {
      name: "opportunity_presenter_home_card",
    });
  }

  private async invokeWithTimeout(
    targetModel: Runnable,
    messages: (SystemMessage | HumanMessage)[],
    signal?: AbortSignal,
  ): Promise<unknown> {
    const timeoutReason = `LLM invoke timed out after ${LLM_TIMEOUT_MS}ms`;
    const controller = new AbortController();
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const combinedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
    const invokePromise = targetModel.invoke(messages, { signal: combinedSignal });

    const timeoutPromise = new Promise<never>((_, reject) => {
      timeoutId = setTimeout(() => {
        controller.abort(timeoutReason);
        reject(new Error(timeoutReason));
      }, LLM_TIMEOUT_MS);
    });

    try {
      return await Promise.race([invokePromise, timeoutPromise]);
    } finally {
      if (timeoutId) {
        clearTimeout(timeoutId);
      }
    }
  }

  /**
   * Generate personalized presentation for a single opportunity.
   */
  @Timed()
  public async present(
    input: PresenterInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<OpportunityPresentationResult> {
    const humanContent = `
VIEWER (the person seeing this opportunity):
${input.viewerContext}

OTHER PARTY:
${input.otherPartyContext}

MATCH CONTEXT:
- Category: ${input.category}
- Confidence: ${input.confidence}
- Why we matched: ${input.matchReasoning}
- Signals: ${input.signalsSummary}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}

Produce headline, personalizedSummary (2-3 sentences in "you" language), suggestedAction, and greeting.
`;

    try {
      const messages = [
        new SystemMessage(systemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.model, messages, options.signal);
      const parsed = responseFormat.parse(result);
      const headline = sanitizePresenterField(
        parsed.presentation.headline,
        DEFAULT_FALLBACK_HEADLINE,
      );
      const summary = sanitizePresenterField(
        parsed.presentation.personalizedSummary,
        DEFAULT_EMPTY_FALLBACK_TEXT,
      );
      const action = sanitizePresenterField(
        parsed.presentation.suggestedAction,
        DEFAULT_FALLBACK_ACTION,
      );
      const greeting = sanitizePresenterField(parsed.presentation.greeting, "");
      const usedFallback = headline.usedFallback || summary.usedFallback || action.usedFallback || greeting.usedFallback;
      return {
        headline: headline.value,
        personalizedSummary: summary.value,
        suggestedAction: action.value,
        greeting: greeting.value,
        ...(usedFallback ? { isFallback: true, fallbackReason: "sanitization" as const } : {}),
      };
    } catch (e) {
      if (options.signal?.aborted) throw e;
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      presentLog.warn(
        "LLM failed, returning fallback",
        {
          event: "presenter_fallback",
          presenter: "opportunity",
          reason: timeoutReason ? "timeout" : "parse_error",
          message,
          timeoutReason,
        },
      );
      return {
        headline: DEFAULT_FALLBACK_HEADLINE,
        personalizedSummary: safeFallbackSummary(input.matchReasoning),
        suggestedAction: DEFAULT_FALLBACK_ACTION,
        greeting: "",
        isFallback: true,
        fallbackReason: timeoutReason ? "timeout" : "error",
      };
    }
  }

  /**
   * Generate LLM-powered card content (headline, body, narrator remark, mutual-intent label).
   * Callers append button labels from opportunity.constants.
   *
   * When `negotiationContext.status === 'negotiating'`, returns a templated
   * chip synchronously without invoking the LLM — the card just reflects
   * "negotiation in progress" at that point.
   */
  @Timed()
  public async presentCard(
    input: CardPresenterInput,
  ): Promise<CardLLMResult> {
    if (input.negotiationContext?.status === 'negotiating') {
      return buildNegotiatingChip(input);
    }

    const mutualHint =
      input.mutualIntentCount != null && input.mutualIntentCount > 0
        ? `There are ${input.mutualIntentCount} overlapping intent(s) between viewer and other party.`
        : "Match is based on profile and intent alignment. Do not cite a numeric intent count.";
    const negotiationBlock = buildNegotiationPromptBlock(input.negotiationContext);
    // When negotiation context exists, lead with it — these cards exist
    // *because* the negotiation happened. Trailing the block lets weaker
    // models lean on surface signals and ignore the transcript entirely.
    const negotiationDirective = negotiationBlock
      ? `\nIMPORTANT: This opportunity surfaced because the agents negotiated and converged. Your personalizedSummary MUST reference at least one specific signal from the NEGOTIATION CONTEXT block below — what concern was raised, what was confirmed, what the agents agreed on. It must communicate *why this specific match* surfaced now (the negotiation that led to it), not a generic skill-complementarity line. Do not produce the generic summary every card looked like before this negotiation happened.\n`
      : "";
    const humanContent = `
${negotiationBlock}${negotiationDirective}
VIEWER (the person seeing this opportunity):
${input.viewerContext}

OTHER PARTY:
${input.otherPartyContext}

MATCH CONTEXT:
- Category: ${input.category}
- Confidence: ${input.confidence}
- Why we matched: ${input.matchReasoning}
- Signals: ${input.signalsSummary}
- ${mutualHint}
COMMUNITY: ${input.indexName}
Viewer's role in this opportunity: ${input.viewerRole}
Opportunity status: ${input.opportunityStatus ?? "pending"}

Produce headline, personalizedSummary, suggestedAction, narratorRemark, greeting, and mutualIntentsLabel.
`;


    try {
      const messages = [
        new SystemMessage(homeCardSystemPrompt),
        new HumanMessage(humanContent),
      ];
      const result = await this.invokeWithTimeout(this.homeCardModel, messages);
      const parsed = homeCardResponseFormat.parse(result);
      if (/^0\s+(mutual|overlapping)\s+intent/i.test(parsed.presentation.mutualIntentsLabel)) {
        parsed.presentation.mutualIntentsLabel = "Shared interests";
      }

      const fields = {
        headline: sanitizePresenterField(parsed.presentation.headline, DEFAULT_FALLBACK_HEADLINE),
        personalizedSummary: sanitizePresenterField(parsed.presentation.personalizedSummary, DEFAULT_EMPTY_FALLBACK_TEXT),
        suggestedAction: sanitizePresenterField(parsed.presentation.suggestedAction, DEFAULT_FALLBACK_ACTION),
        narratorRemark: sanitizePresenterField(parsed.presentation.narratorRemark, "Worth a look."),
        mutualIntentsLabel: sanitizePresenterField(
          parsed.presentation.mutualIntentsLabel,
          "Shared interests",
        ),
        greeting: sanitizePresenterField(parsed.presentation.greeting, ""),
      };
      const usedFallback = Object.values(fields).some((field) => field.usedFallback);
      return {
        headline: fields.headline.value,
        personalizedSummary: fields.personalizedSummary.value,
        suggestedAction: fields.suggestedAction.value,
        narratorRemark: fields.narratorRemark.value,
        mutualIntentsLabel: fields.mutualIntentsLabel.value,
        greeting: fields.greeting.value,
        ...(usedFallback ? { isFallback: true } : {}),
      };
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const timeoutReason = message.includes("timed out") ? message : undefined;
      presentCardLog.warn(
        "LLM failed, returning fallback",
        {
          event: "presenter_fallback",
          presenter: "home_card",
          reason: timeoutReason ? "timeout" : "parse_error",
          message,
          timeoutReason,
        },
      );
      const fallbackSummary = safeFallbackSummary(input.matchReasoning);
      return {
        headline: "A promising connection",
        personalizedSummary: fallbackSummary,
        suggestedAction: "Take a look and decide whether to reach out.",
        narratorRemark: "Worth a look.",
        mutualIntentsLabel:
          input.mutualIntentCount != null && input.mutualIntentCount > 0
            ? `${input.mutualIntentCount} mutual intent${input.mutualIntentCount !== 1 ? "s" : ""}`
            : "Shared interests",
        greeting: "",
        isFallback: true,
      };
    }
  }

  /**
   * Process multiple opportunities in parallel with bounded concurrency.
   */
  @Timed()
  public async presentBatch(
    inputs: PresenterInput[],
    options?: { concurrency?: number },
  ): Promise<OpportunityPresentationResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: OpportunityPresentationResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((inp) => this.present(inp)),
      );
      results.push(...chunkResults);
    }
    return results;
  }

  /**
   * Process multiple opportunities as cards in parallel with bounded concurrency.
   * Returns full card display contracts (headline, body, narrator remark, action labels, mutual-intent label).
   */
  @Timed()
  public async presentCardBatch(
    inputs: CardPresenterInput[],
    options?: { concurrency?: number },
  ): Promise<CardLLMResult[]> {
    const concurrency = options?.concurrency ?? 5;
    const results: CardLLMResult[] = [];
    for (let i = 0; i < inputs.length; i += concurrency) {
      const chunk = inputs.slice(i, i + concurrency);
      const chunkResults = await Promise.all(
        chunk.map((inp) => this.presentCard(inp)),
      );
      results.push(...chunkResults);
    }
    return results;
  }
}

// ──────────────────────────────────────────────────────────────
// NEGOTIATION CONTEXT HELPERS
// ──────────────────────────────────────────────────────────────

/**
 * Builds a "NEGOTIATION CONTEXT:" block for the card prompt. Returns an
 * empty string when the opportunity has no meaningful negotiation context
 * (draft/latent) or when the opportunity is still negotiating (handled via
 * the templated chip, not the LLM).
 */
function buildNegotiationPromptBlock(context: NegotiationContext | undefined): string {
  if (!context || context.status === 'negotiating') return "";

  const outcomeLabel = context.outcome === 'agreed'
    ? "the agents agreed"
    : context.outcome === 'declined'
      ? "one agent declined"
      : context.outcome === 'closed'
        ? "the negotiation was closed before it settled"
        : undefined;

  const turnLines = context.turns.map((turn, index) =>
    `Turn ${index + 1} (${turn.action}, ${turn.own ? "your agent" : "their agent"}): "${turn.message}"`);

  return `
NEGOTIATION CONTEXT:
- Negotiation status: ${context.status}${outcomeLabel ? ` (${outcomeLabel})` : ""}
- Turns exchanged: ${context.turnCount}
- Transcript:
${turnLines.length > 0 ? turnLines.map((l) => `  ${l}`).join("\n") : "  (no turns recorded)"}
`;
}

/**
 * Builds a templated card result for an opportunity whose negotiation
 * is still in progress. Bypasses the LLM so users see a stable "currently
 * negotiating" chip while turns are still being exchanged.
 */
function buildNegotiatingChip(input: CardPresenterInput): CardLLMResult {
  const turnCount = input.negotiationContext?.turnCount ?? 0;
  const narratorRemark = `Currently negotiating · turn ${turnCount}`;

  return {
    headline: "Negotiation in progress",
    personalizedSummary: "Your agent is still talking with theirs to see if this connection makes sense. We'll surface the full match as soon as they converge.",
    suggestedAction: "Check back shortly — no action needed yet.",
    narratorRemark,
    mutualIntentsLabel: input.mutualIntentCount && input.mutualIntentCount > 0
      ? `${input.mutualIntentCount} mutual intent${input.mutualIntentCount !== 1 ? "s" : ""}`
      : "Shared interests",
    greeting: "",
  };
}

// ──────────────────────────────────────────────────────────────
// CONTEXT GATHERER (used by tools)
// ──────────────────────────────────────────────────────────────

/**
 * Build the LLM-facing signal summary while excluding pool adjustments. Pool
 * disposition is rendered deterministically by the card chip; asking the
 * presenter to interpret it could turn a demotion into a positive rationale.
 */
export function summarizeSignalsForPresenter(
  signals: Opportunity['interpretation']['signals'],
): string {
  const safeSignals = signals?.filter((signal) => signal.type !== 'pool_discriminator') ?? [];
  if (safeSignals.length === 0) return 'Match based on profile and intent alignment.';
  return safeSignals.map((signal) => `${signal.type}: ${signal.detail ?? signal.type}`).join('; ');
}

/**
 * Gather all context needed for the presenter from the database.
 * Fetches viewer profile, viewer intents, other party profile(s), and index in parallel.
 *
 * @param displayCounterpartUserId - When set (e.g. for a radar card), only this counterpart is included in otherPartyContext so the presenter writes about the person on the card.
 * @param focusedViewerIntentId - When set, include only that active intent in viewer context.
 */
export async function gatherPresenterContext(
  database: PresenterDatabase,
  opportunity: Opportunity,
  viewerId: string,
  displayCounterpartUserId?: string,
  focusedViewerIntentId?: string,
): Promise<PresenterInput> {
  const myActor = opportunity.actors.find((a) => a.userId === viewerId);
  if (!myActor) {
    throw new Error("Viewer is not an actor in this opportunity");
  }

  const otherActors = opportunity.actors.filter((a) => a.userId !== viewerId);
  let otherPartyIds = [...new Set(otherActors.map((a) => a.userId))];
  if (displayCounterpartUserId && otherPartyIds.includes(displayCounterpartUserId)) {
    otherPartyIds = [displayCounterpartUserId];
  }

  const contextIndexId = opportunity.context?.networkId;

  // Viewer's profile + intents, plus the other party's profile.
  const [viewerProfile, indexRecord, ...otherProfiles] = await Promise.all([
    database.getProfile(viewerId),
    contextIndexId ? database.getNetwork(contextIndexId) : Promise.resolve(null),
    ...otherPartyIds.map((uid) => database.getProfile(uid)),
  ]);

  let viewerIntents:
    | Awaited<ReturnType<typeof database.getActiveIntents>>
    | undefined;

  viewerIntents = await database.getActiveIntents(viewerId);
  if (focusedViewerIntentId) {
    viewerIntents = viewerIntents.filter((intent) => intent.id === focusedViewerIntentId);
  }

  let viewerContext: string;
  let otherPartyContext: string;

  {
    const viewerContextLines = [
      "Profile:",
      `Name: ${viewerProfile?.identity?.name ?? "Unknown"}`,
      `Bio: ${viewerProfile?.identity?.bio ?? ""}`,
      `Location: ${viewerProfile?.identity?.location ?? ""}`,
      `Context: ${viewerProfile?.context ?? ""}`,
      "Active intents:",
      ...(viewerIntents?.length
        ? viewerIntents.map(
            (i) => `- ${i.payload}${i.summary ? ` (${i.summary})` : ""}`,
          )
        : ["(none listed)"]),
    ];
    viewerContext = viewerContextLines.join("\n");

    const otherParts = otherPartyIds.map((uid, idx) => {
      const profile = otherProfiles[idx] as Awaited<
        ReturnType<typeof database.getProfile>
      >;
      const name = profile?.identity?.name ?? "Unknown";
      const bio = profile?.identity?.bio ?? "";
      return `${name}: ${bio}`;
    });
    otherPartyContext =
      otherParts.join("\n\n") || "Other party (details not available).";
  }

  const interp = opportunity.interpretation;
  const signalsSummary = summarizeSignalsForPresenter(interp.signals);

  const counterpartName =
    otherPartyIds.length === 1 && otherProfiles[0]
      ? (otherProfiles[0] as { identity?: { name?: string } })?.identity?.name?.trim()
      : undefined;
  const viewerNameForFilter = viewerProfile?.identity?.name?.trim();
  const matchReasoning =
    counterpartName && interp.reasoning
      ? viewerCentricCardSummary(
          interp.reasoning,
          counterpartName,
          400,
          viewerNameForFilter,
        )
      : stripUuids(interp.reasoning);

  const result: PresenterInput = {
    viewerContext,
    otherPartyContext,
    matchReasoning,
    category: interp.category ?? "connection",
    confidence:
      typeof interp.confidence === "number"
        ? interp.confidence
        : parseFloat(String(interp.confidence ?? 0)) || 0,
    signalsSummary,
    indexName: indexRecord?.title ?? contextIndexId ?? "",
    viewerRole: myActor.role ?? "party",
  };

  return result;
}

// ──────────────────────────────────────────────────────────────────────
// ── 5. MCP card prose ──
// ──────────────────────────────────────────────────────────────────────

const CODE_FENCE = String.fromCharCode(96, 96, 96);

function sanitizeJsonForCodeFence(json: string): string {
  return json.replace(/`/g, '\\u0060');
}

/**
 * Minimal shape consumed by buildOpportunityPresentation for prose rendering.
 * Card data objects in the codebase carry additional frontend-only fields;
 * only these are surfaced to MCP agents.
 */
export type OpportunityCardLike = Record<string, unknown> & {
  opportunityId: string;
  userId?: string | undefined;
  name?: string | undefined;
  mainText?: string | undefined;
  status?: string | undefined;
  feedCategory?: string | undefined;
  profileUrl?: string | undefined;
  /** Universal link that opens this opportunity's card (`/o/<id>`). */
  appUrl?: string | undefined;
  score?: number | undefined;
};

function sanitizeOpportunityCardProse(card: OpportunityCardLike): OpportunityCardLike {
  const sanitized: OpportunityCardLike = { ...card };
  for (const key of ['mainText', 'headline', 'cta', 'mutualIntentsLabel'] as const) {
    const value = card[key];
    if (typeof value === 'string') {
      sanitized[key] = stripUnsupportedOpportunityClaims(stripUuids(value)) || 'A suggested connection.';
    }
  }
  const narratorChip = card.narratorChip;
  if (narratorChip && typeof narratorChip === 'object' && !Array.isArray(narratorChip)) {
    const narrator = narratorChip as Record<string, unknown>;
    if (typeof narrator.text === 'string') {
      sanitized.narratorChip = {
        ...narrator,
        text: stripUnsupportedOpportunityClaims(stripUuids(narrator.text)) || 'A potential connection worth exploring.',
      };
    }
  }
  return sanitized;
}

/**
 * Format opportunity cards into the "opportunities" portion of a tool response.
 *
 * Web chat (`isMcp=false`): emits ```opportunity``` code fences with an
 * "include EXACTLY as-is" directive so the frontend card renderer can parse
 * and render interactive cards.
 *
 * MCP (`isMcp=true`): emits prose (name, reason, status, appUrl and profileUrl
 * when present, feedCategory when present) and includes `opportunityId` for
 * every card so the agent can act via the tools. The trailing instruction
 * reminds the agent to synthesize in natural language, to surface the `appUrl`
 * verbatim as the one link that opens the card, and to fabricate no other URL.
 * MCP clients have no card renderer, so code fences would surface as raw JSON
 * to end users.
 */
export function buildOpportunityPresentation(
  inputCards: OpportunityCardLike[],
  opts: {
    isMcp: boolean;
    leadIn: string;
    label?: 'opportunity' | 'opportunities';
  },
): string {
  const cards = inputCards.map(sanitizeOpportunityCardProse);
  if (cards.length === 0) return opts.leadIn;

  if (opts.isMcp) {
    const prose = cards
      .map((card, i) => {
        const lines: string[] = [`${i + 1}. ${card.name ?? "Unknown"}`];
        if (card.mainText) lines.push(`   ${card.mainText}`);
        if (card.status) lines.push(`   status: ${card.status}`);
        if (card.appUrl) lines.push(`   appUrl: ${card.appUrl}`);
        if (card.profileUrl) lines.push(`   profileUrl: ${card.profileUrl}`);
        if (card.feedCategory) lines.push(`   feedCategory: ${card.feedCategory}`);
        lines.push(`   opportunityId: ${card.opportunityId}`);
        return lines.join("\n");
      })
      .join("\n\n");
    const idInstructions = `Use opportunityId values only when calling update_opportunity (send/accept/reject).`;
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `For each card that has a profileUrl, link the person's name to it. Some cards may have no URL — render those as plain text and never fabricate URLs for them. ` +
      `For each card that has an appUrl, show that link so the user can open the opportunity: it opens the card in the Index app when installed, and an Index web page otherwise. Show only an appUrl a tool returned — never assemble one from an opportunityId. ` +
      `No link accepts on the user's behalf: accepting happens in the Index app (or via update_opportunity) — never invent an accept URL. ` +
      `Do NOT print raw JSON, field labels, or opportunityIds. ` +
      `${idInstructions}`
    );
  }

  const label = opts.label ?? (cards.length === 1 ? "opportunity" : "opportunities");
  const blocks = cards
    .map(
      (card) =>
        CODE_FENCE + "opportunity\n" + sanitizeJsonForCodeFence(JSON.stringify(card)) + "\n" + CODE_FENCE,
    )
    .join("\n\n");
  return (
    `${opts.leadIn} IMPORTANT: Include the following ${CODE_FENCE}${label} code blocks EXACTLY as-is in your response (they render as interactive cards):\n\n${blocks}`
  );
}
