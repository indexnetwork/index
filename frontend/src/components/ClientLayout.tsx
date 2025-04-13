'use client';

import { usePathname } from 'next/navigation';
import Navigation from './Navigation';
import { ThemeToggle } from './ThemeToggle';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';

  return (
    <div className="min-h-screen">
      <div className="fixed top-4 right-4 z-50">
        <ThemeToggle />
      </div>
      {!isLandingPage && <Navigation />}
      <main className={!isLandingPage ? "pl-72" : ""}>
        <div className={!isLandingPage ? "max-w-7xl mx-auto p-8" : ""}>
          {children}
        </div>
      </main>
    </div>
  );
} 