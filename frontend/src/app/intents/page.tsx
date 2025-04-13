'use client';

import { useState } from 'react';
import { PlusCircle, Filter, Clock, ArrowUpRight, Zap, Award, Lock, Users, Settings, BellDot, Bot } from 'lucide-react';
import Link from 'next/link';
import { useIntent } from '@/contexts/IntentContext';

export default function IntentsPage() {
  const [activeTab, setActiveTab] = useState<'open' | 'closed'>('open');
  const { intents } = useIntent();

  const filteredIntents = intents.filter(intent => {
    if (activeTab === 'open') return intent.status === 'open';
    if (activeTab === 'closed') return intent.status === 'closed';
    return false;
  });

  return (
    <div className="flex flex-col min-h-screen">
      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">My Intents</h2>
            <div className="flex space-x-3">
              <button className="flex items-center px-4 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md shadow-sm text-sm font-medium text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700/50">
                <Filter className="h-4 w-4 mr-2 text-gray-500 dark:text-gray-400" />
                Filter
              </button>
              <Link 
                href="/create"
                className="flex items-center px-4 py-2 bg-indigo-600 dark:bg-indigo-500 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700 dark:hover:bg-indigo-600"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                New Intent
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 border-b border-gray-200 dark:border-gray-700">
            <div className="flex space-x-8">
              <button
                onClick={() => setActiveTab('open')}
                className={`pb-4 font-medium text-sm ${
                  activeTab === 'open'
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Open Intents
              </button>
              <button
                onClick={() => setActiveTab('closed')}
                className={`pb-4 font-medium text-sm ${
                  activeTab === 'closed'
                    ? 'text-indigo-600 dark:text-indigo-400 border-b-2 border-indigo-600 dark:border-indigo-400'
                    : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300'
                }`}
              >
                Closed
              </button>
            </div>
          </div>

          {/* Intent List */}
          <div className="space-y-4">
            {filteredIntents.map((intent) => (
              <Link 
                key={intent.id}
                href={`/intents/${intent.id}`}
                className="block bg-white dark:bg-gray-800/50 backdrop-blur-sm rounded-lg shadow dark:shadow-gray-900/10 p-6 hover:shadow-md dark:hover:shadow-gray-900/20 transition-all border border-gray-100 dark:border-gray-700/50"
              >
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">{intent.title}</h3>
                    <div className="flex items-center text-sm text-gray-500 dark:text-gray-400">
                      <Clock className="h-4 w-4 mr-1.5" />
                      <span>Total Connections: {intent.totalConnections}</span>
                    </div>
                  </div>
                  <div className="ml-6 flex flex-col items-end">
                    <div className="flex space-x-6 mb-3">
                      <div className="flex flex-col items-center">
                        <div className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">
                          <Users className="h-4 w-4 mr-1" />
                          <span>{intent.pendingConnections}</span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Pending</span>
                      </div>
                      <div className="flex flex-col items-center">
                        <div className="flex items-center text-indigo-600 dark:text-indigo-400 font-medium">
                          <Zap className="h-4 w-4 mr-1" />
                          <span>{intent.confirmedConnections}</span>
                        </div>
                        <span className="text-xs text-gray-500 dark:text-gray-400">Confirmed</span>
                      </div>
                    </div>
                    <div className="flex items-center text-sm text-indigo-600 dark:text-indigo-400 hover:text-indigo-800 dark:hover:text-indigo-300">
                      View Details
                      <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                    </div>
                  </div>
                </div>
                
                {/* Agent activity indicator (only for open intents with pending connections) */}
                {intent.status === 'open' && intent.pendingConnections > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100 dark:border-gray-700/50">
                    <div className="flex items-center">
                      <Bot className="h-4 w-4 text-green-500 dark:text-green-400 mr-2" />
                      <span className="text-sm text-gray-600 dark:text-gray-300">
                        <span className="font-medium">3 broker agents</span> are competing to find you matches
                      </span>
                    </div>
                  </div>
                )}
              </Link>
            ))}

            {filteredIntents.length === 0 && (
              <div className="text-center py-12">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 dark:bg-gray-800 flex items-center justify-center">
                  <Filter className="h-6 w-6 text-gray-400 dark:text-gray-500" />
                </div>
                <h3 className="mt-2 text-sm font-medium text-gray-900 dark:text-white">No intents found</h3>
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                  {activeTab === 'open' 
                    ? "You don't have any open intents yet." 
                    : "You don't have any closed intents."}
                </p>
                {activeTab !== 'closed' && (
                  <div className="mt-6">
                    <Link 
                      href="/create"
                      className="flex items-center px-4 py-2 bg-indigo-600 dark:bg-indigo-500 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700 dark:hover:bg-indigo-600 mx-auto"
                    >
                      <PlusCircle className="h-4 w-4 mr-2" />
                      Create New Intent
                    </Link>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      </main>
    </div>
  );
} 