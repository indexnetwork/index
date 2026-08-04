import { stripUnsupportedOpportunityClaims } from '../domain/opportunity.claim-safety.js';
import { stripUuids } from '../domain/opportunity.presentation.js';

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
  profileUrl?: string | undefined;
  /** Universal link that opens this opportunity's card (`/o/<id>`). */
  appUrl?: string | undefined;
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
 * MCP (`isMcp=true`): emits prose (name, reason, status, appUrl and profileUrl
 * when present, feedCategory when present) and includes `opportunityId` for
 * every card so the agent can act via the tools. The trailing instruction
 * reminds the agent to synthesize in natural language, to surface the `appUrl`
 * verbatim as the one link that opens the card, and to fabricate no other URL.
 * MCP clients have no card renderer, so code fences would surface as raw JSON
 * to end users.
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
        if (card.appUrl) lines.push(`   appUrl: ${card.appUrl}`);
        if (card.profileUrl) lines.push(`   profileUrl: ${card.profileUrl}`);
        if (opts.includeDigestMarkers && card.negotiationUrl) lines.push(`   negotiationUrl: ${card.negotiationUrl}`);
        if (card.feedCategory) lines.push(`   feedCategory: ${card.feedCategory}`);
        if (opts.includeDigestMarkers && card.score != null) lines.push(`   confidence: ${Math.round(card.score * 100)}`);
        if (opts.includeDigestMarkers && card.redelivery) lines.push(`   redelivery: true`);
        lines.push(`   opportunityId: ${card.opportunityId}`);
        return lines.join("\n");
      })
      .join("\n\n");
    const idInstructions = `Use opportunityId values only when calling update_opportunity (send/accept/reject) or confirm_opportunity_delivery.`;
    return (
      `${opts.leadIn}\n\n${prose}\n\n` +
      `Summarize these for the user in natural prose — mention first names and a brief match reason per connection. ` +
      `For each card that has a profileUrl, link the person's name to it. Some cards may have no URL — render those as plain text and never fabricate URLs for them. ` +
      `For each card that has an appUrl, show that link so the user can open the opportunity: it opens the card in the Index app when installed, and an Index web page otherwise. Show only an appUrl a tool returned — never assemble one from an opportunityId. ` +
      `No link accepts on the user's behalf: accepting happens in the Index app (or via update_opportunity) — never invent an accept URL. ` +
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
