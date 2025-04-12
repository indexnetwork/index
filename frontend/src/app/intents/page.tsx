'use client';

import { useState } from 'react';
import { PlusCircle, Filter, Clock, ArrowUpRight, Zap, Award, Lock, Users, Settings, BellDot, Bot } from 'lucide-react';
import Link from 'next/link';

type Intent = {
  id: number;
  title: string;
  status: 'active' | 'draft' | 'completed';
  matches: number;
  stakes: number;
  createdAt: string;
};

// Mock data for intents
const mockIntents: Intent[] = [
  {
    id: 1,
    title: "Looking for a founding engineer focused on privacy-preserving AI",
    status: "active",
    matches: 3,
    stakes: 750,
    createdAt: "2 days ago"
  },
  {
    id: 2,
    title: "Exploring investors aligned with decentralized identity and confidential compute",
    status: "active",
    matches: 5,
    stakes: 1250,
    createdAt: "1 week ago"
  },
  {
    id: 3,
    title: "Need collaborator for zero-knowledge proof implementation",
    status: "active",
    matches: 2,
    stakes: 425,
    createdAt: "3 days ago"
  },
  {
    id: 4,
    title: "Looking for senior Rust developer with experience in privacy solutions",
    status: "active",
    matches: 1,
    stakes: 550,
    createdAt: "5 days ago"
  },
  {
    id: 5,
    title: "Seeking market insights for decentralized identity products",
    status: "completed",
    matches: 7,
    stakes: 0,
    createdAt: "2 weeks ago"
  },
  {
    id: 6,
    title: "Need technical advisor with experience in scaling web3 applications",
    status: "draft",
    matches: 0,
    stakes: 0,
    createdAt: "1 day ago"
  }
];

export default function IntentsPage() {
  const [activeTab, setActiveTab] = useState<'active' | 'draft' | 'completed'>('active');
  const [intents, setIntents] = useState<Intent[]>(mockIntents);

  const filteredIntents = intents.filter(intent => intent.status === activeTab);

  return (
    <div className="flex flex-col min-h-screen">

      <main className="flex-1 px-6 py-8">
        <div className="max-w-6xl mx-auto">
          {/* Page Title and Actions */}
          <div className="flex justify-between items-center mb-8">
            <h2 className="text-2xl font-bold text-gray-900">My Intents</h2>
            <div className="flex space-x-3">
              <button className="flex items-center px-4 py-2 bg-white border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 hover:bg-gray-50">
                <Filter className="h-4 w-4 mr-2 text-gray-500" />
                Filter
              </button>
              <Link 
                href="/create"
                className="flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700"
              >
                <PlusCircle className="h-4 w-4 mr-2" />
                New Intent
              </Link>
            </div>
          </div>

          {/* Tabs */}
          <div className="mb-6 border-b border-gray-200">
            <div className="flex space-x-8">
              <button
                onClick={() => setActiveTab('active')}
                className={`pb-4 font-medium text-sm ${
                  activeTab === 'active'
                    ? 'text-indigo-600 border-b-2 border-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Active Intents
              </button>
              <button
                onClick={() => setActiveTab('draft')}
                className={`pb-4 font-medium text-sm ${
                  activeTab === 'draft'
                    ? 'text-indigo-600 border-b-2 border-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Drafts
              </button>
              <button
                onClick={() => setActiveTab('completed')}
                className={`pb-4 font-medium text-sm ${
                  activeTab === 'completed'
                    ? 'text-indigo-600 border-b-2 border-indigo-600'
                    : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Completed
              </button>
            </div>
          </div>

          {/* Intent List */}
          <div className="space-y-4">
            {filteredIntents.map((intent) => (
              <div key={intent.id} className="bg-white rounded-lg shadow p-6 hover:shadow-md transition-shadow">
                <div className="flex justify-between items-start">
                  <div className="flex-1">
                    <h3 className="text-lg font-medium text-gray-900 mb-2">{intent.title}</h3>
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
                          <span>{intent.matches}</span>
                        </div>
                        <span className="text-xs text-gray-500">Matches</span>
                      </div>
                      {intent.stakes > 0 && (
                        <div className="flex flex-col items-center">
                          <div className="flex items-center text-indigo-600 font-medium">
                            <Zap className="h-4 w-4 mr-1" />
                            <span>{intent.stakes}</span>
                          </div>
                          <span className="text-xs text-gray-500">Staked</span>
                        </div>
                      )}
                    </div>
                    <Link 
                      href={`/intents/${intent.id}`}
                      className="flex items-center text-sm text-indigo-600 hover:text-indigo-800"
                    >
                      View Details
                      <ArrowUpRight className="h-3.5 w-3.5 ml-1" />
                    </Link>
                  </div>
                </div>
                
                {/* Agent activity indicator (only for active intents with matches) */}
                {intent.status === 'active' && intent.matches > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-100">
                    <div className="flex items-center">

                      <Bot className="h-4 w-4 text-green-500 mr-2" />
                      <span className="text-sm text-gray-600">
                        <span className="font-medium">3 broker agents</span> are competing to find you matches
                      </span>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {filteredIntents.length === 0 && (
              <div className="text-center py-12">
                <div className="mx-auto h-12 w-12 rounded-full bg-gray-100 flex items-center justify-center">
                  <Filter className="h-6 w-6 text-gray-400" />
                </div>
                <h3 className="mt-2 text-sm font-medium text-gray-900">No intents found</h3>
                <p className="mt-1 text-sm text-gray-500">
                  {activeTab === 'active' 
                    ? "You don't have any active intents yet." 
                    : activeTab === 'draft' 
                    ? "You don't have any draft intents." 
                    : "You don't have any completed intents."}
                </p>
                {activeTab !== 'completed' && (
                  <div className="mt-6">
                    <Link 
                      href="/create"
                      className="flex items-center px-4 py-2 bg-indigo-600 border border-transparent rounded-md shadow-sm text-sm font-medium text-white hover:bg-indigo-700 mx-auto"
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