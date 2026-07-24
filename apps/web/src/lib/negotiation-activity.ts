import type { NegotiationActivityGroup } from "@/services/conversation";

function hasDisplayableText(parts: unknown[]): boolean {
  return parts.some((part) => {
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
        .filter((message) => hasDisplayableText(message.parts))
        .sort((left, right) =>
          Date.parse(left.createdAt) - Date.parse(right.createdAt)
          || left.id.localeCompare(right.id),
        )
        .slice(-3),
    }))
    .filter((group) => group.messages.length > 0);
}
