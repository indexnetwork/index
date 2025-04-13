'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { FileText, Target } from 'lucide-react';

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
              href="/files" 
              className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                isActive('/files') 
                  ? 'bg-blue-50 dark:bg-blue-900/50 text-blue-700 dark:text-blue-400 font-medium' 
                  : 'text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800'
              }`}
            >
              <FileText className="w-5 h-5" />
              <span>Files</span>
            </Link>
          </div>
        </div>
      </div>
    </nav>
  );
} 