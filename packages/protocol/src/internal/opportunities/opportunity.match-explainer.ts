import type { Runnable } from "@langchain/core/runnables";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { stripUuids } from "./opportunity.presentation.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { renderOpportunityEvidenceForPrompt } from './opportunity.evidence.js';
import { hasUnsupportedOpportunityClaim } from "../shared/utils/claim-safety.js";
import type { OpportunityEvidence } from '../../protocol/schemas/network-assignment.schema.js';

const logger = protocolLogger("MatchExplainer");

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
  evidence?: OpportunityEvidence[];
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
${renderOpportunityEvidenceForPrompt(entity.evidence ?? [])}`;
}

export class MatchExplainer implements MatchExplainerLike {
  private model: Runnable;

  constructor(options?: { model?: Runnable }) {
    this.model = options?.model ?? createStructuredModel("opportunityEvaluator", responseFormat, {
      name: "opportunity_match_explainer",
    });
  }

  @Timed()
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
    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(humanContent),
    ];

    const result = await invokeWithAbortSignal(this.model, messages, options.signal);
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
