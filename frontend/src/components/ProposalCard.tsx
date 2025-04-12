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
    <div className="p-6 bg-white rounded-xl shadow-sm">
      <div className="flex items-start space-x-4">
        <img src={proposal.avatar} alt={proposal.name} className="w-12 h-12 rounded-full" />
        <div className="flex-1">
          <div className="flex justify-between items-start">
            <div>
              <h3 className="font-semibold text-gray-900">{proposal.name}</h3>
              <p className="text-sm text-gray-500">{proposal.role}</p>
            </div>
            <div className="flex space-x-2">
              <button 
                onClick={onAccept}
                className="px-3 py-1 bg-green-100 text-green-800 rounded-lg text-sm hover:bg-green-200"
              >
                Accept
              </button>
              <button 
                onClick={onDecline}
                className="px-3 py-1 bg-red-100 text-red-800 rounded-lg text-sm hover:bg-red-200"
              >
                Decline
              </button>
            </div>
          </div>

          <p className="mt-4 text-gray-700">{proposal.matchReason}</p>
          <p className="mt-2 text-sm text-gray-500">Proposed {proposal.createdAt}</p>

          {/* Stake Distribution Chart */}
          <div className="mt-4">
            <div className="mt-2">
              <StakeDistributionChart distribution={proposal.stakeDistribution} />
            </div>
          </div>

          {/* Backers */}
          <div className="mt-4">
            <h4 className="text-sm font-medium text-gray-900">Backers</h4>
            <div className="mt-2">
              <BackersList backers={proposal.backers} />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
} 