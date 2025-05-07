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
          <div>
            {children}
          </div>
          
        </div>
      </main>
    </div>
  );
} 