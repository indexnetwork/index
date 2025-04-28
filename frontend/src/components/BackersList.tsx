'use client';

import { Backer } from '@/types';
import * as Tooltip from '@radix-ui/react-tooltip';

interface BackersListProps {
  backers: Backer[];
}

export default function BackersList({ backers }: BackersListProps) {
  if (!backers.length) {
    return (
      <div className="text-center py-4 text-gray-500 dark:text-gray-400">
        No backers yet
      </div>
    );
  }

  return (
    <Tooltip.Provider>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {backers.map((backer, index) => (
          <div 
            key={index} 
            className="group flex items-center justify-between p-3 hover:bg-gray-50 dark:hover:bg-gray-700/50 transition-colors rounded-lg border border-gray-100 dark:border-gray-700/50 bg-white dark:bg-gray-800/50 backdrop-blur-sm"
          >
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-8 h-8 rounded-full bg-gray-50 dark:bg-gray-800 ring-2 ring-white dark:ring-gray-700 flex-shrink-0 flex items-center justify-center text-gray-400">
                {backer.avatar ? (
                  <img src={backer.avatar} alt={backer.name} className="w-full h-full rounded-full object-cover" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
                  </svg>
                )}
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <h3 className="text-sm font-medium text-gray-900 dark:text-white truncate">{backer.name}</h3>
                  <span className="text-xs font-medium text-indigo-600 dark:text-indigo-400 whitespace-nowrap">{backer.role}</span>
                </div>
                {backer.feedback && (
                  <Tooltip.Root>
                    <Tooltip.Trigger asChild>
                      <p className="text-xs text-gray-600 dark:text-gray-300 line-clamp-2 hover:line-clamp-none transition-all mt-0.5">
                        {backer.feedback}
                      </p>
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                      <Tooltip.Content
                        className="bg-gray-900 dark:bg-gray-800 text-white text-xs rounded-md px-2 py-1 max-w-xs border border-gray-800 dark:border-gray-700"
                        sideOffset={5}
                      >
                        {backer.feedback}
                        <Tooltip.Arrow className="fill-gray-900 dark:fill-gray-800" />
                      </Tooltip.Content>
                    </Tooltip.Portal>
                  </Tooltip.Root>
                )}
              </div>
            </div>
            <div className="text-right flex-shrink-0">
              <div className="text-sm font-semibold text-gray-900 dark:text-white">${backer.stakedAmount}</div>
              <div className="text-xs text-gray-500 dark:text-gray-400">Staked</div>
            </div>
          </div>
        ))}
      </div>
    </Tooltip.Provider>
  );
} 