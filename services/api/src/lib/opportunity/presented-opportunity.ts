import type { OpportunityStatus } from '@indexnetwork/protocol';

/** Cacheable lifecycle statuses for async presenter preload (not negotiating). */
export const CACHEABLE_PRESENTATION_STATUSES: OpportunityStatus[] = [
  'pending',
  'accepted',
  'rejected',
  'expired',
];

export function isOpportunityPresentationCacheable(status: OpportunityStatus): boolean {
  return CACHEABLE_PRESENTATION_STATUSES.includes(status);
}

/** Unified presenter card returned by every opportunity REST surface. */
export interface PresentedOpportunity {
  opportunityId: string;
  status: OpportunityStatus;
  createdAt?: string;
  updatedAt?: string;
  peer: {
    userId: string;
    name: string;
    avatar: string | null;
  };
  viewerRole?: string;
  headline?: string;
  mainText: string;
  cta: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  presentationPending?: boolean;
  personalizedSummary?: string;
  narratorRemark?: string;
  acceptedAt?: string | null;
}

export interface PresentedOpportunityList {
  opportunities: PresentedOpportunity[];
  meta: { totalOpportunities: number };
}

export interface RadarCardInput {
  opportunityId: string;
  createdAt?: string;
  status?: OpportunityStatus;
  userId: string;
  name: string;
  avatar: string | null;
  mainText: string;
  cta: string;
  headline?: string;
  primaryActionLabel: string;
  secondaryActionLabel: string;
  mutualIntentsLabel: string;
  narratorChip?: { name: string; text: string; avatar?: string | null; userId?: string };
  viewerRole?: string;
  presentationPending?: boolean;
}

export interface ChatContextCardInput {
  opportunityId: string;
  headline: string;
  personalizedSummary: string;
  narratorRemark: string;
  peerName: string;
  peerAvatar: string | null;
  acceptedAt: string | null;
  peerUserId?: string;
  status?: OpportunityStatus;
  createdAt?: string;
}

export function radarItemToPresentedOpportunity(item: RadarCardInput): PresentedOpportunity {
  return {
    opportunityId: item.opportunityId,
    status: item.status ?? 'pending',
    createdAt: item.createdAt,
    peer: {
      userId: item.userId,
      name: item.name,
      avatar: item.avatar,
    },
    viewerRole: item.viewerRole,
    headline: item.headline,
    mainText: item.mainText,
    cta: item.cta,
    primaryActionLabel: item.primaryActionLabel,
    secondaryActionLabel: item.secondaryActionLabel,
    mutualIntentsLabel: item.mutualIntentsLabel,
    narratorChip: item.narratorChip,
    presentationPending: item.presentationPending,
    personalizedSummary: item.mainText,
    narratorRemark: item.narratorChip?.text ?? '',
  };
}

export function chatCardToPresentedOpportunity(card: ChatContextCardInput): PresentedOpportunity {
  return {
    opportunityId: card.opportunityId,
    status: card.status ?? 'accepted',
    createdAt: card.createdAt,
    updatedAt: card.acceptedAt ?? undefined,
    peer: {
      userId: card.peerUserId ?? '',
      name: card.peerName,
      avatar: card.peerAvatar,
    },
    headline: card.headline,
    mainText: card.personalizedSummary,
    cta: card.headline,
    primaryActionLabel: '',
    secondaryActionLabel: '',
    mutualIntentsLabel: '',
    personalizedSummary: card.personalizedSummary,
    narratorRemark: card.narratorRemark,
    acceptedAt: card.acceptedAt,
  };
}
