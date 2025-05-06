'use client';

import { useState } from 'react';
import Link from 'next/link';

export default function AgentWallet() {
  const [seedCapital, setSeedCapital] = useState('500');
  const [walletAddress, setWalletAddress] = useState('');
  const [network, setNetwork] = useState('mainnet');
  const [autoReplenish, setAutoReplenish] = useState(false);
  const [replenishThreshold, setReplenishThreshold] = useState('100');

  const networks = [
    { id: 'mainnet', name: 'Ethereum Mainnet' },
    { id: 'optimism', name: 'Optimism' },
    { id: 'arbitrum', name: 'Arbitrum' },
    { id: 'base', name: 'Base' },
  ];

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex flex-col space-y-4 mb-8">
            <Link 
              href="/agent"
              className="text-sm text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors"
            >
              ← Back to Agent
            </Link>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Agent Wallet</h2>
          </div>

          <div className="bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-8 border border-gray-100 dark:border-gray-700/50">
            <p className="text-lg leading-8 text-gray-600 dark:text-gray-300/95 font-light tracking-normal mb-10 max-w-2xl">
              Manage your agent's wallet settings and funding preferences.
            </p>

            <div className="space-y-8">
              {/* Wallet Address */}
              <div className="space-y-2">
                <label htmlFor="walletAddress" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Wallet Address
                </label>
                <input
                  type="text"
                  id="walletAddress"
                  placeholder="0x..."
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                />
              </div>

              {/* Network Selection */}
              <div className="space-y-2">
                <label htmlFor="network" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Network
                </label>
                <select
                  id="network"
                  className="w-full px-4 py-2 border border-gray-300 rounded-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                  value={network}
                  onChange={(e) => setNetwork(e.target.value)}
                >
                  {networks.map((net) => (
                    <option key={net.id} value={net.id}>
                      {net.name}
                    </option>
                  ))}
                </select>
              </div>

              {/* Seed Capital Allocation */}
              <div className="space-y-2">
                <label htmlFor="seedCapital" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                  Seed Capital Allocation
                </label>
                <div className="flex items-center">
                  <span className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-md">
                    $
                  </span>
                  <input
                    type="number"
                    id="seedCapital"
                    className="flex-1 px-4 py-2 border border-gray-300 rounded-r-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                    value={seedCapital}
                    onChange={(e) => setSeedCapital(e.target.value)}
                  />
                </div>
              </div>

              {/* Auto Replenish Settings */}
              <div className="space-y-4">
                <div className="flex items-center">
                  <input
                    type="checkbox"
                    id="autoReplenish"
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    checked={autoReplenish}
                    onChange={(e) => setAutoReplenish(e.target.checked)}
                  />
                  <label htmlFor="autoReplenish" className="ml-2 block text-sm text-gray-700 dark:text-gray-200">
                    Enable Auto Replenish
                  </label>
                </div>
                
                {autoReplenish && (
                  <div className="space-y-2 pl-6">
                    <label htmlFor="replenishThreshold" className="block text-sm font-medium text-gray-700 dark:text-gray-200">
                      Replenish Threshold
                    </label>
                    <div className="flex items-center">
                      <span className="px-3 py-2 bg-gray-100 dark:bg-gray-700 border border-r-0 border-gray-300 dark:border-gray-600 rounded-l-md">
                        $
                      </span>
                      <input
                        type="number"
                        id="replenishThreshold"
                        className="flex-1 px-4 py-2 border border-gray-300 rounded-r-md focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:border-gray-600"
                        value={replenishThreshold}
                        onChange={(e) => setReplenishThreshold(e.target.value)}
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-end space-x-3 mt-6">
                <button
                  type="button"
                  className="px-4 py-2 text-white bg-indigo-600 dark:bg-indigo-500 rounded-lg hover:bg-indigo-700 dark:hover:bg-indigo-600 transition-colors"
                >
                  Save Settings
                </button>
              </div>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
} 