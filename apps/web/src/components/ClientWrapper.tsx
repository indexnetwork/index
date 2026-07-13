import { PropsWithChildren, Suspense, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router';
import { useLocation } from 'react-router';
import { PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatSidebar from "@/components/ChatSidebar";
import { NetworkFilterProvider } from "@/contexts/IndexFilterContext";
import { NetworksProvider } from "@/contexts/IndexesContext";
import { ConversationProvider } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isAuthenticated } = useAuthContext();

  // Intent detail pages open with the sidebar collapsed to give the two-column
  // workspace the full width; the floating toggle brings it back. Leaving the
  // intent page restores the expanded sidebar.
  const isIntentDetail = useMemo(() => pathname?.startsWith('/i/') ?? false, [pathname]);
  const [desktopSidebarCollapsed, setDesktopSidebarCollapsed] = useState(isIntentDetail);

  useEffect(() => {
    setMobileSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    setDesktopSidebarCollapsed(isIntentDetail);
  }, [isIntentDetail]);

  const appRoutes = ['/', '/d', '/i', '/u', '/networks', '/mynetwork', '/chat', '/settings', '/agents', '/agent', '/questions'];
  const publicRoutes = ['/c', '/l', '/index'];
  const bareRoutes = ['/', '/onboarding', '/oauth/callback', '/found-in-translation', '/overview', '/blog', '/about', '/pages'];

  const isBareRoute = useMemo(() => {
    // Root is bare (landing) only for guests; authenticated users get the app shell.
    if (pathname === '/') return !isAuthenticated;
    return bareRoutes.some(route =>
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname, isAuthenticated]);

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

  const showSidebar = isAppRoute && !isPublicRoute && !isBareRoute;
  const showHeader = !showSidebar && !isBareRoute;

  const isLandingOrBlog = useMemo(() =>
    (pathname === '/' && !isAuthenticated) ||
    pathname === '/blog' ||
    pathname?.startsWith('/blog/') ||
    pathname?.startsWith('/pages/'),
  [pathname, isAuthenticated]);

  const isMessagesView = useMemo(() =>
    pathname === '/chat' || pathname?.startsWith('/chat/') || (pathname?.includes('/chat') && pathname?.startsWith('/u/')),
  [pathname]);

  if (isBareRoute) {
    return <NetworksProvider>{children}</NetworksProvider>;
  }

  return (
    <NetworksProvider>
      <ConversationProvider>
      <NetworkFilterProvider>
          <div className="backdrop relative min-h-screen bg-[#FDFDFD]">
            {/* Plain style tag: styled-jsx is a Next.js feature and no longer
                transforms after the react-router/Vite migration — `<style jsx>`
                leaked `jsx={true}` onto the DOM element (React non-boolean
                attribute error). The selector is already class-scoped. */}
            <style>{`
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
                    fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-200
                    transform transition-[transform,width] duration-200 ease-in-out
                    lg:relative lg:z-auto lg:translate-x-0
                    ${mobileSidebarOpen ? 'translate-x-0' : '-translate-x-full'}
                    ${desktopSidebarCollapsed ? 'lg:w-0 lg:overflow-hidden lg:border-r-0' : 'lg:w-64'}
                  `}
                >
                  {/* Fixed-width inner wrapper so content doesn't reflow while the width animates. */}
                  <div className="h-full w-64">
                    <Sidebar />
                  </div>
                </aside>

                {/* Secondary sidebar for chat - only on messages view */}
                {isMessagesView && (
                  <aside
                    className="hidden lg:block w-80 bg-white border-r border-gray-200 flex-shrink-0"
                  >
                    <ChatSidebar />
                  </aside>
                )}

                {/* Mobile overlay */}
                {mobileSidebarOpen && (
                  <div 
                    className="fixed inset-0 bg-black/20 z-40 lg:hidden"
                    onClick={() => setMobileSidebarOpen(false)}
                  />
                )}

                {/* Main content area - takes remaining width, scrollable */}
                <div className="flex-1 flex flex-col min-w-0 h-screen overflow-hidden relative">
                  {/* Mobile hamburger - opens the sidebar on all app routes */}
                  <button
                    onClick={() => setMobileSidebarOpen(true)}
                    className="lg:hidden absolute top-3 left-3 z-30 p-2 rounded-md bg-white/80 backdrop-blur-sm shadow-sm hover:bg-gray-100 text-gray-700"
                  >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M3 6h18M3 12h18M3 18h18" />
                    </svg>
                  </button>

                  {/* Desktop sidebar toggle - only where the sidebar auto-collapses (intent pages) */}
                  {isIntentDetail && (
                    <button
                      type="button"
                      onClick={() => setDesktopSidebarCollapsed((v) => !v)}
                      title={desktopSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                      aria-label={desktopSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                      className="hidden lg:inline-flex absolute top-4 left-2 z-30 p-1 rounded-md text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                    >
                      {desktopSidebarCollapsed ? (
                        <PanelLeftOpen className="h-5 w-5" />
                      ) : (
                        <PanelLeftClose className="h-5 w-5" />
                      )}
                    </button>
                  )}
                  
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
                  <div className={isLandingOrBlog ? 'z-40' : 'sticky top-0 z-40 border-b border-gray-300 bg-white/95 backdrop-blur-md'}>
                    <div className="max-w-7xl mx-auto px-4">
                      <Suspense
                        fallback={
                          <header className="w-full py-4 px-4 flex justify-between items-center">
                            <Link to="/">
                              <img
                                src="/logos/logo-black-full.svg"
                                alt="Index Network"
                                width={200}
                                height={36}
                                className="object-contain"
                              />
                            </Link>
                            <div className="animate-pulse bg-gray-200 h-10 w-20 rounded" />
                          </header>
                        }
                      >
                        <Header 
                          showHeaderButtons={!pathname?.startsWith('/l/') && !pathname?.startsWith('/index/')}
                          forcePublicView={isLandingOrBlog}
                        />
                      </Suspense>
                    </div>
                  </div>
                )}
                <main className="flex flex-col min-h-[calc(100vh-76px)]">
                  {children}
                </main>
              </>
            )}
          </div>
      </NetworkFilterProvider>
      </ConversationProvider>
    </NetworksProvider>
  );
}
