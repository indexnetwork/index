'use client';

import { Connection } from '@/types';
import StakeDistributionChart from './StakeDistributionChart';
import BackersList from './BackersList';
import { useIntent } from '@/contexts/IntentContext';

interface ConnectionCardProps {
  connection: Connection;
  intentId: number;
  onAccept: () => void;
  onDecline: () => void;
}

export default function ConnectionCard({ connection, intentId, onAccept, onDecline }: ConnectionCardProps) {
  const { addBacker, removeBacker } = useIntent();

  const handleAddBacker = (backer: { name: string; feedback: string; successRate: number; stakedAmount: number }) => {
    addBacker(intentId, connection.id, backer);
  };

  const handleRemoveBacker = (backerName: string) => {
    removeBacker(intentId, connection.id, backerName);
  };

  return (
    <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-md dark:shadow-gray-900/10 p-6 border border-gray-100 dark:border-gray-700/50">
      <div className="flex justify-between items-start">
        <div className="flex items-start space-x-4">
          <img
            className="w-12 h-12 rounded-full ring-2 ring-white dark:ring-gray-700"
            src={connection.avatar}
            alt={connection.name}
          />
          <div>
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{connection.name}</h3>
            <p className="text-sm text-gray-600 dark:text-gray-300">{connection.role}</p>
            <p className="mt-1 text-xs text-gray-500 dark:text-gray-400 font-medium">Connected on {connection.createdAt}</p>
          </div>
        </div>
        <div className="flex space-x-3">
          {connection.status === 'potential' ? (
            <>
              <button
                onClick={onDecline}
                className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors"
              >
                Decline
              </button>
              <button
                onClick={onAccept}
                className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-md hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
              >
                Accept
              </button>
            </>
          ) : connection.status === 'pending' ? (
            <span className="px-4 py-2 text-yellow-600 dark:text-yellow-400 bg-yellow-50 dark:bg-yellow-900/20 rounded-md">
              Pending other user's approval
            </span>
          ) : connection.status === 'accepted' ? (
            <span className="px-4 py-2 text-green-600 dark:text-green-400 bg-green-50 dark:bg-green-900/20 rounded-md">
              Accepted
            </span>
          ) : (
            <span className="px-4 py-2 text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 rounded-md">
              Declined
            </span>
          )}
        </div>
      </div>

      {/* Description Section */}
      <div className="mt-5">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Why this match is relevant?</h4>
        <p className="text-base text-gray-700 dark:text-gray-300 leading-relaxed">{connection.matchReason}</p>
      </div>

      {/* Backers Section */}
      <div className="mt-6">
        <h4 className="text-sm font-medium text-gray-900 dark:text-white mb-3">Who's backing this match</h4>
        <BackersList backers={connection.backers} />
      </div>

      {/* Stake Distribution Section */}
      <div className="mt-6">
        <StakeDistributionChart distribution={connection.stakeDistribution} />
      </div>      
    </div>
  );
} 