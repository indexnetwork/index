'use client';

import { usePathname } from 'next/navigation';

import { ThemeToggle } from './ThemeToggle';
import { useAuth } from '@/hooks/useAuth';
import { PropsWithChildren } from 'react';

export default function ClientLayout({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';
  const { isLoading, isReady, isAuthenticated } = useAuth();

  // Show loading state while auth is being determined
  if (isLoading || !isReady) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-amber-500 mx-auto"></div>
          <p className="mt-4 text-gray-600 dark:text-gray-300">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen">
      <main className={!isLandingPage ? "px-40" : ""}>
        <div className={!isLandingPage ? "max-w-7xl mx-auto p-2" : ""}>
          {children}
        </div>
      </main>
    </div>
  );
} 