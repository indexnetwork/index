import { ISODateString, UUID } from './common.types';

export interface UserSocial {
  id: string;
  userId: string;
  label: string;
  value: string;
}

export interface NotificationPreferences {
  opportunity?: boolean;
  accepted?: boolean;
  messages?: boolean;
  /** Absent means the morning wake is on. */
  morningBrief?: boolean;
  /** Absent means a toast when an introduction you made moves or hears back. */
  introductions?: boolean;
  /** What your introducer learns once your side settles. Absent means `status`. */
  introducerReports?: 'note' | 'status' | 'none';
}

export interface OnboardingState {
  completedAt?: ISODateString | null;
  profileConfirmedAt?: ISODateString;
  firstIntentId?: UUID;
  flow?: 1 | 2 | 3;
  currentStep?: 'profile' | 'summary' | 'connections' | 'create_network' | 'invite_members' | 'join_networks' | 'first_intent' | 'complete';
  networkId?: UUID | null;
  invitationCode?: string;
  mcpOnboardedAt?: ISODateString;
}

export interface User {
  id: UUID;
  email: string | null;
  name: string;
  /** Public handle in profile URLs (`/u/:username`); null until claimed. */
  username?: string | null;
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
  /** Empty or null clears it. */
  username?: string | null;
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
