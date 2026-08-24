import { isActionableForViewer, safeFallbackSummary } from '@indexnetwork/protocol';

import type { OpportunityRow, UserIdentity } from '../adapters/database.shared';
import type { NotificationStreamEvent } from '../lib/notification-stream-events';

const OPPORTUNITY_NOTIFICATION_HEADLINE = 'A promising connection';
const OPPORTUNITY_NOTIFICATION_EMPTY_SUMMARY = 'A new match that might be relevant to you.';
export const NOTIFICATION_LABEL_MAX_CHARS = 80;

/**
 * Question-message notification copy (conversational questions,
 * docs/plans/2026-08-18-conversational-questions.md). The message is the
 * notification unit, so the frame counts questions and names the signal —
 * it never renders the agent-authored question text itself, which belongs in
 * the DM behind the deep link.
 */
const QUESTION_NOTIFICATION_HEADLINE = 'Your agent needs an answer';
const QUESTION_NOTIFICATION_UNLABELLED_SIGNAL = 'one of your signals';

export interface QuestionMessageNotificationProjection {
  headline: string;
  summary: string;
  /** Absolute deep link to the signal's DM. */
  link: string;
}

export interface OpportunityNotificationProjection {
  headline: string;
  summary: string;
  counterpartyName: string;
}

export interface OpportunityNotificationIdentities {
  viewer: UserIdentity | null;
  counterpart: UserIdentity | null;
  introducer?: UserIdentity | null;
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
  return otherActors.find(({ role }) => role !== 'introducer') ?? otherActors[0];
}

/**
 * The signal's DM as a link: the web app renders the
 * ('negotiator-intent', intentId) conversation in the Personal Agent panel of
 * the signal page, so the DM's address is the signal's address.
 */
export function questionMessageDeepLink(intentId: string, webAppUrl: string): string {
  return `${webAppUrl.replace(/\/+$/, '')}/i/${encodeURIComponent(intentId)}`;
}

/**
 * One question-message → one notification frame, whatever it asks. The count
 * is copy, not a fan-out: batching is the whole point of hanging the
 * notification off the message rather than off its questions.
 */
export function buildQuestionMessageNotification(input: {
  intentId: string;
  questionCount: number;
  signalLabel?: string;
  webAppUrl: string;
}): QuestionMessageNotificationProjection {
  const count = Math.max(1, Math.trunc(input.questionCount));
  const label = boundedNotificationLabel(input.signalLabel);
  const signal = label ? `“${label}”` : QUESTION_NOTIFICATION_UNLABELLED_SIGNAL;
  return {
    headline: QUESTION_NOTIFICATION_HEADLINE,
    summary: `${count} ${count === 1 ? 'question' : 'questions'} about ${signal}.`,
    link: questionMessageDeepLink(input.intentId, input.webAppUrl),
  };
}

/**
 * The wire frame for one question-message, built once and used by both
 * deliveries: the live `question.new` publish when the message lands, and the
 * `/notifications/snapshot` projection a client offline at that moment reads
 * on connect. Same id (the message), same server-owned copy, same deep link —
 * so a client that saw the live frame recognizes the snapshot entry as the
 * same notification rather than a second one.
 */
export function buildQuestionMessageStreamEvent(input: {
  messageId: string;
  intentId: string;
  questionCount: number;
  signalLabel?: string;
  webAppUrl: string;
}): NotificationStreamEvent {
  const projection = buildQuestionMessageNotification({
    intentId: input.intentId,
    questionCount: input.questionCount,
    ...(input.signalLabel ? { signalLabel: input.signalLabel } : {}),
    webAppUrl: input.webAppUrl,
  });
  return {
    type: 'question.new',
    id: input.messageId,
    title: projection.headline,
    body: projection.summary,
    link: projection.link,
  };
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
      introducerName: displayName(identities.introducer, ''),
      emptyText: OPPORTUNITY_NOTIFICATION_EMPTY_SUMMARY,
    }),
    counterpartyName,
  };
}
