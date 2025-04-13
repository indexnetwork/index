'use client';

import { Clock, Users, Zap } from 'lucide-react';

interface Intent {
  id: number;
  title: string;
  status: 'open' | 'closed';
  pendingConnections: number;
  confirmedConnections: number;
  totalConnections: number;
}

interface IntentHeaderProps {
  intent: Intent;
}

export default function IntentHeader({ intent }: IntentHeaderProps) {
  return (
    <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm border-b border-gray-100 dark:border-gray-700/50">
      <div className="px-4 py-5 sm:px-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">{intent.title}</h1>
            <div className="mt-2 flex items-center space-x-4">
              <span className={`px-3 py-1 text-sm font-medium rounded-full ${
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
      </div>
    </div>
  );
} 