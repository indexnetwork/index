// ══════════════════════════════════════════════════════════════════════════════
// Structured message content types for XMTP home feed (frontend mirror)
// ══════════════════════════════════════════════════════════════════════════════

export interface OpportunityCardContent {
  type: 'opportunity_card';
  opportunityId: string;
  headline: string;
  summary: string;
  actors: Array<{
    userId: string;
    name: string;
    avatar?: string;
    mutualIntentsLabel?: string;
  }>;
  narratorChip?: string;
  sectionTitle?: string;
  sectionIcon?: string;
}

export interface OpportunityUpdateContent {
  type: 'opportunity_update';
  opportunityId: string;
  headline: string;
  summary: string;
}

export type StructuredContent = OpportunityCardContent | OpportunityUpdateContent;

/**
 * Attempt to parse an XMTP text message as structured content.
 * Returns null if the message is plain text or has an unrecognised type.
 */
export function parseContent(text: string): StructuredContent | null {
  try {
    const parsed = JSON.parse(text);
    if (parsed.type === 'opportunity_card' || parsed.type === 'opportunity_update') {
      return parsed as StructuredContent;
    }
    return null;
  } catch {
    return null;
  }
}
