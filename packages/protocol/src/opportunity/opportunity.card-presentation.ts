import { stripUnsupportedOpportunityClaims } from './opportunity.claim-safety.js';
import { stripUuids } from './opportunity.presentation.js';

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
  digestSummary?: string | undefined;
  status?: string | undefined;
  feedCategory?: string | undefined;
  acceptUrl?: string | undefined;
  profileUrl?: string | undefined;
  /** Deep-link to the A2A negotiation trace that produced this opportunity. */
  negotiationUrl?: string | undefined;
  score?: number | undefined;
  /** Digest-mode cooldown re-show — the user has seen this card before. */
  redelivery?: boolean | undefined;
};

function sanitizeOpportunityCardProse(card: OpportunityCardLike): OpportunityCardLike {
  const sanitized: OpportunityCardLike = { ...card };
  for (const key of ['mainText', 'digestSummary', 'headline', 'cta', 'mutualIntentsLabel'] as const) {
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
 * MCP (`isMcp=true`): emits prose (name, reason, status, profileUrl when
 * present, acceptUrl when present, feedCategory when present) and includes
 * `opportunityId` ONLY for cards without an `acceptUrl` — exposing the UUID
 * alongside an actionable link gave LLMs a foothold to hallucinate bare
 * `/api/opportunities/<id>/connect` URLs (see IND-271). The trailing
 * instruction reminds the agent to synthesize in natural language and never
 * fabricate URLs for cards that don't have them. MCP clients have no card
 * renderer, so code fences would surface as raw JSON to end users.
 */
export function buildOpportunityPresentation(
  inputCards: OpportunityCardLike[],
  opts: {
    isMcp: boolean;
    leadIn: string;
    label?: 'opportunity' | 'opportunities';
    /** Include hidden digest metadata markers so scheduled brief tooling can confirm delivery. */
    includeDigestMarkers?: boolean;
  },
): string {
  const cards = inputCards.map(sanitizeOpportunityCardProse);
  if (cards.length === 0) return opts.leadIn;

  if (opts.isMcp) {
    const prose = cards
      .map((card, i) => {
        const lines: string[] = [`${i + 1}. ${card.name ?? "Unknown"}`];
        if (opts.includeDigestMarkers) {
          const markerId = String(card.opportunityId).replace(/[\s>]/g, "");
          if (markerId) lines.push(`   <!-- digest-opportunity:id=${markerId} -->`);
        }
        if (opts.includeDigestMarkers && card.digestSummary) {
          lines.push(`   ${card.digestSummary}`);
        } else if (card.mainText) {
          lines.push(`   ${card.mainText}`);
        }
        if (card.status) lines.push(`   status: ${card.status}`);
        if (card.profileUrl) lines.push(`   profileUrl: ${card.profileUrl}`);
        if (card.acceptUrl) lines.push(`   acceptUrl: ${card.acceptUrl}`);
        if (opts.includeDigestMarkers && card.negotiationUrl) lines.push(`   negotiationUrl: ${card.negotiationUrl}`);
        if (card.feedCategory) lines.push(`   feedCategory: ${card.feedCategory}`);
        if (opts.includeDigestMarkers && card.score != null) lines.push(`   confidence: ${Math.round(card.score * 100)}`);
        if (opts.includeDigestMarkers && card.redelivery) lines.push(`   redelivery: true`);
        // Only surface opportunityId when there's no acceptUrl. Exposing the
        // UUID alongside an actionable link gives the LLM a foothold to
        // hallucinate bare `/api/opportunities/<id>/connect` URLs.
        if (!card.acceptUrl) {
          lines.push(`   opportunityId: ${card.opportunityId}`);
        }
        return lines.join("\n");
      })
      .join("\n\n");
    const hasLinks = cards.some((c) => c.acceptUrl);
    const hasOpportunityIds = cards.some((c) => !c.acceptUrl);
    const linkInstructions = hasLinks
      ? `For each card that has an acceptUrl, embed it on a short verb phrase (e.g. "message [Name]" for connection, "make intro" for connector-flow). For each card that has a profileUrl, link the person's name to it. Some cards may have neither — render those as plain text and never fabricate URLs for them. The acceptUrl is opaque and self-contained — embed it verbatim. Do NOT append, encode, or modify any part of any URL. Never render link strips or tables — weave URLs into prose. `
      : "";
    const idInstructions = hasOpportunityIds
      ? `Use opportunityId values only when calling update_opportunity (send/accept/reject) or confirm_opportunity_delivery.`
      : "";
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `${linkInstructions}` +
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
