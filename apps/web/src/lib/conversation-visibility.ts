import type { ConversationSummary } from '@/services/conversation';

/**
 * Returns whether a conversation belongs in the human-to-human Messages list.
 *
 * Participant topology is canonical: persona cannot distinguish these rows
 * because ordinary H2H conversations also inherit the `orchestrator` default.
 */
export function isVisibleH2HConversation(
  conversation: Pick<ConversationSummary, 'participants'>,
): boolean {
  const participants = conversation.participants ?? [];
  return participants.length === 2
    && participants.every((participant) => participant.participantType === 'user');
}
