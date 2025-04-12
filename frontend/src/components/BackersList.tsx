'use client';

interface Backer {
  name: string;
  feedback: string;
  successRate: number;
  stakedAmount: number;
}

interface BackersListProps {
  backers: Backer[];
}

export default function BackersList({ backers }: BackersListProps) {
  return (
    <div className="space-y-2">
      {backers.map((backer, index) => (
        <div key={index} className="p-4 bg-gray-50 rounded-lg border border-gray-100">
          <div className="flex justify-between items-center">
            <span className="font-medium text-gray-900">{backer.name}</span>
            <span className="text-sm text-gray-500">Staked: {backer.stakedAmount} IDX</span>
          </div>
          <p className="mt-2 text-sm text-gray-600">{backer.feedback}</p>
          <p className="mt-1 text-sm text-gray-500">
            Success Rate: {Math.round(backer.successRate * 100)}%
          </p>
        </div>
      ))}
    </div>
  );
} 