export interface NegotiationActivityOpportunity {
  id: string;
  status: string;
  actors: Array<{ userId: string }>;
}

export interface NegotiationActivityMessageRow {
  id: string;
  taskId: string | null;
  senderId: string;
  parts: unknown[];
  createdAt: Date;
}

function hasDisplayableText(parts: unknown[]): boolean {
  return parts.some((part) => {
    if (typeof part === 'string') return part.trim().length > 0;
    if (!part || typeof part !== 'object') return false;
    const text = (part as Record<string, unknown>).text;
    return typeof text === 'string' && text.trim().length > 0;
  });
}

/**
 * Projects already-authorized intent opportunities into correspondent groups.
 * Only messages bound to a task mapped to one of those opportunities survive.
 */
export function projectNegotiationActivity(
  userId: string,
  opportunities: NegotiationActivityOpportunity[],
  opportunityByTask: Map<string, string>,
  messages: NegotiationActivityMessageRow[],
  counterparts: Map<string, { name: string; avatar: string | null }>,
) {
  const opportunityById = new Map(
    opportunities
      .filter((row) => row.status === 'negotiating')
      .map((row) => [row.id, row]),
  );
  const groups = new Map<string, {
    correspondentUserId: string;
    correspondentLabel: string;
    correspondentAvatar: string | null;
    messages: Array<{
      id: string;
      opportunityId: string;
      sender: 'yours' | 'theirs';
      parts: unknown[];
      createdAt: Date;
    }>;
  }>();

  for (const message of messages) {
    if (
      !message.taskId
      || !message.senderId.startsWith('agent:')
      || !hasDisplayableText(message.parts)
    ) continue;
    const opportunityId = opportunityByTask.get(message.taskId);
    const opportunity = opportunityId ? opportunityById.get(opportunityId) : undefined;
    const correspondentUserId = opportunity?.actors.find((actor) => actor.userId !== userId)?.userId;
    if (!opportunityId || !correspondentUserId) continue;
    const counterpart = counterparts.get(correspondentUserId);
    const group = groups.get(correspondentUserId) ?? {
      correspondentUserId,
      correspondentLabel: `${counterpart?.name?.trim() || 'Correspondent'}'s agent`,
      correspondentAvatar: counterpart?.avatar ?? null,
      messages: [],
    };
    group.messages.push({
      id: message.id,
      opportunityId,
      sender: message.senderId === `agent:${userId}` ? 'yours' : 'theirs',
      parts: message.parts,
      createdAt: message.createdAt,
    });
    groups.set(correspondentUserId, group);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      messages: group.messages
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .slice(-3),
    }))
    .sort((left, right) => left.correspondentLabel.localeCompare(right.correspondentLabel));
}
