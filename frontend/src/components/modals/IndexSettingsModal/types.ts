export interface MemberIntent {
  id: string;
  payload: string;
  summary?: string;
  createdAt: string;
}

export interface MemberSettings {
  indexTitle: string;
  indexPrompt?: string;
  memberPrompt?: string;
  autoAssign: boolean;
  permissions: string[];
  isOwner: boolean;
}

export interface TagSuggestion {
  tag: string;
  relevanceScore: number;
  relatedIntentIds: string[];
  description?: string;
}

export interface Member {
  id: string;
  name: string;
  email: string;
  permissions: string[];
  avatar?: string;
}

export interface PublicPermission {
  id: string;
  label: string;
  description: string;
}

export type TabType = 'member' | 'owner';
