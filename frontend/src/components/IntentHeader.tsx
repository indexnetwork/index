'use client';

import { Clock, Users, Zap } from 'lucide-react';

interface Intent {
  id: number;
  title: string;
  createdAt: string;
  status: 'active' | 'stopped';
  userStake: number;
  agentStake: number;
  pendingProposals: number;
  acceptedProposals: number;
  totalProposals: number;
}

interface IntentHeaderProps {
  intent: Intent;
  onStatusToggle: () => void;
}

export default function IntentHeader({ intent, onStatusToggle }: IntentHeaderProps) {
  return (
    <div className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
      <div className="flex justify-between items-start">
        <div className="flex-1">
          <h1 className="text-lg font-medium text-gray-900 mb-2">{intent.title}</h1>
          <div className="flex items-center text-sm text-gray-500">
            <Clock className="h-4 w-4 mr-1.5" />
            Created {intent.createdAt}
          </div>
        </div>
        <div className="ml-6 flex flex-col items-end">
          <div className="flex space-x-6 mb-3">
            <div className="flex flex-col items-center">
              <div className="flex items-center text-indigo-600 font-medium">
                <Users className="h-4 w-4 mr-1" />
                <span>{intent.totalProposals}</span>
              </div>
              <span className="text-xs text-gray-500">Proposals</span>
            </div>
            <div className="flex flex-col items-center">
              <div className="flex items-center text-indigo-600 font-medium">
                <Zap className="h-4 w-4 mr-1" />
                <span>{intent.userStake + intent.agentStake}</span>
              </div>
              <span className="text-xs text-gray-500">Total Staked</span>
            </div>
          </div>
          <div className="flex items-center space-x-4">
            <span className={`px-3 py-1 rounded-full text-sm ${
              intent.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
            }`}>
              {intent.status}
            </span>
            <button 
              onClick={onStatusToggle}
              className="text-indigo-600 hover:text-indigo-800 text-sm font-medium"
            >
              {intent.status === 'active' ? 'Stop' : 'Resume'}
            </button>
          </div>
        </div>
      </div>

      <div className="mt-4 pt-4 border-t border-gray-100">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Pending: {intent.pendingProposals}</span>
          <span className="text-gray-500">Accepted: {intent.acceptedProposals}</span>
          <span className="text-gray-500">Total: {intent.totalProposals}</span>
        </div>
      </div>
    </div>
  );
} 