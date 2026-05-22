import { escapeHtml } from './bot-api';

// ── Types ──────────────────────────────────────────────────────────────────────

/**
 * Parsed opportunity card from a ```opportunity code block.
 * Mirrors the card shape emitted by `buildOpportunityPresentation` in the
 * protocol layer's opportunity tools.
 */
export interface OpportunityCard {
  opportunityId: string;
  userId?: string;
  name?: string;
  avatar?: string;
  mainText?: string;
  headline?: string;
  cta?: string;
  primaryActionLabel?: string;
  secondaryActionLabel?: string;
  mutualIntentsLabel?: string;
  narratorChip?: { name: string; text: string };
  viewerRole?: string;
  isGhost?: boolean;
  score?: number;
  status?: string;
}

/** A segment of the LLM response: either prose or a structured block. */
export type ResponseSegment =
  | { type: 'text'; content: string }
  | { type: 'opportunity'; card: OpportunityCard };

// ── Parsing ────────────────────────────────────────────────────────────────────

/**
 * Matches ```opportunity and ```intent_proposal code fences.
 * The `sanitizeJsonForCodeFence` helper in the protocol layer escapes any
 * backticks inside the JSON payload, so the non-greedy `[\s\S]*?` always
 * stops at the closing triple-backtick that belongs to the fence.
 */
const BLOCK_RE = /```(?:opportunity|intent_proposal)\n([\s\S]*?)```/g;

/**
 * Parse an LLM response into an ordered list of prose and structured-block
 * segments, preserving the interleaving so the gateway can send messages in
 * the same order the LLM intended.
 *
 * - `opportunity` blocks are parsed into typed card segments.
 * - `intent_proposal` blocks have their `description` extracted as plain text.
 * - Malformed JSON is silently dropped.
 */
export function parseResponseSegments(text: string): ResponseSegment[] {
  const segments: ResponseSegment[] = [];
  let lastIndex = 0;

  for (const match of text.matchAll(BLOCK_RE)) {
    const before = text.slice(lastIndex, match.index);
    if (before.trim()) {
      segments.push({ type: 'text', content: before.trim() });
    }

    const isOpportunity = match[0].startsWith('```opportunity');
    if (isOpportunity) {
      try {
        const card = JSON.parse(match[1]) as OpportunityCard;
        segments.push({ type: 'opportunity', card });
      } catch {
        // Malformed JSON — drop the block silently
      }
    } else {
      // intent_proposal or other block type — extract description if possible
      try {
        const data = JSON.parse(match[1]) as Record<string, unknown>;
        const desc = String(data.description ?? data.summary ?? '');
        if (desc.trim()) {
          segments.push({ type: 'text', content: desc.trim() });
        }
      } catch {
        // Malformed — drop
      }
    }

    lastIndex = (match.index ?? 0) + match[0].length;
  }

  const trailing = text.slice(lastIndex);
  if (trailing.trim()) {
    segments.push({ type: 'text', content: trailing.trim() });
  }

  return segments;
}

/** True when the response contains at least one structured block. */
export function hasStructuredBlocks(segments: ResponseSegment[]): boolean {
  return segments.some((s) => s.type !== 'text');
}

// ── Card formatting ────────────────────────────────────────────────────────────

/**
 * Render an opportunity card as an HTML-formatted Telegram message with an
 * inline-keyboard action button.
 *
 * Layout:
 * ```
 * <b>Name</b>
 * <i>Headline</i>
 *
 * Main body text...
 *
 * 🎯 Mutual intents label
 *
 * 💡 Narrator editorial note
 *
 * [💬 Start Chat]  ← inline keyboard
 * ```
 */
export function formatOpportunityCardHtml(
  card: OpportunityCard,
  webAppUrl: string,
): { text: string; keyboard: Array<Array<{ text: string; url: string }>> } {
  const lines: string[] = [];

  // ── Name ──
  lines.push(`<b>${escapeHtml(card.name ?? 'Someone')}</b>`);

  // ── Headline ──
  if (card.headline) {
    lines.push(`<i>${escapeHtml(card.headline)}</i>`);
  }

  // ── Body ──
  if (card.mainText) {
    lines.push('');
    lines.push(escapeHtml(card.mainText));
  }

  // ── Mutual-intents label ──
  if (card.mutualIntentsLabel) {
    lines.push('');
    lines.push(`🎯 ${escapeHtml(card.mutualIntentsLabel)}`);
  }

  // ── Narrator chip (editorial note from the system) ──
  if (card.narratorChip?.text) {
    lines.push('');
    lines.push(`💡 <i>${escapeHtml(card.narratorChip.text)}</i>`);
  }

  const keyboard: Array<Array<{ text: string; url: string }>> = [
    [{ text: `💬 ${card.primaryActionLabel ?? 'View'}`, url: `${webAppUrl}/opportunities` }],
  ];

  return { text: lines.join('\n'), keyboard };
}

/**
 * Plain-text fallback for when HTML send fails (e.g. Telegram rejects markup).
 * No HTML tags, no inline keyboard — just the essential card content.
 */
export function formatOpportunityCardPlainText(card: OpportunityCard): string {
  const lines: string[] = [];
  if (card.name) lines.push(card.name);
  if (card.headline) lines.push(card.headline);
  if (card.mainText) lines.push('', card.mainText);
  if (card.mutualIntentsLabel) lines.push('', `🎯 ${card.mutualIntentsLabel}`);
  if (card.narratorChip?.text) lines.push('', `💡 ${card.narratorChip.text}`);
  return lines.join('\n');
}
