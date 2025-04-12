'use client';

import StakeDistributionChart from './StakeDistributionChart';
import BackersList from './BackersList';

interface Backer {
  name: string;
  feedback: string;
  successRate: number;
  stakedAmount: number;
}

interface Proposal {
  id: number;
  name: string;
  role: string;
  avatar: string;
  matchReason: string;
  createdAt: string;
  stakeDistribution: {
    relevancy: number;
    reputation: number;
    intentHistory: number;
    urgency: number;
  };
  backers: Backer[];
}

interface ProposalCardProps {
  proposal: Proposal;
  onAccept: () => void;
  onDecline: () => void;
}

export default function ProposalCard({ proposal, onAccept, onDecline }: ProposalCardProps) {
  return (
    <div className="p-6 bg-white rounded-xl border border-gray-200 shadow-sm">
      {/* Header Section */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-4">
          <img 
            src={proposal.avatar} 
            alt={proposal.name} 
            className="w-12 h-12 rounded-full border-2 border-gray-100"
          />
          <div>
            <h3 className="text-lg font-semibold text-gray-900">{proposal.name}</h3>
            <p className="text-sm text-gray-600">{proposal.role}</p>
            <p className="mt-1 text-xs text-gray-500 font-medium">Proposed on {proposal.createdAt}</p>
          </div>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={onAccept}
            className="px-6 py-2.5 text-sm font-semibold text-green-700 bg-green-50 rounded-lg hover:bg-green-100 transition-colors"
          >
            Accept
          </button>
          <button 
            onClick={onDecline}
            className="px-6 py-2.5 text-sm font-semibold text-red-700 bg-red-50 rounded-lg hover:bg-red-100 transition-colors"
          >
            Decline
          </button>
        </div>
      </div>

      {/* Description Section */}
      <div className="mt-5">
      <h4 className="text-sm font-medium text-gray-900 mb-3">Why this match is relevant?</h4>
        <p className="text-base text-gray-700 leading-relaxed">{proposal.matchReason}</p>
      </div>

      {/* Stake Distribution Section */}
      <div className="mt-6">
        <StakeDistributionChart distribution={proposal.stakeDistribution} />
      </div>

      {/* Backers Section */}
      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-900 mb-3">Who's backing this match</h4>
        <BackersList backers={proposal.backers} />
      </div>
    </div>
  );
} 