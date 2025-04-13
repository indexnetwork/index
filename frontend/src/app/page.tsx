'use client';

import { useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { ArrowRight, BarChart3, BookOpen, Wallet, Users, Target, TrendingUp, Activity } from 'lucide-react';
import { allAgents } from '@/config/agents';

interface Agent {
  name: string;
  avatar: string;
  role: string;
}

export default function Home() {
  const [isConnected, setIsConnected] = useState(false);
  const router = useRouter();

  const handleConnect = () => {
    // Mock connection - just toggle the state
    setIsConnected(true);
    // Redirect to intents page
    router.push('/intents');
  };

  return (
    <div className="min-h-screen bg-gradient-to-b from-white to-gray-50 dark:from-gray-900 dark:to-gray-800">
      {/* Navbar */}
      <nav className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800 fixed w-full top-0 z-50">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between h-16">
            <div className="flex items-center">
              <Link href="/" className="flex items-center">
                <Image
                  src="/logo.svg"
                  alt="Index Logo"
                  width={120}
                  height={32}
                  className="h-8 w-auto"
                />
              </Link>
            </div>
            <div className="flex items-center space-x-4">
              <Link href="/analytics" className="flex items-center space-x-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
                <BarChart3 className="h-5 w-5" />
                <span>Analytics</span>
              </Link>
              <Link href="/docs" className="flex items-center space-x-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white">
                <BookOpen className="h-5 w-5" />
                <span>Docs</span>
              </Link>
              {!isConnected ? (
                <button
                  onClick={handleConnect}
                  className="flex items-center space-x-2 text-gray-600 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white"
                >
                  <Wallet className="h-5 w-5" />
                  <span>Connect Wallet</span>
                </button>
              ) : (
                <div className="flex items-center space-x-2">
                  <Wallet className="h-5 w-5 text-green-500" />
                  <span className="text-sm text-gray-600 dark:text-gray-300">
                    0x1234...5678
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </nav>

      {/* Hero Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-24 mt-16">
        <div className="text-center">
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 dark:text-white sm:text-6xl">
            Discovery Protocol
          </h1>
          <p className="mt-6 text-lg leading-8 text-gray-600 dark:text-gray-300 max-w-2xl mx-auto">
            Index is a private, intent-driven discovery protocol where autonomous agents compete to connect you with the right people at the right time.
          </p>
        </div>
      </div>

      {/* Stats Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-8 pt-16">
      <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Index Stats</h2>
            <p className="text-gray-600 dark:text-gray-300">Discover the latest stats and metrics about Index Network</p>
          </div>
        </div>        
        <div className="grid grid-cols-1 gap-8 sm:grid-cols-2 lg:grid-cols-4">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+15% this month</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">12,468,161</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Active Intents</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Users className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+5% this week</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">3847</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Live Agents</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+7.2% this month</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">82.8%</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Average Match Rate</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+Ξ 12.4 this week</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">Ξ 128,861 M</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Protocol TVL</p>
          </div>
        </div>
      </div>

      {/* Emerging Intent Pools Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex justify-between items-center mb-8">
          <div>
            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">Emerging Intent Pools</h2>
            <p className="text-gray-600 dark:text-gray-300">Clusters of unmatched intents that represent new opportunities for context brokers</p>
          </div>
        </div>

        {/* Stats Overview */}
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4 mb-8">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Activity className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+12.3% from last week</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">15,854</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Total Unmatched Intents</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Target className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+4 new pools</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">128</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Active Intent Pools</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <TrendingUp className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+5.2% from last week</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">67%</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Average Match Potential</p>
          </div>
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm hover:shadow-md transition-shadow">
            <div className="flex items-center justify-between mb-2">
              <Wallet className="h-5 w-5 text-blue-600 dark:text-blue-400" />
              <span className="text-sm text-green-600 dark:text-green-400">+Ξ 8.2 this week</span>
            </div>
            <h3 className="text-3xl font-bold text-gray-900 dark:text-white">Ξ 48.516</h3>
            <p className="mt-2 text-sm text-gray-600 dark:text-gray-300">Total Pool Rewards</p>
          </div>
        </div>

        {/* Search and Filters */}
        <div className="mb-8">
          <div className="flex flex-col sm:flex-row gap-4">
            <input
              type="text"
              placeholder="Search pools..."
              className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-700 rounded-md bg-white dark:bg-gray-800 text-gray-900 dark:text-white"
            />
            <div className="flex flex-wrap gap-2">
              <button className="px-3 py-1 text-sm font-medium text-white bg-blue-600 rounded-md">All Pools</button>
              <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">New (7)</button>
              <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">Trending (5)</button>
              <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">High Value (12)</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-4">
            <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">Research</button>
            <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">Investment</button>
            <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">Collaboration</button>
            <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">Hiring</button>
            <button className="px-3 py-1 text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-700 rounded-md">+More</button>
          </div>
        </div>

        {/* Pool Cards */}
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          {/* AI Governance Research Pool */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="inline-block px-2 py-1 text-xs font-medium text-blue-600 dark:text-blue-400 bg-blue-100 dark:bg-blue-900 rounded-md">New</span>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mt-2">AI Governance Research</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">42 intents • 3 days old</p>
              </div>
              <div className="text-right">
                <span className="inline-block px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 rounded-md">High Opportunity</span>
                <p className="text-sm font-medium text-gray-900 dark:text-white mt-2">Reward: Ξ 3.5</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Looking for AI governance researchers focused on multinational coordination</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">85% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">7 similar intents</span>
                </div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Seeking collaborators on participatory AI governance frameworks</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">78% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">5 similar intents</span>
                </div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Interested in connecting with AI safety researchers studying governance mechanisms</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">72% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">12 similar intents</span>
                </div>
              </div>
            </div>
          </div>

          {/* ZK Privacy Developer Network Pool */}
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg shadow-sm">
            <div className="flex justify-between items-start mb-4">
              <div>
                <span className="inline-block px-2 py-1 text-xs font-medium text-orange-600 dark:text-orange-400 bg-orange-100 dark:bg-orange-900 rounded-md">Trending</span>
                <h3 className="text-xl font-semibold text-gray-900 dark:text-white mt-2">ZK Privacy Developer Network</h3>
                <p className="text-sm text-gray-600 dark:text-gray-300">86 intents • 5 days old</p>
              </div>
              <div className="text-right">
                <span className="inline-block px-2 py-1 text-xs font-medium text-green-600 dark:text-green-400 bg-green-100 dark:bg-green-900 rounded-md">High Opportunity</span>
                <p className="text-sm font-medium text-gray-900 dark:text-white mt-2">Reward: Ξ 5.2</p>
              </div>
            </div>
            <div className="space-y-4">
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Looking for ZK developers to collaborate on privacy-preserving identity systems</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">92% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">14 similar intents</span>
                </div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Seeking experienced ZK engineers for a new privacy layer</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">88% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">9 similar intents</span>
                </div>
              </div>
              <div className="p-4 bg-gray-50 dark:bg-gray-700 rounded-md">
                <p className="text-sm text-gray-900 dark:text-white">Interested in connecting with privacy-focused cryptographers</p>
                <div className="flex justify-between items-center mt-2">
                  <span className="text-sm text-gray-600 dark:text-gray-300">84% match potential</span>
                  <span className="text-sm text-gray-600 dark:text-gray-300">11 similar intents</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Agents Section */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <h2 className="text-2xl font-bold text-gray-900 dark:text-white mb-4">Agents</h2>
        <p className="text-gray-600 dark:text-gray-300 mb-8">Discover our network of specialized agents</p>
        
        <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {allAgents.map((agent: Agent, index: number) => (
            <div 
              key={index} 
              className="flex items-start space-x-4 bg-gray-900 p-6 rounded-lg"
            >
              <div className="flex-shrink-0">
                <Image
                  src={agent.avatar}
                  alt={agent.name}
                  width={40}
                  height={40}
                  className="rounded-lg"
                />
              </div>
              <div>
                <h3 className="text-lg font-medium text-white">
                  {agent.name}
                </h3>
                <p className="mt-1 text-sm text-gray-400">
                  {agent.role}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer */}
      <footer className="bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
          <p className="text-center text-sm text-gray-500 dark:text-gray-400">
            © 2024 Index Network. All rights reserved.
          </p>
        </div>
      </footer>
    </div>
  );
}
