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

/** One scored dimension, projected for the client (checklist plan §2). */
export interface NegotiationActivityChecklistItem {
  name: string;
  kind: string;
  result: string;
  basis: string;
}

/**
 * The turn carried by an A2A message, or null when the message is not one.
 *
 * Negotiation turns persist as `[{ kind: 'data', data: turn }]` and carry no
 * text part at all — which is why this projection used to drop every one of
 * them and the intent page's negotiations tab rendered "no agent conversations
 * have started yet" for every live negotiation. The agent's prose is one field
 * down, in `data.message`.
 */
function turnOf(parts: unknown[]): { action?: string; message?: string; checklist?: unknown } | null {
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue;
    const candidate = part as Record<string, unknown>;
    if (candidate.kind !== 'data') continue;
    const data = candidate.data;
    if (!data || typeof data !== 'object') continue;
    const turn = data as Record<string, unknown>;
    return {
      ...(typeof turn.action === 'string' ? { action: turn.action } : {}),
      ...(typeof turn.message === 'string' ? { message: turn.message } : {}),
      ...(turn.checklist !== undefined ? { checklist: turn.checklist } : {}),
    };
  }
  return null;
}

/** The text a message renders as: a text part, or the turn's own message. */
function displayTextOf(parts: unknown[]): string {
  for (const part of parts) {
    if (typeof part === 'string' && part.trim().length > 0) return part.trim();
    if (!part || typeof part !== 'object') continue;
    const text = (part as Record<string, unknown>).text;
    if (typeof text === 'string' && text.trim().length > 0) return text.trim();
  }
  return turnOf(parts)?.message?.trim() ?? '';
}

/**
 * The checklist a negotiation currently holds, read off its own turns.
 *
 * Server-side because the derivation is the protocol's ("the last turn that
 * carried one wins") and the web client may not import the negotiations
 * domain — only the browser-safe subpaths. Repairs nothing: a malformed item
 * is dropped rather than shown, since this is a view.
 */
function checklistOf(rows: NegotiationActivityMessageRow[]): NegotiationActivityChecklistItem[] {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const drafted = turnOf(rows[index]!.parts)?.checklist;
    if (!Array.isArray(drafted) || drafted.length === 0) continue;
    const items = drafted.flatMap((entry) => {
      if (!entry || typeof entry !== 'object') return [];
      const item = entry as Record<string, unknown>;
      return typeof item.name === 'string' && typeof item.kind === 'string' && typeof item.result === 'string'
        ? [{
            name: item.name,
            kind: item.kind,
            result: item.result,
            basis: typeof item.basis === 'string' ? item.basis : '',
          }]
        : [];
    });
    if (items.length > 0) return items;
  }
  return [];
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
    /**
     * The checklist of the negotiation this group's latest message belongs to
     * (checklist plan §2). One correspondent can hold several opportunities;
     * the tab shows the most recent exchange, so the checklist shown is that
     * exchange's.
     */
    checklist: NegotiationActivityChecklistItem[];
    /** Every turn of that same negotiation, for deriving the checklist. */
    latestOpportunityId: string;
    messages: Array<{
      id: string;
      opportunityId: string;
      sender: 'yours' | 'theirs';
      action?: string;
      text: string;
      parts: unknown[];
      createdAt: Date;
    }>;
  }>();

  const rowsByOpportunity = new Map<string, NegotiationActivityMessageRow[]>();

  for (const message of messages) {
    const turn = turnOf(message.parts);
    const isViewerAgent = message.senderId === `agent:${userId}`;
    const text = displayTextOf(message.parts);
    if (
      !message.taskId
      || !message.senderId.startsWith('agent:')
      || text.length === 0
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
      checklist: [],
      latestOpportunityId: opportunityId,
      messages: [],
    };
    group.messages.push({
      id: message.id,
      opportunityId,
      sender: isViewerAgent ? 'yours' : 'theirs',
      ...(turn?.action ? { action: turn.action } : {}),
      text,
      parts: message.parts,
      createdAt: message.createdAt,
    });
    group.latestOpportunityId = opportunityId;
    groups.set(correspondentUserId, group);
    rowsByOpportunity.set(opportunityId, [...(rowsByOpportunity.get(opportunityId) ?? []), message]);
  }

  return [...groups.values()]
    .map((group) => ({
      ...group,
      // Derived from the negotiation's WHOLE turn record, before the slice
      // below: the checklist lives on every turn, and the last three messages
      // may not include the one that carried it.
      checklist: checklistOf(rowsByOpportunity.get(group.latestOpportunityId) ?? []),
      messages: group.messages
        .sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime() || left.id.localeCompare(right.id))
        .slice(-3),
    }))
    .sort((left, right) => left.correspondentLabel.localeCompare(right.correspondentLabel));
}
