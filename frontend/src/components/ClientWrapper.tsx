'use client';

import { PropsWithChildren, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import { IndexFilterProvider } from "@/contexts/IndexFilterContext";
import { IndexesProvider } from "@/contexts/IndexesContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Define known routes to detect 404 pages
  const knownRoutes = useMemo(() => ['/', '/inbox', '/integrate', '/simulation', '/connections', '/onboarding'], []);
  const isKnownRoute = knownRoutes.some(route => 
    pathname === route || 
    pathname?.startsWith(route + '/')
  );
  // Show sidebar only on app pages (exclude landing '/' and onboarding)
  const showSidebar = useMemo(() => 
    pathname !== '/' && pathname !== '/onboarding' && knownRoutes.filter(route => route !== '/' && route !== '/onboarding').some(route => 
      pathname === route || pathname?.startsWith(route + '/')
    ), [pathname, knownRoutes]);
  
  // Don't render header on 404 pages (unknown routes)
  if (!isKnownRoute && pathname) {
    return (
      <main>
        {children}
      </main>
    );
  }
  
  return (
    <IndexesProvider>
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
          <Header 
            showNavigation={false}
            onToggleSidebar={showSidebar ? () => setMobileSidebarOpen((v) => !v) : undefined}
            isSidebarOpen={showSidebar ? mobileSidebarOpen : undefined}
          />
        </div>
        
        {/* Page content with sidebar */}
        <main>
          <div className={`max-w-7xl mx-auto px-2 mt-10 flex ${showSidebar ? 'flex-col lg:flex-row' : 'flex-col'}`}>
            {/* Sidebar */}
            {showSidebar && (
              <aside id="app-sidebar" className={`w-full lg:w-1/4 lg:pr-6 lg:top-6 mb-8 lg:mb-0 ${mobileSidebarOpen ? 'block' : 'hidden'} lg:block`}>
                <Sidebar />
              </aside>
            )}
            
            {/* Main content area */}
            <div className={`w-full ${showSidebar ? 'lg:w-3/4' : ''}`}>
              <div className="space-y-6 h-full">
                {children}
              </div>
            </div>
          </div>
        </main>
        </div>
      </IndexFilterProvider>
    </IndexesProvider>
  );
} 
