import type { NegotiationActivityGroup } from "@/services/conversation";

export function normalizeNegotiationActivity(
  groups: NegotiationActivityGroup[],
): NegotiationActivityGroup[] {
  return groups.map((group) => ({
    ...group,
    messages: [...group.messages]
      .sort((left, right) =>
        Date.parse(left.createdAt) - Date.parse(right.createdAt)
        || left.id.localeCompare(right.id),
      )
      .slice(-3),
  }));
}
