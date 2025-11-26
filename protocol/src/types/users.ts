import { ISODateString, UUID } from './common';

export interface UserSocials {
  x?: string;
  linkedin?: string;
  github?: string;
  websites?: string[];
}

export interface OnboardingState {
  completedAt?: ISODateString | null;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'connections' | 'create_index' | 'invite_members' | 'join_indexes';
  indexId?: UUID | null;
  invitationCode?: string;
}

export interface User {
  id: UUID;
  privyId: string;
  email: string | null;
  name: string;
  intro: string | null;
  avatar: string | null;
  location?: string | null;
  socials?: UserSocials;
  onboarding?: OnboardingState;
  createdAt: ISODateString;
  updatedAt: ISODateString;
  deletedAt?: ISODateString | null;
}

export interface UpdateProfileRequest {
  name?: string;
  intro?: string;
  avatar?: string;
  location?: string;
  socials?: UserSocials;
}

// Minimal user representation often used in other objects
export interface UserSummary {
  id: UUID;
  name: string;
  avatar: string | null;
}