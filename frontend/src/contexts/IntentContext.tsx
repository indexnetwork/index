'use client';

import React, { createContext, useContext, useState, ReactNode } from 'react';

type Intent = {
  id: number;
  title: string;
  createdAt: string;
  status: 'active' | 'stopped' | 'draft' | 'completed';
  userStake: number;
  agentStake: number;
  pendingProposals: number;
  acceptedProposals: number;
  totalProposals: number;
  matches: number;
  stakes: number;
};

type Proposal = {
  id: number;
  name: string;
  role: string;
  avatar: string;
  matchReason: string;
  createdAt: string;
  stakeDistribution: {
    reputation: number;
    relevancy: number;
    urgency: number;
    intentHistory: number;
  };
  backers: {
    name: string;
    feedback: string;
    successRate: number;
    stakedAmount: number;
  }[];
};

type IntentContextType = {
  intents: Intent[];
  proposals: Proposal[];
  getIntentById: (id: number) => Intent | undefined;
  getProposalsByIntentId: (intentId: number) => Proposal[];
  updateIntentStatus: (id: number, status: 'active' | 'stopped') => void;
  handleProposalAction: (intentId: number, proposalId: number, action: 'accept' | 'decline') => void;
};

const IntentContext = createContext<IntentContextType | undefined>(undefined);

// Mock data
const mockIntents: Intent[] = [
  {
    id: 1,
    title: 'Looking for a founding engineer focused on privacy-preserving AI',
    createdAt: '2024-04-10',
    status: 'active',
    userStake: 20,
    agentStake: 15,
    pendingProposals: 3,
    acceptedProposals: 2,
    totalProposals: 5,
    matches: 3,
    stakes: 750,
  },
  {
    id: 2,
    title: 'Exploring investors aligned with decentralized identity and confidential compute',
    createdAt: '2024-04-03',
    status: 'active',
    userStake: 30,
    agentStake: 25,
    pendingProposals: 5,
    acceptedProposals: 0,
    totalProposals: 5,
    matches: 5,
    stakes: 1250,
  },
  {
    id: 3,
    title: 'Need collaborator for zero-knowledge proof implementation',
    createdAt: '2024-04-07',
    status: 'active',
    userStake: 15,
    agentStake: 10,
    pendingProposals: 2,
    acceptedProposals: 0,
    totalProposals: 2,
    matches: 2,
    stakes: 425,
  },
  {
    id: 4,
    title: 'Looking for senior Rust developer with experience in privacy solutions',
    createdAt: '2024-04-05',
    status: 'active',
    userStake: 25,
    agentStake: 20,
    pendingProposals: 1,
    acceptedProposals: 0,
    totalProposals: 1,
    matches: 1,
    stakes: 550,
  },
  {
    id: 5,
    title: 'Seeking market insights for decentralized identity products',
    createdAt: '2024-03-27',
    status: 'completed',
    userStake: 0,
    agentStake: 0,
    pendingProposals: 0,
    acceptedProposals: 7,
    totalProposals: 7,
    matches: 7,
    stakes: 0,
  },
  {
    id: 6,
    title: 'Need technical advisor with experience in scaling web3 applications',
    createdAt: '2024-04-09',
    status: 'draft',
    userStake: 0,
    agentStake: 0,
    pendingProposals: 0,
    acceptedProposals: 0,
    totalProposals: 0,
    matches: 0,
    stakes: 0,
  }
];

const mockProposals: Proposal[] = [
  {
    id: 1,
    name: 'Sarah Chen',
    role: 'Senior AI Engineer',
    avatar: 'https://i.pravatar.cc/150?img=1',
    matchReason: 'Extensive experience in privacy-preserving ML and federated learning. Previously worked at DeepMind on confidential computing.',
    createdAt: '2024-04-11',
    stakeDistribution: {
      reputation: 0.8,
      relevancy: 0.9,
      urgency: 0.7,
      intentHistory: 0.5,
    },
    backers: [
      {
        name: 'AI Talent Scout',
        feedback: 'Strong match based on technical expertise and previous work in privacy-preserving AI',
        successRate: 0.85,
        stakedAmount: 10,
      },
    ],
  },
  {
    id: 2,
    name: 'Michael Rodriguez',
    role: 'ML Engineer',
    avatar: 'https://i.pravatar.cc/150?img=2',
    matchReason: 'Specialized in differential privacy and secure multi-party computation. Open source contributor to privacy-focused ML frameworks.',
    createdAt: '2024-04-12',
    stakeDistribution: {
      reputation: 0.7,
      relevancy: 0.8,
      urgency: 0.6,
      intentHistory: 0.5,
    },
    backers: [
      {
        name: 'Tech Talent Finder',
        feedback: 'Excellent technical fit with relevant open source contributions',
        successRate: 0.75,
        stakedAmount: 8,
      },
    ],
  },
];

export function IntentProvider({ children }: { children: ReactNode }) {
  const [intents, setIntents] = useState<Intent[]>(mockIntents);
  const [proposals, setProposals] = useState<Proposal[]>(mockProposals);

  const getIntentById = (id: number) => {
    return intents.find(intent => intent.id === id);
  };

  const getProposalsByIntentId = (intentId: number) => {
    // In a real app, this would filter proposals by intentId
    return proposals;
  };

  const updateIntentStatus = (id: number, status: 'active' | 'stopped') => {
    setIntents(prev => prev.map(intent => 
      intent.id === id ? { ...intent, status } : intent
    ));
  };

  const handleProposalAction = (intentId: number, proposalId: number, action: 'accept' | 'decline') => {
    setProposals(prev => prev.filter(p => p.id !== proposalId));
    setIntents(prev => prev.map(intent => {
      if (intent.id === intentId) {
        return {
          ...intent,
          pendingProposals: intent.pendingProposals - 1,
          acceptedProposals: action === 'accept' ? intent.acceptedProposals + 1 : intent.acceptedProposals
        };
      }
      return intent;
    }));
  };

  return (
    <IntentContext.Provider value={{
      intents,
      proposals,
      getIntentById,
      getProposalsByIntentId,
      updateIntentStatus,
      handleProposalAction,
    }}>
      {children}
    </IntentContext.Provider>
  );
}

export function useIntent() {
  const context = useContext(IntentContext);
  if (context === undefined) {
    throw new Error('useIntent must be used within an IntentProvider');
  }
  return context;
} 