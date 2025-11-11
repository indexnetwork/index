import { IntegrationName } from "@/config/integrations";

export type OnboardingStep =
  | "profile"
  | "connections"
  | "create_index"
  | "invite_members"
  | "join_indexes";

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

export type FlowConfigBase<
  Flow extends OnboardingFlow,
  Steps extends readonly OnboardingStep[]
> = {
  flow: Flow;
  steps: Steps;
  features: FlowFeatures;
  descriptions: FlowDescriptions;
};

export type PersonalFlowConfig = FlowConfigBase<
  OnboardingFlow.Personal,
  ["profile", "connections", "join_indexes"]
>;

export type CommunityFlowConfig = FlowConfigBase<
  OnboardingFlow.Community,
  ["profile", "create_index", "connections", "invite_members"]
>;

export type InvitationFlowConfig = FlowConfigBase<
  OnboardingFlow.Invitation,
  ["profile", "connections"]
>;

export type FlowConfigMap = {
  [OnboardingFlow.Personal]: PersonalFlowConfig;
  [OnboardingFlow.Community]: CommunityFlowConfig;
  [OnboardingFlow.Invitation]: InvitationFlowConfig;
};
