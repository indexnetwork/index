import type { HydeGenerateInput, HydeValidationInput } from '../artifacts/artifact.state.js';
import type { HydeSourceFrame } from '../artifacts/frame.schema.js';
import type { MatchEvidence } from '../core/types.js';
import type { EvaluatorEntity, IndexedIntent, MatchExplainerInput, SourceProfileData } from '../matching/discovery.state.js';

export const LENS_SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.
- LOCATION AWARENESS: When the source text or user context mentions a specific location (city, region, country), incorporate it into lens descriptions. For example, "investors in San Francisco" should produce a lens like "SF-based early-stage investor" rather than just "early-stage investor". This helps the hypothetical document generator produce location-specific search documents, improving retrieval quality.`;

/**
 * Compose lens inference instructions with optional profile context.
 * @param input - Source text, profile context, and the resolved lens limit.
 * @returns The user message for lens inference.
 */
export function buildLensInferencePrompt({ sourceText, profileContext, maxLenses }: {
  sourceText: string;
  profileContext?: string;
  maxLenses: number;
}): string {
  let humanPrompt = `Identify up to ${maxLenses} search perspectives for finding relevant matches.\n\nSource: "${sourceText}"`;

  if (profileContext) {
    humanPrompt += `\n\nUser context: ${profileContext}`;
  }

  return humanPrompt;
}

/** Source-grounded system prompt used only by frame extraction. */
export const FRAME_SYSTEM_PROMPT = `You extract a source-grounded frame for semantic retrieval from sourceText alone.

Source-frame rules:
- Extract evidence ONLY from sourceText.
- Every frame element must include an evidence field copied as an exact substring of sourceText.
- sourceRoles describe roles held or offered by the source side.
- sourceRoles and counterpartRoles MUST use generic lower-case role labels only (for example, "founder", "investor", or "technical advisor"). Never put a person, organization, product, location, time, number, credential, or exclusivity detail in a role label.
- counterpartRoles describe reciprocal or complementary target roles. A generic role may be inferred, but its evidence must be an exact sourceText span that supports the inference.
- hardConstraints contain only explicit constraints and classify each as location, time, numeric, credential, organization, exclusivity, or other.
- namedEntities contain only proper names explicitly present in sourceText and classify each as person, organization, product, location, event, or other.
- domainVocabulary contains source domain terms worth preserving.`;

/**
 * Compose frame extraction instructions using only source text.
 * @param sourceText - Exact source text to extract evidence from.
 * @returns The user message for source-frame extraction.
 */
export function buildSourceFramePrompt(sourceText: string): string {
  return `Extract the source frame.\n\nSource: "${sourceText}"`;
}

export const GENERATOR_SYSTEM_PROMPT = `You are a Hypothetical Document Generator for semantic search.

Your task: Given a source statement (e.g. an intent or goal), write a short hypothetical document in the voice of the TARGET side—the kind of person or statement that would be an ideal match for that source.

Rules:
- Write in first person as the target.
- Be concrete and specific so the text is good for vector similarity search.
- Output only the hypothetical document text, no meta-commentary.
- Keep length to a few sentences or one short paragraph.`;

function renderList(items: string[]): string {
  return items.length > 0 ? items.join('; ') : '(none)';
}

/** Build the frame-v1 generation prompt from sanitized source evidence. */
export function buildFrameHydePrompt(input: HydeGenerateInput & { sourceFrame: HydeSourceFrame }): string {
  const { sourceText, corpus, sourceFrame } = input;
  const corpusInstruction = {
    profiles: 'Write a first-person professional biography in the target profile voice.',
    intents: 'Write a first-person goal or aspiration in the target intent voice.',
  }[corpus];

  return `${corpusInstruction}

Source text: "${sourceText}"

