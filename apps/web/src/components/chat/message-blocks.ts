import type { OpportunityCardData } from "@/components/chat/OpportunityCardInChat";
import type { IntentProposalData } from "@/components/chat/IntentProposalCard";

/**
 * Segment union for all block types the chat agent can emit.
 * Exported so consumers (e.g. ChatContent.tsx useMemo hooks) can type
 * the result of parseAllBlocks without importing via deep paths.
 */
export type MessageSegment =
  | { type: "text"; content: string }
  | { type: "opportunity"; data: OpportunityCardData }
  | { type: "opportunity_loading" }
  | { type: "intent_proposal"; data: IntentProposalData }
  | { type: "intent_proposal_loading" }
  | { type: "networks_panel" }
  | { type: "networks_panel_loading" };

/**
 * Parse agent message content, extracting fenced blocks as typed segments.
 * Exported so ChatContent.tsx can call it outside AssistantMessageContent
 * (for opportunity/proposal ID extraction in useMemo hooks).
 */
export function parseAllBlocks(content: string): MessageSegment[] {
  const segments: MessageSegment[] = [];
  const regex = /```(opportunity|intent_proposal|networks_panel)\s*\n([\s\S]*?)\n```/g;
  let lastIndex = 0;
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      const textBefore = content.slice(lastIndex, match.index);
      if (textBefore.trim()) {
        segments.push({ type: "text", content: textBefore });
      }
    }

    const blockType = match[1];

    if (blockType === "networks_panel") {
      segments.push({ type: "networks_panel" });
    } else {
      try {
        const jsonStr = match[2].trim();
        const data = JSON.parse(jsonStr);

        if (blockType === "opportunity" && data.opportunityId && data.userId) {
          segments.push({ type: "opportunity", data: data as OpportunityCardData });
        } else if (
          blockType === "intent_proposal" &&
          data.proposalId &&
          (typeof data.description === "string" || !("description" in data))
        ) {
          segments.push({ type: "intent_proposal", data: data as IntentProposalData });
        } else if (blockType === "intent_proposal") {
          segments.push({
            type: "text",
            content: "This proposal couldn't be loaded as a card. Ask again to add this as a signal.",
          });
        } else {
          segments.push({ type: "text", content: match[0] });
        }
      } catch {
        segments.push({ type: "text", content: match[0] });
      }
    }

    lastIndex = match.index + match[0].length;
  }

  const remainingContent = content.slice(lastIndex);
  const partialOpp = remainingContent.match(/```opportunity(?:\s*\n|$)/);
  const partialIntent = remainingContent.match(/```intent_proposal(?:\s*\n|$)/);
  const partialNetworks = remainingContent.match(/```networks_panel(?:\s*\n|$)/);

  const candidates = ([partialOpp, partialIntent, partialNetworks] as (RegExpMatchArray | null)[]).filter(
    (c): c is RegExpMatchArray => c !== null,
  );
  const partialMatch =
    candidates.length > 0
      ? candidates.reduce((earliest, c) => (c.index! < earliest.index! ? c : earliest))
      : null;

  if (partialMatch) {
    const partialIndex = partialMatch.index!;
    const textBefore = remainingContent.slice(0, partialIndex);
    if (textBefore.trim()) {
      segments.push({ type: "text", content: textBefore });
    }
    if (partialMatch === partialOpp) {
      segments.push({ type: "opportunity_loading" });
    } else if (partialMatch === partialIntent) {
      segments.push({ type: "intent_proposal_loading" });
    } else {
      segments.push({ type: "networks_panel_loading" });
    }
  } else if (lastIndex < content.length) {
    const remaining = content.slice(lastIndex);
    if (remaining.trim()) {
      segments.push({ type: "text", content: remaining });
    }
  }

  if (segments.length === 0 && content.trim()) {
    segments.push({ type: "text", content });
  }

  return segments;
}
