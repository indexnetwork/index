'use client';

interface Backer {
  name: string;
  feedback: string;
  successRate: number;
  stakedAmount: number;
  avatar?: string;
  role?: string;
}

interface BackersListProps {
  backers: Backer[];
}

export default function BackersList({ backers }: BackersListProps) {
  return (
    <div className="bg-white rounded-lg border border-gray-100">
      <div className="divide-y divide-gray-100">
        {backers.map((backer, index) => (
          <div 
            key={index} 
            className="group flex items-center justify-between p-3 hover:bg-gray-50 transition-colors first:rounded-t-lg last:rounded-b-lg"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gray-50 flex-shrink-0 flex items-center justify-center text-gray-400">
                {backer.avatar ? (
                  <img src={backer.avatar} alt={backer.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-medium text-gray-900 truncate">{backer.name}</h3>
                <div className="flex items-center gap-1.5 mt-0.5">
                  <span className="text-xs text-gray-600 truncate">{backer.role || backer.feedback}</span>
                  <span className="text-gray-300 text-xs">•</span>
                  <span className="text-xs text-gray-600">{Math.round(backer.successRate * 100)}% success</span>
                </div>
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm font-semibold text-gray-900">{backer.stakedAmount} Tokens</div>
              <div className="text-xs text-gray-500">Staked</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
} 