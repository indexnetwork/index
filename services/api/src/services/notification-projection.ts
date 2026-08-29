import { isActionableForViewer, safeFallbackSummary } from '@indexnetwork/protocol';

import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';

const OPPORTUNITY_NOTIFICATION_HEADLINE = 'A promising connection';
const OPPORTUNITY_NOTIFICATION_EMPTY_SUMMARY = 'A new match that might be relevant to you.';
export const NOTIFICATION_LABEL_MAX_CHARS = 80;

export interface OpportunityNotificationProjection {
  headline: string;
  summary: string;
  counterpartyName: string;
}

export interface OpportunityNotificationIdentities {
  viewer: UserIdentity | null;
  counterpart: UserIdentity | null;
}

export function boundedNotificationLabel(value: string | null | undefined): string | undefined {
  const label = value?.trim();
  return label ? label.slice(0, NOTIFICATION_LABEL_MAX_CHARS) : undefined;
}

function displayName(identity: UserIdentity | null | undefined, fallback: string): string {
  return boundedNotificationLabel(identity?.identity.name) ?? fallback;
}

export function actionableRecipientIds(opportunity: OpportunityRow): string[] {
  return [...new Set(opportunity.actors.map(({ userId }) => userId))]
    .filter((userId) => isActionableForViewer(opportunity.actors, opportunity.status, userId));
}

export function counterpartForRecipient(
  opportunity: OpportunityRow,
  recipientId: string,
): OpportunityRow['actors'][number] | undefined {
  const otherActors = opportunity.actors.filter(({ userId }) => userId !== recipientId);
  return otherActors[0];
}


export function buildOpportunityNotificationEvent(
  opportunity: OpportunityRow,
  identities: OpportunityNotificationIdentities,
): OpportunityNotificationProjection {
  const counterpartyName = displayName(identities.counterpart, 'Someone');
  return {
    headline: OPPORTUNITY_NOTIFICATION_HEADLINE,
    summary: safeFallbackSummary(opportunity.interpretation.reasoning, {
      counterpartName: counterpartyName,
      viewerName: displayName(identities.viewer, 'you'),
      emptyText: OPPORTUNITY_NOTIFICATION_EMPTY_SUMMARY,
    }),
    counterpartyName,
  };
}