Sanitized source frame:
- Source roles: ${renderList(sourceFrame.sourceRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Counterpart/complementary roles: ${renderList(sourceFrame.counterpartRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Explicit hard constraints: ${renderList(sourceFrame.hardConstraints.map((item) => `${item.type}: ${item.value} [evidence: "${item.evidence}"]`))}
- Named entities: ${renderList(sourceFrame.namedEntities.map((item) => `${item.type}: ${item.name} [evidence: "${item.evidence}"]`))}
- Domain vocabulary: ${renderList(sourceFrame.domainVocabulary.map((item) => `${item.term} [evidence: "${item.evidence}"]`))}

Generation constraints:
- You MAY elaborate generic roles and generic domain language.
- You MAY use reciprocal/complementary inversion and write in the target voice.
- You MUST NOT introduce any new proper noun or named entity.
- You MUST NOT introduce any new hard location, time, numeric, credential, organization, or exclusivity constraint.
- Preserve explicit source-frame constraints when they apply to the reciprocal target.
- Output only a few sentences or one short paragraph.`;
}

export const VALIDATOR_SYSTEM_PROMPT = `You validate hypothetical retrieval documents against a sanitized source-grounded frame.

A document is invalid only when it invents unsupported proper nouns/named entities or unsupported HARD constraints (location, time, numeric, credential, organization, or exclusivity constraints).

Explicitly allowed and not grounds for rejection:
- first-person target voice;
- generic role or domain elaboration;
- reciprocal or complementary inversion of source and target roles.

Return exactly one verdict for each opaque key. Copy each key exactly. Mark valid=false when either unsupported list is non-empty. Keep reasoning concise.`;

/** Build a profile-free batch validation prompt. */
export function buildHydeValidationPrompt(input: HydeValidationInput): string {
  return `Source text:\n${input.sourceText}\n\nSanitized source frame:\n${JSON.stringify(input.sourceFrame)}\n\nGenerated documents:\n${JSON.stringify(input.documents)}`;
}

export const EXPLAINER_SYSTEM_PROMPT = `
You are writing the "why this match exists" explanation for a candidate connection between two people.
Your ONLY job is to explain the pairing — you do not decide whether it is a good match, score it, or assign roles.

Input:
- DISCOVERER: the user ID who triggered discovery.
- ENTITIES: exactly two entities — the discoverer and one candidate. Each has a profile and optional intents.
- EXISTING OPPORTUNITIES: context of matches already made (for deduplication of the explanation's angle, not for rejecting the pairing).

Write a neutral, third-party explanation of why these two might be relevant to each other:
- Mention BOTH users by role ("the source user" and "the candidate"), never by name, never as "you".
- Explain what each side brings and why the connection could be valuable.
- If both sides are clearly seeking the same thing rather than one offering what the other seeks, say so plainly in the explanation rather than inventing complementary value that is not there.
- NEVER leak a confidential intent's private details; describe relevant attributes instead.
- NEVER assert that someone attended an event, belongs to a group, resides somewhere, or knows another person, unless the evidence directly supports it. Network/context metadata is retrieval context only, not proof of co-attendance or acquaintance.
- Keep it concise: one short paragraph.
`;

/**
 * Compose a pair explanation from the validated source and candidate entities.
 * @param input - Discoverer identity and optional query, network, and match context.
 * @param sourceEntity - The source entity validated by the explainer.
 * @param candidateEntity - The candidate entity validated by the explainer.
 * @returns The user message for match explanation.
 */
export function buildMatchExplanationPrompt(
  input: MatchExplainerInput,
  sourceEntity: EvaluatorEntity,
  candidateEntity: EvaluatorEntity,
): string {
  const existingPart = input.existingOpportunities
    ? `\nEXISTING OPPORTUNITIES:\n${input.existingOpportunities}\n`
    : '';
  const discoveryQueryPart = input.discoveryQuery?.trim()
    ? `\nDISCOVERY REQUEST: The user asked: "${input.discoveryQuery.trim()}"\nUse this as the primary frame for relevance when explaining the pairing.\n`
    : '';
  const networkContextPart = input.networkContexts && Object.keys(input.networkContexts).length > 0
    ? `\n\nNETWORK CONTEXTS:\n${Object.entries(input.networkContexts).map(([nid, ctx]) => `[INDEX: ${nid}]\n${ctx}`).join('\n\n')}`
    : '';

  const entitiesBlock = [
    renderEntity(sourceEntity, true),
    renderEntity(candidateEntity, false),
  ].join('\n');

  const humanContent = `DISCOVERER: ${input.discovererId}${discoveryQueryPart}${networkContextPart}\n\nENTITIES:\n${entitiesBlock}${existingPart}`;
  return humanContent;
}

function renderEntity(entity: EvaluatorEntity, isSource: boolean): string {
  const displayName = isSource ? '(source user)' : (entity.profile.name ?? '');
  const intentsLabel = isSource ? 'INTENTS' : 'INTENTS';
  const intentsPart = entity.intents?.length
    ? `\n  ${intentsLabel}:\n${entity.intents.map((i) => `    - ${i.intentId}: ${i.payload}`).join('\n')}`
    : '';
  return `
  USER: ${entity.userId}
  INDEX: ${entity.networkId}
  PROFILE: Name: ${displayName} | Bio: ${entity.profile.bio ?? ''} | Location: ${entity.profile.location ?? ''} | Interests: ${entity.profile.interests?.join(', ') ?? ''} | Skills: ${entity.profile.skills?.join(', ') ?? ''} | Context: ${entity.profile.context ?? ''}${intentsPart}
  RAG SCORE: ${entity.ragScore ?? '—'}
  MATCHED VIA: ${entity.matchedVia ?? '—'}
  EVIDENCE:
${renderMatchEvidenceForPrompt(entity.evidence ?? [])}`;
}

export function renderMatchEvidenceForPrompt(evidence: MatchEvidence[]): string {
  if (evidence.length === 0) return '    —';
  return evidence.map((item) => {
    const refs = [
      item.candidateIntentId ? `candidateIntent=${item.candidateIntentId}` : undefined,
      item.sourceContextId ? `sourceContext=${item.sourceContextId}` : undefined,
      item.candidateContextId ? `candidateContext=${item.candidateContextId}` : undefined,
      item.matchedStrategies?.length ? `strategies=${item.matchedStrategies.join(',')}` : undefined,
    ].filter(Boolean).join(', ');
    const text = item.summary ?? item.payload ?? '';
    const domainCaution =
      (item.kind === 'query_context' && !text)
        ? ' [context text unavailable — do NOT infer domain match from RAG score alone; verify domain alignment from profile]'
        : '';
    return `    - ${item.kind} on ${item.networkId} via ${item.lens ?? 'unknown'} score=${item.score?.toFixed(3) ?? '—'}${refs ? ` (${refs})` : ''}${text ? `: ${text}` : ''}${domainCaution}`;
  }).join('\n');
}

/**
 * Builds a compact text summary of the discoverer's profile and active intents
 * for use as profileContext in HyDE generation.
 * @param profile - The discoverer's profile data (identity, attributes)
 * @param intents - The discoverer's indexed intents (capped at 5)
 * @returns A context string, or undefined if no meaningful data is available
 */
export function buildDiscovererContext(
  profile: SourceProfileData | null | undefined,
  intents: IndexedIntent[] | undefined
): string | undefined {
  const lines: string[] = [];

  if (profile) {
    const identity = profile.identity;
    if (identity?.name || identity?.bio) {
      lines.push(`Profile: ${[identity.name, identity.bio].filter(Boolean).join(', ')}`);
    }
    if (identity?.location) {
      lines.push(`Location: ${identity.location}`);
    }
    if (profile.context) {
      lines.push(`Context: ${profile.context}`);
    }
  }

  if (intents?.length) {
    // indexedIntents preserves DB order from getActiveIntents (newest first),
    // so slice(0, 5) is deterministic without an explicit sort.
    const capped = intents.slice(0, 5);
    lines.push('');
    lines.push('Active intents:');
    for (const intent of capped) {
      lines.push(`- ${intent.payload}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}
