'use client';

import Link from 'next/link';

interface Intent {
  id: number;
  title: string;
  status: 'open' | 'closed';
  pendingConnections: number;
  confirmedConnections: number;
  totalConnections: number;
}

interface IntentCardProps {
  intent: Intent;
  onClick: () => void;
}

export default function IntentCard({ intent, onClick }: IntentCardProps) {
  return (
    <div 
      className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow-md dark:shadow-gray-900/10 p-6 hover:shadow-lg dark:hover:shadow-gray-900/20 transition-all cursor-pointer border border-gray-100 dark:border-gray-700/50"
      onClick={onClick}
    >
      <div className="p-4">
        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">{intent.title}</h3>
        <div className="mt-2 flex items-center justify-between">
          <span className={`px-2 py-1 text-xs font-medium rounded-full ${
            intent.status === 'open' 
              ? 'bg-green-100 dark:bg-green-900/50 text-green-800 dark:text-green-400' 
              : 'bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-300'
          }`}>
            {intent.status}
          </span>
          <span className="text-sm text-gray-500 dark:text-gray-400">
            {intent.confirmedConnections}/{intent.totalConnections} connections
          </span>
        </div>
      </div>
    </div>
  );
} 