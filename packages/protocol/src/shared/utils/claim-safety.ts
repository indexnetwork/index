/**
 * Deterministic guard for unsupported person-affiliation and presence claims.
 *
 * Opportunity presentation contracts currently do not carry typed provenance
 * proving attendance, membership, residence, or shared presence. The guard
 * therefore fails closed: a sentence making one of those claims is rejected
 * rather than loosely "grounded" against network/context text.
 *
 * The patterns are deliberately phrase-based. They target factual claims such
 * as "Alice is a member of..." while leaving generic domain phrases such as
 * "membership model" and "team members" alone. This is not a general factuality
 * checker and does not attempt semantic inference beyond the listed claim
 * families.
 */

const UNSUPPORTED_CLAIM_PATTERNS: readonly RegExp[] = [
  // Attendance and co-attendance claims. Relational grammar avoids product
  // phrases such as "attendee management".
  /\b(?:co[-\s]?attendance|co[-\s]?attendee(?:s)?|co[-\s]?attend(?:ed|ing)?|(?:another|fellow)\s+(?:(?:event|session|conference|summit|gathering|meetup)\s+)?attendees?)\b/i,
  /\b(?:is|are|was|were|will be|has been|have been|as)\s+(?:an?\s+)?attendees?\b/i,
  /\b(?:a|an|this|that)\s+attendee\s+(?:of|at)\b/i,
  /\b(?:will\s+|plans?\s+to\s+)?attend(?:ed|ing)?\s+(?!to\b)(?:(?:at|in)\s+)?(?:the\s+)?[\p{L}\p{N}&'’.-]+\b/iu,
  /\b(?:is|are|was|were|will be)\s+going\s+to\s+(?:the\s+)?(?:event|session|conference|summit|gathering|meetup|[A-Z][\p{L}\p{N}&'’.-]*)\b/u,
  /\b(?:[Pp]articipat(?:ed|ing)|[Pp]articipants?)\b(?=.{0,40}\b(?:in|at)\s+(?:the\s+)?(?:event|session|conference|summit|gathering|meetup|[A-Z][\p{L}\p{N}&'’.-]*))/u,
  /\b(?:[Ww]ent\s+to|[Tt]ook\s+part\s+in|(?:[Ww]as|[Ww]ere|[Ii]s|[Aa]re)\s+present\s+at)\s+(?:the\s+)?(?:event|session|conference|summit|gathering|meetup|[A-Z][\p{L}\p{N}&'’.-]*)\b/u,
  /\b(?:session\s+attendance|attendance\s+(?:at|in)\s+(?:the\s+)?(?:event|session|conference|summit|gathering|meetup))\b/i,

  // Shared event/session/place/time claims, including "both were at ...".
  /\b(?:same|the same)\s+(?:event|session|place|location|venue|time)\b/i,
  /\b(?:share|shared|sharing)\s+(?:an?\s+|the\s+)?(?:event|session|workshop|conference|summit|gathering|meetup|place|location|venue|time)\b/i,
  /\bboth\s+(?:were|are|will be|have been)\s+(?:at|in|during)\b/i,
  /\b(?:were|are|will be|have been)\s+both\s+(?:at|in|during)\b/i,
  /\b(?:will|would|are|were)\s+both\s+be?\s*(?:at|in|during)\b/i,
  /\bboth\b.{0,80}\b(?:attend(?:ed|ing)?|participat(?:e|ed|ing)|met|meet|meeting|stayed|stay)\b.{0,60}\b(?:event|session|place|location|venue|time)\b/i,

  // Factual membership/affiliation claims. Generic descriptions of product
  // users ("members of cooperatives") and "team members" stay untouched.
  /\b(?:is|are|was|were|be|being|been|became|become|as)\s+(?:an?\s+)?(?:fellow\s+)?members?\s+(?:of|in)\b/i,
  /\b(?:another|fellow)\s+members?\b/i,
  /\b(?:is|are|was|were|be|being|been|as)\s+(?:an?\s+)?(?:community|network|event)\s+members?\b/i,
  /\b(?:a|an|this|that)\s+(?:fellow\s+)?member\s+(?:of|in)\b/i,
  /\b(?:is|are|was|were|be|being|been)\s+(?:an?\s+)?part\s+of\s+(?:the\s+)?[^.!?]{0,60}\b(?:community|network|event)\b/i,
  /\bfellow\s+members?\s+(?:of|in)\b/i,
  /\b(?:a|an)\s+(?:[A-Z][\p{L}\p{N}&'’.-]*\s+){1,6}(?:community\s+|network\s+)?member\b/u,
  /\b(?:[Bb]elongs?|[Bb]elonged)\s+to\s+(?:the\s+)?(?:[Nn]etwork|[Cc]ommunity|[Ee]vent|(?:[A-Z][\p{L}\p{N}&'’.-]*\s+){1,5}[A-Z][\p{L}\p{N}&'’.-]*)\b/u,
  /\b[Jj]oined\s+(?:the\s+)?(?:[Nn]etwork|[Cc]ommunity|[Ee]vent|(?:[A-Z][\p{L}\p{N}&'’.-]*\s+){1,5}[A-Z][\p{L}\p{N}&'’.-]*)\b/u,
  /\b[Aa]ffiliated\s+with\s+(?:the\s+)?(?:[Nn]etwork|[Cc]ommunity|[Ee]vent|[A-Z][\p{L}\p{N}&'’.-]*)\b/u,

  // Residence/co-residence claims. Require person-claim grammar so generic
  // audience descriptions such as "tools for residents of Berlin" survive.
  /\b(?:is|are|was|were|be|being|been|as)\s+(?:an?\s+)?(?:local\s+|long[-\s]?time\s+|co[-\s]?)?residents?\b/i,
  /\bco[-\s]?(?:reside|resides|resided|residing)\b/i,
  /\b(?:another|fellow)\s+residents?\b/i,
  /\b(?:a|an|this|that)\s+(?:co[-\s]?)?resident\s+(?:of|in)\b/i,
  /\b(?:a|an)\s+(?:[A-Z][\p{L}\p{N}&'’.-]*\s+){1,6}(?:co[-\s]?)?resident\b/u,
  /\b(?:[Hh]e|[Ss]he|[Tt]hey|[A-Z][\p{L}'’.-]+)\s+(?:reside|resides|resided|residing|live|lives|lived|living|(?:is|are|was|were)\s+based)\s+in\b/u,
  /\b(?:[Hh]e|[Ss]he|[Tt]hey|[A-Z][\p{L}'’.-]+)\s+calls?\s+[A-Z][\p{L}\p{N}&'’.-]*(?:\s+[A-Z][\p{L}\p{N}&'’.-]*){0,5}\s+home\b/u,

  // Relationship claims inferred from shared network/event placement.
  /\b(?:know|knows|knew|met|meet)\b.{0,60}\b(?:through|from|at)\s+(?:the\s+)?(?:network|community|event|session)\b/i,
  /\bcrossed\s+paths\s+(?:at|during)\b/i,
];

/** Returns true when text contains an unsupported affiliation/presence claim. */
export function hasUnsupportedOpportunityClaim(text: string | null | undefined): boolean {
  if (!text?.trim()) return false;
  return splitClaimSentences(text).some(isUnsupportedOpportunityClaimSentence);
}

/** Returns true when one sentence contains an unsupported claim family. */
export function isUnsupportedOpportunityClaimSentence(sentence: string): boolean {
  return UNSUPPORTED_CLAIM_PATTERNS.some((pattern) => pattern.test(sentence));
}

/**
 * Removes complete sentences containing unsupported claims and preserves the
 * remaining sentence order. An all-unsafe input becomes an empty string so the
 * caller can apply a field-specific deterministic default.
 */
export function stripUnsupportedOpportunityClaims(text: string | null | undefined): string {
  if (!text?.trim()) return "";
  return splitClaimSentences(text)
    .filter((sentence) => !isUnsupportedOpportunityClaimSentence(sentence))
    .join(" ")
    .replace(/\s+/g, " ")
    .trim();
}

function splitClaimSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}
