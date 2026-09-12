import type { MatchEvidence } from '../core/types.js';
import type { EvaluatorEntity, IndexedIntent, MatchExplainerInput, SourceProfileData } from '../matching/discovery.state.js';

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
 * Builds a compact text summary of the discoverer's profile and active intents.
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
    const capped = intents.slice(0, 5);
    lines.push('');
    lines.push('Active intents:');
    for (const intent of capped) {
      lines.push(`- ${intent.payload}`);
    }
  }

  return lines.length > 0 ? lines.join('\n') : undefined;
}
