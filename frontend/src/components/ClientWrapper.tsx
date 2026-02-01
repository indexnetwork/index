'use client';

import { PropsWithChildren, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import { IndexFilterProvider } from "@/contexts/IndexFilterContext";
import { IndexesProvider } from "@/contexts/IndexesContext";
import { StreamChatProvider } from "@/contexts/StreamChatContext";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isAuthenticated } = useAuthContext();

  const appRoutes = ['/', '/i', '/u', '/admin'];
  const publicRoutes = ['/onboarding', '/l', '/index', '/blog'];

  const isAppRoute = useMemo(() => {
    if (!isAuthenticated) return false;
    return appRoutes.some(route => 
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname, isAuthenticated]);

  const isPublicRoute = useMemo(() => {
    return publicRoutes.some(route => 
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname]);

  const showSidebar = isAppRoute && !isPublicRoute;
  const showHeader = !showSidebar;

  const isLandingOrBlog = useMemo(() => 
    (pathname === '/' && !isAuthenticated) || 
    pathname === '/blog' || 
    pathname?.startsWith('/blog/'),
  [pathname, isAuthenticated]);

  return (
    <IndexesProvider>
      <IndexFilterProvider>
        <StreamChatProvider>
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

            {showSidebar ? (
              // App layout with sidebar - full height flex
              <div className="flex h-screen overflow-hidden">
                {/* Sidebar - fixed width, full height, no scroll */}
                <aside 
                  id="app-sidebar"
                  className={`
                    fixed inset-y-0 left-0 z-50 w-64 bg-background border-r border-border
                    transform transition-transform duration-200 ease-in-out
                    lg:translate-x-0 lg:relative lg:z-auto
                    ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                  `}
                >
                  <Sidebar />
                </aside>

                {/* Mobile overlay */}
                {mobileSidebarOpen && (
                  <div 
                    className="fixed inset-0 bg-black/20 z-40 lg:hidden"
                    onClick={() => setMobileSidebarOpen(false)}
                  />
                )}

                {/* Main content area - takes remaining width, scrollable */}
                <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden">
                  {/* Mobile header */}
                  <div className="lg:hidden flex-shrink-0 bg-background border-b border-border px-4 py-3">
                    <button
                      onClick={() => setMobileSidebarOpen(true)}
                      className="p-2 -ml-2 rounded-md hover:bg-muted text-foreground"
                    >
                      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6h18M3 12h18M3 18h18" />
                      </svg>
                    </button>
                  </div>
                  
                  {/* Scrollable content area */}
                  <main className="flex-1 overflow-y-auto flex flex-col">
                    {children}
                  </main>
                </div>
              </div>
            ) : (
              // Public layout without sidebar
              <>
                {showHeader && (
                  <div className={isLandingOrBlog ? 'z-40' : 'sticky top-0 z-40 border-b border-border bg-background/95 backdrop-blur-md'}>
                    <div className="max-w-7xl mx-auto px-4">
                      <Header 
                        showHeaderButtons={!pathname?.startsWith('/l/') && !pathname?.startsWith('/index/')}
                        forcePublicView={isLandingOrBlog}
                      />
                    </div>
                  </div>
                )}
                <main className="flex flex-col min-h-[calc(100vh-76px)]">
                  {children}
                </main>
              </>
            )}
          </div>
        </StreamChatProvider>
      </IndexFilterProvider>
    </IndexesProvider>
  );
}
