'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { Database, FileText, Target } from 'lucide-react';

export default function Navigation() {
  const pathname = usePathname();
  const router = useRouter();

  const handleDisconnect = () => {
    // TODO: Add any wallet disconnect logic here
    router.push('/');
  };

  const isActive = (path: string) => pathname === path;

  return (
    <nav className="fixed top-0 left-0 w-72 h-screen bg-white dark:bg-gray-900 border-r border-gray-200 dark:border-gray-800">
      <div className="p-6 h-full overflow-y-auto">
        <div className="space-y-8">
          <div className="space-y-2">
            <img 
              src="/logo.svg" 
              alt="Index Network Logo" 
              className="h-8 w-auto"
            />
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
              href="/memory" 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive('/memory') 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium' 
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <Database className="w-5 h-5" />
              <span>Memory</span>
            </Link>
          </div>
        </div>
      </div>
      
      {/* Background Image */}
      <div className="fixed bottom-40 left-2 w-50 pointer-events-none transition-all hover:-translate-y-100">
        <img 
          src="/permissionless.png" 
          alt="Permissionless background" 
          className="w-full"
        />
      </div>
      {/* Wallet Info Section */}
      <div className="absolute bottom-0 left-0 right-0 p-6 border-t border-gray-200 dark:border-gray-800 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm z-10">
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500 dark:text-gray-400">Wallet Balance</span>
            <span className="text-sm font-medium text-gray-900 dark:text-white">$ 1,250 </span>
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
              onClick={handleDisconnect}
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