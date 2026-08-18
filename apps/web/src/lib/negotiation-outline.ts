import type { ConversationSummary, NegotiationOpportunityStatus } from '@/services/conversation';

export interface NegotiationOutlineOpportunity {
  conversationId: string;
  counterpartId: string;
  opportunityId: string;
  taskId: string;
  title: string;
  status: NegotiationOpportunityStatus | null;
  updatedAt: string;
}

export interface NegotiationOutlineCounterparty {
  id: string;
  name: string;
  avatar: string | null;
  opportunities: NegotiationOutlineOpportunity[];
}

/** Groups only viewer-visible opportunity/task projections for the chat rail. */
export function groupNegotiationOutline(
  negotiations: ConversationSummary[],
  viewerUserId: string | undefined,
): NegotiationOutlineCounterparty[] {
  const ownAgentId = viewerUserId ? `agent:${viewerUserId}` : null;
  const groups = new Map<string, NegotiationOutlineCounterparty>();

  for (const conversation of negotiations) {
    const counterpart = conversation.participants.find((participant) => participant.participantId !== ownAgentId);
    if (!counterpart) continue;
    const counterpartId = counterpart.participantId.replace(/^agent:/, '');
    const group = groups.get(counterpartId) ?? {
      id: counterpartId,
      name: counterpart.ownerName ?? conversation.metadata?.title ?? counterpart.name ?? 'Unknown user',
      avatar: counterpart.avatar,
      opportunities: [],
    };
    for (const opportunity of conversation.negotiationOpportunities ?? []) {
      group.opportunities.push({
        conversationId: conversation.id,
        counterpartId,
        opportunityId: opportunity.opportunityId,
        taskId: opportunity.taskId,
        title: opportunity.title,
        status: opportunity.opportunityStatus,
        updatedAt: opportunity.updatedAt,
      });
    }
    groups.set(counterpartId, group);
  }

  return [...groups.values()]
    .filter((group) => group.opportunities.length > 0)
    .map((group) => ({
      ...group,
      opportunities: group.opportunities.sort((left, right) => (
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
      )),
    }))
    .sort((left, right) => (
      new Date(right.opportunities[0]?.updatedAt ?? 0).getTime()
      - new Date(left.opportunities[0]?.updatedAt ?? 0).getTime()
    ));
}

export const opportunityStatusPresentation: Record<NegotiationOpportunityStatus, { label: string; dotClass: string }> = {
  latent: { label: 'Latent', dotClass: 'bg-gray-400' },
  draft: { label: 'Draft', dotClass: 'bg-gray-400' },
  negotiating: { label: 'Negotiating', dotClass: 'bg-amber-500' },
  pending: { label: 'Pending', dotClass: 'bg-amber-500' },
  stalled: { label: 'Stalled', dotClass: 'bg-amber-500' },
  accepted: { label: 'Accepted', dotClass: 'bg-emerald-600' },
  rejected: { label: 'Rejected', dotClass: 'bg-red-600' },
  expired: { label: 'Expired', dotClass: 'bg-gray-400' },
};
