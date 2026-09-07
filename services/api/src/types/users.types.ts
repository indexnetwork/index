import { ISODateString, UUID } from './common.types';

export interface UserSocial {
  id: string;
  userId: string;
  label: string;
  value: string;
}

export interface NotificationPreferences {
  connectionUpdates: boolean;
}

export interface OnboardingState {
  completedAt?: ISODateString | null;
  profileConfirmedAt?: ISODateString;
  firstSignalIntentId?: UUID;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks' | 'first_signal' | 'complete';
  networkId?: UUID | null;
  invitationCode?: string;
}

export interface User {
  id: UUID;
  email: string | null;
  name: string;
  intro: string | null;
  avatar: string | null;
  location?: string | null;
  timezone?: string | null;
  socials: UserSocial[];
  notificationPreferences?: NotificationPreferences;
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
  timezone?: string;
  notificationPreferences?: NotificationPreferences;
}

export interface UserSummary {
  id: UUID;
  name: string;
  avatar: string | null;
}
