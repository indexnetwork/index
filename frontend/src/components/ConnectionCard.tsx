'use client';

import { Connection } from '@/types';
import StakeDistributionChart from './StakeDistributionChart';
import BackersList from './BackersList';
import { useIntent } from '@/contexts/IntentContext';
import { useState } from 'react';
import ConnectionAcceptModal from './ConnectionAcceptModal';

interface ConnectionCardProps {
  connection: Connection;
  intentId: number;
  onAccept: () => void;
  onDecline: () => void;
}

export default function ConnectionCard({ connection, intentId, onAccept, onDecline }: ConnectionCardProps) {
  const { addBacker, removeBacker } = useIntent();
  const [isAcceptModalOpen, setIsAcceptModalOpen] = useState(false);

  const handleAddBacker = (backer: { name: string; feedback: string; successRate: number; stakedAmount: number }) => {
    addBacker(intentId, connection.id, backer);
  };

  const handleRemoveBacker = (backerName: string) => {
    removeBacker(intentId, connection.id, backerName);
  };

  const handleAcceptClick = () => {
    setIsAcceptModalOpen(true);
  };

  const handleAcceptConfirm = async () => {
    await onAccept();
  };

  return (
    <>
      <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-md dark:shadow-gray-900/10 p-4 border border-gray-100 dark:border-gray-700/50">
        <div className="flex justify-between items-start gap-4">
          {/* Left section with avatar and basic info */}
          <div className="flex items-start gap-3 flex-1">
            <img
              className="w-10 h-10 rounded-full ring-1 ring-white dark:ring-gray-700"
              src={connection.avatar}
              alt={connection.name}
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <h3 className="text-base font-semibold text-gray-900 dark:text-white truncate">{connection.name}</h3>
                  <span className="text-xs text-gray-500 dark:text-gray-400 whitespace-nowrap">• {connection.role}</span>
                </div>
                <div className="flex items-baseline">
                
                </div>
              </div>
              <p className="text-xs text-gray-500 dark:text-gray-400">Connected on {connection.createdAt}</p>
            </div>
          </div>

          {/* Right section with action buttons */}
          <div className="flex gap-2">
            {connection.status === 'potential' ? (
              <>
                <button
                  onClick={onDecline}
                  className="px-3 py-1.5 text-sm text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
                >
                  Decline
                </button>
                <button
                  onClick={handleAcceptClick}
                  className="px-3 py-1.5 text-sm text-white bg-indigo-600 dark:bg-indigo-500 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                >
                  Accept
                </button>
              </>
            ) : connection.status === 'pending' ? (
              <span className="px-3 py-1.5 text-sm text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
                Pending
              </span>
            ) : connection.status === 'accepted' ? (
              <span className="px-3 py-1.5 text-sm text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-md">
                Accepted
              </span>
            ) : (
              <span className="px-3 py-1.5 text-sm text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">
                Declined
              </span>
            )}
          </div>
        </div>

        {/* Description Section */}
        <div className="mt-3">
          <h4 className="text-xs font-medium text-gray-900 dark:text-white mb-1">Why this match is relevant?</h4>
          <p className="text-sm text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-2">{connection.matchReason}</p>
        </div>

        {/* Backers Section */}
        <div className="mt-3">
          <h4 className="text-xs font-medium text-gray-900 dark:text-white mb-1">Who's backing this match</h4>
          <BackersList backers={connection.backers} />
        </div>

        {/* Stake Distribution Section */}
        <div className="mt-3">
          <StakeDistributionChart distribution={connection.stakeDistribution} />
        </div>      
      </div>

      <ConnectionAcceptModal
        isOpen={isAcceptModalOpen}
        onClose={() => setIsAcceptModalOpen(false)}
        onAccept={handleAcceptConfirm}
        connectionName={connection.name}
      />
    </>
  );
} 