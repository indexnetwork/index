import { FlowConfigMap, OnboardingFlow } from "@/types/onboarding";

export const FLOW_CONFIGS = {
  [OnboardingFlow.Personal]: {
    flow: OnboardingFlow.Personal,
    steps: ["profile", "connections", "join_indexes"],
    features: {
      showSlackDiscord: false,
      enableUserAttribution: false,
      requireIndexId: false,
    },
    descriptions: {
      connections:
        "Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for.",
    },
  },
  [OnboardingFlow.Community]: {
    flow: OnboardingFlow.Community,
    steps: ["profile", "create_index", "connections", "invite_members"],
    features: {
      showSlackDiscord: true,
      enableUserAttribution: true,
      requireIndexId: true,
    },
    descriptions: {
      connections:
        "Link the platforms where your people already works and shares. Nobody gets notified for now. We recommend connecting every account you use regularly so Index has a full picture of your ecosystem.",
    },
  },
  [OnboardingFlow.Invitation]: {
    flow: OnboardingFlow.Invitation,
    steps: ["profile", "connections"],
    features: {
      showSlackDiscord: false,
      enableUserAttribution: false,
      requireIndexId: false,
    },
    descriptions: {
      connections:
        "Link the places you already work and share. Nobody gets notified, and it's only used to understand what you're looking for.",
    },
  },
} satisfies FlowConfigMap;

// Mock indexes for the final step (fallback if no public indexes)
export const MOCK_INDEXES = [
  {
    id: "index-early",
    name: "Index Early",
    description: "AI, Web3, Decentralization",
    members: 1250,
  },
  {
    id: "techstars",
    name: "Techstars Universe",
    description: "AI, Web3, Decentralization",
    members: 890,
  },
  {
    id: "base",
    name: "Base",
    description: "AI, Web3, Decentralization",
    members: 2100,
  },
  {
    id: "consensys",
    name: "Consensys",
    description: "AI, Web3, Decentralization",
    members: 750,
  },
  {
    id: "protocol-labs",
    name: "Protocol Labs",
    description: "AI, Web3, Decentralization",
    members: 1400,
  },
  {
    id: "kernel",
    name: "Kernel",
    description: "AI, Web3, Decentralization",
    members: 680,
  },
];
