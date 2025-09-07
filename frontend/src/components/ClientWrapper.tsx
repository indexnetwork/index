'use client';

import { PropsWithChildren } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import { IndexFilterProvider } from "@/contexts/IndexFilterContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  
  // Determine if navigation should be shown based on current path
  const showNavigation = pathname !== '/' && !pathname.startsWith('/vibecheck') && !pathname.startsWith('/matchlist');
  
  // Define known routes to detect 404 pages
  const knownRoutes = ['/', '/inbox', '/indexes', '/intents', '/integrate', '/stake', '/simulation', '/vibecheck', '/matchlist', '/connections'];
  const isKnownRoute = knownRoutes.some(route => 
    pathname === route || 
    pathname?.startsWith(route + '/')
  );
  
  // Don't render header on 404 pages (unknown routes)
  if (!isKnownRoute && pathname) {
    return (
      <main>
        {children}
      </main>
    );
  }
  
  return (
    <IndexFilterProvider>
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
          <Header showNavigation={false} />
        </div>
        
        {/* Page content with sidebar */}
        <main>
          <div className="max-w-7xl mx-auto px-2 mt-10 flex">
            {/* Sidebar */}
            <aside className="w-1/4 pr-6 top-6">
              <Sidebar />
            </aside>
            
            {/* Main content area */}
            <div className="w-3/4">
              <div className="space-y-6 h-full">
                {children}
              </div>
            </div>
          </div>
        </main>
      </div>
    </IndexFilterProvider>
  );
} 