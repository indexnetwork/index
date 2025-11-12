import { IntegrationName } from "@/config/integrations";

export enum OnboardingStep {
  Profile = "profile",
  Connections = "connections",
  CreateIndex = "create_index",
  InviteMembers = "invite_members",
  JoinIndexes = "join_indexes",
}

export enum OnboardingFlow {
  Personal = 1,
  Community = 2,
  Invitation = 3,
}

export interface IntegrationState {
  id: string | null; // The actual integration UUID
  type: IntegrationName; // The integration type (slack, discord, etc.)
  name: string;
  connected: boolean;
  indexId?: string | null;
}

export type FlowFeatures = {
  showSlackDiscord: boolean;
  enableUserAttribution: boolean;
  requireIndexId: boolean;
};

export type FlowDescriptions = {
  connections: string;
};

export type FlowConfigBase = {
  flow: OnboardingFlow;
  steps: readonly OnboardingStep[];
  features: FlowFeatures;
  descriptions: FlowDescriptions;
};

export type PersonalFlowConfig = FlowConfigBase & {
  flow: OnboardingFlow.Personal;
};

export type CommunityFlowConfig = FlowConfigBase & {
  flow: OnboardingFlow.Community;
};

export type InvitationFlowConfig = FlowConfigBase & {
  flow: OnboardingFlow.Invitation;
};

export type FlowConfigMap = {
  [OnboardingFlow.Personal]: PersonalFlowConfig;
  [OnboardingFlow.Community]: CommunityFlowConfig;
  [OnboardingFlow.Invitation]: InvitationFlowConfig;
};

export interface OnboardingMember {
  id: string;
  name: string;
}