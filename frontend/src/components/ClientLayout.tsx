'use client';

import { usePathname } from 'next/navigation';

import { PropsWithChildren } from 'react';
import { useAuthContext } from '@/contexts/AuthContext';
export default function ClientLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const { isLoading, isReady } = useAuthContext();

  return (
    <div className="min-h-screen">
      <main className={!isLandingPage ? "px-40" : ""}>
        <div className={!isLandingPage ? "max-w-7xl mx-auto p-2" : ""}>
          <div className={`transition-opacity duration-300 ${(isLoading || !isReady) ? 'opacity-0' : 'opacity-100'}`}>
            {children}
          </div>
          {(isLoading || !isReady) && (
            <div className="absolute inset-0 flex items-center justify-center bg-white dark:bg-gray-900 transition-opacity duration-300">
              <div className="text-center">
                <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto"></div>
                <p className="mt-4 text-gray-600 dark:text-gray-300">Loading...</p>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
} 