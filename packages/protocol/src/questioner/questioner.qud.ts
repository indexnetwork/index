/**
 * Shared Questions Under Discussion (QUD) taxonomy contract for structured
 * question-generation prompts. Every Questioner mode uses this block because
 * the structured output schema requires the internal metadata field; intent
 * and discovery are the primary consumers of non-null classifications.
 */
export const QUD_UNDERSPECIFICATION_RULES = `QUD underspecification taxonomy. For every structured question, emit a required \`underspecificationType\` field. Use exactly one category only when the question repairs that kind of underspecification:
- missing_constituent: an absent core participant, entity, or outcome (who/what).
- missing_constraint: the core target exists, but a ranking boundary is missing (where/when/how/how much).
- open_alternative_set: an unresolved choice among materially different interpretations or scopes.
Use null for adjacent, reflective, emergent, or any other question that does not repair underspecification. Strategy and underspecification type are orthogonal: \`strategy\` describes the conversational move; \`underspecificationType\` describes the QUD defect repaired. Never infer one mechanically from the other.`;
