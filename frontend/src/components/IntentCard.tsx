'use client';

import Link from 'next/link';

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

interface IntentCardProps {
  intent: Intent;
}

export default function IntentCard({ intent }: IntentCardProps) {
  return (
    <Link href={`/intents/${intent.id}`} className="block p-6 bg-white rounded-xl shadow-sm hover:shadow-md transition-all duration-200">
      <div className="flex justify-between items-start">
        <div>
          <h2 className="text-lg font-semibold text-gray-900">{intent.title}</h2>
          <p className="text-sm text-gray-500">Created {intent.createdAt}</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-sm ${
          intent.status === 'active' ? 'bg-green-100 text-green-800' : 'bg-red-100 text-red-800'
        }`}>
          {intent.status}
        </span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-4">
        <div>
          <p className="text-sm text-gray-500">User Stake</p>
          <p className="font-medium">{intent.userStake} IDX</p>
        </div>
        <div>
          <p className="text-sm text-gray-500">Agent Stake</p>
          <p className="font-medium">{intent.agentStake} IDX</p>
        </div>
      </div>

      <div className="mt-4">
        <div className="flex justify-between text-sm">
          <span className="text-gray-500">Pending: {intent.pendingProposals}</span>
          <span className="text-gray-500">Accepted: {intent.acceptedProposals}</span>
          <span className="text-gray-500">Total: {intent.totalProposals}</span>
        </div>
      </div>

      <div className="mt-4">
        <button className="text-blue-600 hover:text-blue-800 text-sm font-medium">
          Increase Stake
        </button>
      </div>
    </Link>
  );
} 