export const CONVERSATION_TYPES = {
  HOME_FEED: 'home_feed',
  AI_CHAT: 'ai_chat',
  HUMAN_CHAT: 'human_chat',
} as const;

export type ConversationType = typeof CONVERSATION_TYPES[keyof typeof CONVERSATION_TYPES];

export interface ConversationAppData {
  type: ConversationType;
  title?: string;
  opportunityIds?: string[];
}
