import { z } from 'zod/v4';

import { getAbortSignalConfig, loggerFor } from '../core/runtime.js';
import type { Model } from '../core/types.js';
import { buildMatchExplanationPrompt, EXPLAINER_SYSTEM_PROMPT } from '../prompts/discovery.prompt.js';
import type { MatchExplainerInput, MatchExplainerLike, MatchExplainerResult } from './discovery.state.js';
import { hasUnsupportedOpportunityClaim, stripUuids } from './match.verifier.js';

const logger = loggerFor("MatchExplainer");

const responseFormat = z.object({
  reasoning: z.string().describe('Third-party explanation of why this pairing might be relevant. Mentions both users by role.'),
});

/**
 * Every candidate that survives discovery's own similarity floor and the
 * membership/cooldown gates is persisted directly — there is no accept/reject
 * judgment before persistence any more (negotiators own that). This class only
 * explains a pairing for the humans (and negotiators) reading the opportunity
 * later; it never scores, assigns a role, or decides whether the match stands.
 */
export class MatchExplainer implements MatchExplainerLike {
  constructor(private readonly model: Model) {}

  /**
   * @param input - Source and candidate entities with optional retrieval context.
   * @param options - Per-call cancellation, overriding the invocation signal.
   * @returns Reasoning with UUIDs removed, or a marker for an unsupported claim.
   * @throws On missing entities, model or response validation failure, or cancellation.
   */
  public async explain(
    input: MatchExplainerInput,
    options: { signal?: AbortSignal } = {},
  ): Promise<MatchExplainerResult> {
    const [sourceEntity, candidateEntity] = input.entities;
    if (!sourceEntity || !candidateEntity) {
      throw new Error('MatchExplainer requires exactly two entities: [source, candidate]');
    }

    const humanContent = buildMatchExplanationPrompt(input, sourceEntity, candidateEntity);
    const result = await this.model.complete({
      name: 'opportunity_match_explainer', schema: responseFormat,
      messages: [
        { role: 'system', content: EXPLAINER_SYSTEM_PROMPT },
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
