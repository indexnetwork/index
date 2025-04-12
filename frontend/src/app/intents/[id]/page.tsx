'use client';

import { useState } from 'react';
import ProposalCard from '@/components/ProposalCard';
import IntentHeader from '@/components/IntentHeader';
import Link from 'next/link';

type Intent = {
  id: number;
  title: string;
  createdAt: string;
  status: 'active' | 'stopped';
  userStake: number;
  agentStake: number;
  pendingProposals: number;
  acceptedProposals: number;
  totalProposals: number;
};

// Mock data for a single intent
const mockIntent: Intent = {
  id: 1,
  title: 'Looking for a founding engineer focused on privacy-preserving AI',
  createdAt: '2024-04-10',
  status: 'active',
  userStake: 20,
  agentStake: 15,
  pendingProposals: 3,
  acceptedProposals: 2,
  totalProposals: 5,
};

// Mock data for proposals
const mockProposals = [
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

export default function IntentPage({ params }: { params: { id: string } }) {
  const [intent, setIntent] = useState(mockIntent);
  const [proposals, setProposals] = useState(mockProposals);

  const handleStatusToggle = () => {
    setIntent(prev => ({
      ...prev,
      status: prev.status === 'active' ? 'stopped' : 'active'
    }));
  };

  const handleProposalAction = (proposalId: number, action: 'accept' | 'decline') => {
    setProposals(prev => prev.filter(p => p.id !== proposalId));
    setIntent(prev => ({
      ...prev,
      pendingProposals: prev.pendingProposals - 1,
      acceptedProposals: action === 'accept' ? prev.acceptedProposals + 1 : prev.acceptedProposals
    }));
  };

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">Intent Details</h2>
            <div className="flex space-x-3">
              <Link 
                href="/intents"
                className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50"
              >
                Back to Intents
              </Link>
            </div>
          </div>

          <div className="space-y-8">
            <IntentHeader intent={intent} onStatusToggle={handleStatusToggle} />

            {/* Proposals Section */}
            <div className="space-y-6">
              <h2 className="text-xl font-semibold text-gray-900">Proposals</h2>
              <div className="space-y-4">
                {proposals.map((proposal) => (
                  <ProposalCard
                    key={proposal.id}
                    proposal={proposal}
                    onAccept={() => handleProposalAction(proposal.id, 'accept')}
                    onDecline={() => handleProposalAction(proposal.id, 'decline')}
                  />
                ))}
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 