'use client';

import { PropsWithChildren } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  
  // Determine if navigation should be shown based on current path
  const showNavigation = pathname !== '/' && !pathname.startsWith('/vibecheck') && !pathname.startsWith('/matchlist');
  
  return (
    <div className="backdrop relative min-h-screen">
      <style jsx>{`
        .backdrop:after {
          content: "";
          position: fixed;
          left: 0;
          top: 0;
          bottom: 0;
          right: 0;
          background: url(/noise.jpg);
          opacity: .12;
          pointer-events: none;
          z-index: -1;
        }
      `}</style>
      
      {/* Header stays persistent across page changes */}
      <div className="max-w-7xl mx-auto px-2">
        <Header showNavigation={showNavigation} />
      </div>
      
      {/* Page content */}
      <main>
        <div className={`flex-1 px-2 ${showNavigation ? 'max-w-4xl' : 'max-w-6xl'} mx-auto`}>
          <div className="space-y-6 h-full">
            {children}
          </div>
        </div>
      </main>
    </div>
  );
} 