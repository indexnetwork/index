/**
 * Bounded disclosure checks, not a semantic fact checker or a rewrite
 * mechanism.
 *
 * Ported verbatim from Sydney-Levine-Lab/decision-studio custom-negotiator
 * src/intervention/publication.ts (commit 196153c), with the lab's
 * cooperation for the MoralMod × Index integration.
 */

const mechanics = [
  /\bmoral\s*mod\b|\bconstruals?\b/iu,
  /\b(?:aggregate|combined|joint)\s+(?:(?:moral|action)\s+)?(?:value|welfare|utility)\s*(?:score|objective|mean|of|is|=)/iu,
  /\b(?:utility|welfare|severity)\s+(?:function|scores?|samples?|means?|estimates?)\b/iu,
  /\b(?:confidence|probability)\s*(?:(?:is|of|=|:|at)\s*)?\d+(?:\.\d+)?(?:\s*%)?/iu,
  /\b(?:low|weak|high|strong|modeled|modelled)\s+endorsement\b|\bendorsement\s*(?:score|(?:is\s*)?[0-9]|[=:])/iu,
  /\brule\s+severity\s*(?:is|score|[=:]|\d)|\b(?:sample|draw)\s+count\s*(?:[=:]|is\s*\d)/iu,
  /\b(?:gaussian[\s\p{Pd}]+process|native\s+(?:draws?|samples?)|modeled\s+(?:draws?|samples?)|aligned\s+draws?)\b/iu,
  /\b(?:assessment_choice|assessment_divergence|preferredActionId|policy_decision_id|confidence_ge|confidence_all_ge|minimum_endorsement|snapshot_sha256)\b/iu,
];

/**
 * @param texts - Outgoing messages.
 * @param identifiers - Private run/artifact ids (8+ chars) that must never appear.
 * @returns "blocked" when any text names the mechanism or leaks an identifier.
 */
export function publicationCheck(texts: readonly string[], identifiers: readonly string[] = []): "passed" | "blocked" {
  const privateIds = identifiers.filter((id) => typeof id === "string" && id.length >= 8);
  for (const raw of texts) {
    const text = raw.normalize("NFKC").replace(/[\u200B-\u200D\uFEFF]/gu, "");
    if (mechanics.some((pattern) => pattern.test(text)) || privateIds.some((id) => text.toLowerCase().includes(id.toLowerCase()))) {
      return "blocked";
    }
  }
  return "passed";
}
