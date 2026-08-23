import type { NegotiationActivityGroup } from "@/services/conversation";

function hasDisplayableText(message: { text?: string; parts: unknown[] }): boolean {
  if (typeof message.text === "string" && message.text.trim().length > 0) return true;
  // Pre-projection shape: a message whose text lives in its parts. Kept so a
  // client running ahead of the server still renders the old payload.
  return message.parts.some((part) => {
    if (typeof part === "string") return part.trim().length > 0;
    if (!part || typeof part !== "object") return false;
    const text = (part as Record<string, unknown>).text;
    return typeof text === "string" && text.trim().length > 0;
  });
}

export function normalizeNegotiationActivity(
  groups: NegotiationActivityGroup[],
): NegotiationActivityGroup[] {
  return groups
    .map((group) => ({
      ...group,
      messages: group.messages
        // Defense in depth for mixed-version deployments and cached activity:
        // an ask_user turn belongs only to the agent's own principal. A
        // counterparty's persisted pause must never render as an ask to the
        // current viewer.
        .filter((message) =>
          hasDisplayableText(message)
          && !(message.action === "ask_user" && message.sender === "theirs"),
        )
        .sort((left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt)
          || left.id.localeCompare(right.id),
        )
        .slice(-3),
    }))
    .filter((group) => group.messages.length > 0);
}
