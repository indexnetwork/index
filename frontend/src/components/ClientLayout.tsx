'use client';

import { usePathname } from 'next/navigation';
import Navigation from './Navigation';
import { ThemeToggle } from './ThemeToggle';

export default function ClientLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const isLandingPage = pathname === '/';

  return (
    <div className="min-h-screen">

      {false && !isLandingPage && <Navigation />}
      <main className={!isLandingPage ? "px-40" : ""}>
        <div className={!isLandingPage ? "max-w-7xl mx-auto p-2" : ""}>
          {children}
        </div>
      </main>
    </div>
  );
} 