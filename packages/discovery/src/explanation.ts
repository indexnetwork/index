import { z } from 'zod/v4';
import { getAbortSignalConfig, loggerFor } from './runtime.js';
import type { MatchEvidence, Model } from './types.js';

export interface EvidenceCandidateInput {
  networkId: string;
  similarity: number;
  lens: string;
  discoverySource?: 'query';
  matchedStrategies?: string[];
  candidateIntentId?: string;
  sourceContextId?: string;
  candidateContextId?: string;
  candidatePayload?: string;
  candidateSummary?: string;
}

export function buildCandidateEvidence(candidate: EvidenceCandidateInput): MatchEvidence {
  const kind = resolveEvidenceKind(candidate);
  return {
    kind,
    networkId: candidate.networkId,
    score: candidate.similarity,
    lens: candidate.lens,
    discoverySource: candidate.discoverySource,
    matchedStrategies: candidate.matchedStrategies,
    candidateIntentId: candidate.candidateIntentId,
    sourceContextId: candidate.sourceContextId,
    candidateContextId: candidate.candidateContextId,
    payload: candidate.candidatePayload,
    summary: candidate.candidateSummary,
  };
}

export function withCandidateEvidence<T extends EvidenceCandidateInput>(candidate: T): T & { evidence: MatchEvidence[] } {
  return { ...candidate, evidence: [buildCandidateEvidence(candidate)] };
}

export function mergeMatchEvidence(...groups: Array<MatchEvidence[] | undefined>): MatchEvidence[] {
  const byKey = new Map<string, MatchEvidence>();
  for (const evidence of groups.flatMap((group) => group ?? [])) {
    const key = [
      evidence.kind,
      evidence.networkId,
      evidence.candidateIntentId ?? '',
      evidence.sourceContextId ?? '',
      evidence.candidateContextId ?? '',
      evidence.lens ?? '',
    ].join('|');
    const existing = byKey.get(key);
    if (!existing || (evidence.score ?? 0) > (existing.score ?? 0)) byKey.set(key, evidence);
  }
  return Array.from(byKey.values());
}

export function withMatchedStrategies(evidence: MatchEvidence[], strategies: string[]): MatchEvidence[] {
  return evidence.map((item) => ({
    ...item,
    matchedStrategies: Array.from(new Set([...(item.matchedStrategies ?? []), ...strategies])),
  }));
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

function resolveEvidenceKind(candidate: EvidenceCandidateInput): MatchEvidence['kind'] {
  if (candidate.candidateContextId) return 'query_context';
  if (candidate.candidateIntentId) return 'query_intent';
  return 'profile';
}

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

function splitClaimSentences(text: string): string[] {
  return text
    .trim()
    .split(/(?<=[.!?])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean);
}

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

const logger = loggerFor("MatchExplainer");

/** A person (profile + optional intents) as discovery/introduction hands it to the explainer. */
export interface EvaluatorEntity {
  userId: string;
  profile: {
    name?: string;
    bio?: string;
    location?: string;
    interests?: string[];
    skills?: string[];
    context?: string;
  };
  intents?: Array<{
    intentId: string;
    payload: string;
    summary?: string;
  }>;
  networkId: string;
  evidenceKey?: string;
  ragScore?: number;
  matchedVia?: string;
  evidence?: MatchEvidence[];
}

/**
 * Every candidate that survives discovery's own similarity floor and the
 * membership/cooldown gates is persisted directly — there is no accept/reject
 * judgment before persistence any more (negotiators own that). This class only
 * explains a pairing for the humans (and negotiators) reading the opportunity
 * later; it never scores, assigns a role, or decides whether the match stands.
 */
const systemPrompt = `
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

const responseFormat = z.object({
  reasoning: z.string().describe('Third-party explanation of why this pairing might be relevant. Mentions both users by role.'),
});

export interface MatchExplainerInput {
  /** The user who triggered discovery. */
  discovererId: string;
  /** Exactly two entities: [source, candidate]. */
  entities: EvaluatorEntity[];
  existingOpportunities?: string;
  /** Optional discovery query (e.g. from chat), for framing relevance. */
  discoveryQuery?: string;
  /** Pre-rendered network context markdown, keyed by networkId. */
  networkContexts?: Record<string, string>;
}

export interface MatchExplainerResult {
  reasoning: string;
  /** Set when the claim-safety guard dropped the model's reasoning as unsupported. */
  droppedUnsupportedClaim?: boolean;
}

/** Optional test double for the explainer model (avoids live LLM calls in unit tests). */
export type MatchExplainerLike = {
  explain: (input: MatchExplainerInput, options?: { signal?: AbortSignal }) => Promise<MatchExplainerResult>;
};

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

export class MatchExplainer implements MatchExplainerLike {
  constructor(private readonly model: Model) {}

  public async explain(
    input: MatchExplainerInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<MatchExplainerResult> {
    const [sourceEntity, candidateEntity] = input.entities;
    if (!sourceEntity || !candidateEntity) {
      throw new Error('MatchExplainer requires exactly two entities: [source, candidate]');
    }

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
    const result = await this.model.complete({
      name: 'opportunity_match_explainer', schema: responseFormat,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: humanContent },
      ],
    }, { signal: options.signal ?? getAbortSignalConfig().signal });
    const parsed = responseFormat.parse(result);
    const reasoning = stripUuids(parsed.reasoning);

    if (hasUnsupportedOpportunityClaim(reasoning)) {
      logger.warn('Dropping explanation with unsupported affiliation/presence claim', {
        candidateUserId: candidateEntity.userId,
      });
      return { reasoning: '', droppedUnsupportedClaim: true };
    }

    return { reasoning };
  }
}
