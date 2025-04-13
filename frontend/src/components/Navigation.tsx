'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Database, FileText, Target } from 'lucide-react';

export default function Navigation() {
  const pathname = usePathname();

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="fixed top-0 left-0 w-72 h-screen bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      <div className="p-6 h-full overflow-y-auto">
        <div className="space-y-8">
          <div className="space-y-2">
            <h1 className="text-2xl font-bold text-gray-900 dark:text-white">Index Protocol</h1>
            <p className="text-sm text-gray-500 dark:text-gray-400">A protocol for discovery</p>
          </div>
          
          <div className="space-y-1">
            <Link 
              href="/intents" 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive('/intents') 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium' 
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Target className="w-5 h-5" />
              <span>Intents</span>
            </Link>
            <Link 
              href="/data" 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive('/data') 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium' 
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Database className="w-5 h-5" />
              <span>Data</span>
            </Link>
          </div>
        </div>
      </div>
      
      {/* Wallet Info Section */}
      <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-200 dark:border-gray-800">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Wallet Balance</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">1,250 $IDX</span>
          </div>
          <div className="flex items-center gap-2 text-sm text-gray-500 dark:text-gray-400 truncate">
            <span className="w-2 h-2 rounded-full bg-green-500"></span>
            <span className="truncate">0x7f...3a4b</span>
          </div>
          <div className="flex items-center gap-2 pt-2">
            <Link
              href="/settings"
              className="flex-1 px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 rounded-lg transition-all"
            >
              Profile Settings
            </Link>
            <button
              onClick={() => {/* TODO: Implement disconnect */}}
              className="px-3 py-2 text-sm text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-all"
            >
              Disconnect
            </button>
          </div>
        </div>
      </div>
    </nav>
  );
} 