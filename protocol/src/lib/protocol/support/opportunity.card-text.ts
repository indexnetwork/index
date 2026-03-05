/**
 * Viewer-centric text for opportunity cards.
 * The card is shown to the viewer (logged-in user) and should introduce the
 * counterpart, not describe the viewer to themselves.
 */

import { MINIMAL_MAIN_TEXT_MAX_CHARS } from "./opportunity.constants";
import { stripUuids, stripIntroducerMentions } from "./opportunity.sanitize";

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
 * @param introducerName - Optional display name of the introducer. When provided, introducer phrases (e.g., "X introduced you to...") are stripped from the summary to keep the body text focused on match quality.
 * @returns Viewer-centric snippet mentioning the counterpart when possible; if counterpartName is empty, returns reasoning truncated to maxChars. Never null; may be "A suggested connection." when reasoning is empty.
 */
export function viewerCentricCardSummary(
  reasoning: string,
  counterpartName: string,
  maxChars: number = MINIMAL_MAIN_TEXT_MAX_CHARS,
  viewerName?: string,
  introducerName?: string,
): string {
  const raw = stripUuids(reasoning);
  if (!raw) return "A suggested connection.";

  const name = counterpartName.trim();
  if (!name) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    // Strip introducer mentions BEFORE replacing viewer name to avoid "you introduced..." artifacts
    if (introducerName) {
      out = stripIntroducerMentions(out, introducerName);
    }
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
      // Strip introducer mentions BEFORE replacing viewer name to avoid "you introduced..." artifacts
      if (introducerName) {
        out = stripIntroducerMentions(out, introducerName);
      }
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
        // Strip introducer mentions BEFORE replacing viewer name to avoid "you introduced..." artifacts
        if (introducerName) {
          out = stripIntroducerMentions(out, introducerName);
        }
        out = replaceViewerNameWithYou(out, viewerName, [name]);
        return out;
      }
    }
  }

  // Fallback: original logic without viewer awareness
  const idx = sentences.findIndex(hasCounterpartName);
  if (idx === -1) {
    let out = raw.length <= maxChars ? raw : raw.slice(0, maxChars) + "...";
    // Strip introducer mentions BEFORE replacing viewer name to avoid "you introduced..." artifacts
    if (introducerName) {
      out = stripIntroducerMentions(out, introducerName);
    }
    out = replaceViewerNameWithYou(out, viewerName, [name]);
    return out;
  }

  const fromCounterpart = sentences.slice(idx).join(" ").trim();
  let out =
    fromCounterpart.length <= maxChars
      ? fromCounterpart
      : fromCounterpart.slice(0, maxChars) + "...";
  // Strip introducer mentions BEFORE replacing viewer name to avoid "you introduced..." artifacts
  if (introducerName) {
    out = stripIntroducerMentions(out, introducerName);
  }
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
 * This is a regex-based heuristic — an alternative is OpportunityPresenter.presentHomeCard()
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
  const raw = stripUuids(reasoning).trim();
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

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
