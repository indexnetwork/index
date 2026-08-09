import { PropsWithChildren, Suspense, useMemo } from 'react';
import { Link } from 'react-router';
import { useLocation } from 'react-router';
import Header from "@/components/Header";
import TopBar from "@/components/TopBar";
import ChatSidebar from "@/components/ChatSidebar";
import AgentSessionsPanel from "@/components/AgentSessionsPanel";
import { NetworkFilterProvider } from "@/contexts/IndexFilterContext";
import { NetworksProvider } from "@/contexts/IndexesContext";
import { ConversationProvider } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuthContext();

  const appRoutes = ['/', '/d', '/i', '/u', '/networks', '/mynetwork', '/chat', '/negotiations', '/settings', '/agents', '/agent', '/questions'];
  const publicRoutes = ['/c'];
  // /l is chrome-free web invite join; /index stays app-only public join.
  const bareRoutes = ['/', '/l', '/index', '/download', '/i/new', '/oauth/callback', '/found-in-translation', '/overview', '/protocol', '/blog', '/about', '/pages', '/waitlist'];

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

  const showAppShell = isAppRoute && !isPublicRoute && !isBareRoute;
  const showHeader = !showAppShell && !isBareRoute;

  const isLandingOrBlog = useMemo(() =>
    (pathname === '/' && !isAuthenticated) ||
    pathname === '/blog' ||
    pathname?.startsWith('/blog/') ||
    pathname?.startsWith('/pages/'),
  [pathname, isAuthenticated]);

  // CLI auth bridge: keep the logo header but no nav/CTA and no bottom border.
  const isCliAuth = pathname?.startsWith('/cli-auth');

  const isMessagesView = useMemo(() =>
    pathname === '/chat' || pathname?.startsWith('/chat/') || (pathname?.includes('/chat') && pathname?.startsWith('/u/')),
  [pathname]);

  // Agent chat routes get the conversation-history aside (relocated from the
  // retired sidebar). Covers the agent landing and specific /d/:sessionId chats.
  const isAgentView = useMemo(() =>
    pathname === '/agent' || pathname?.startsWith('/agent/') || pathname?.startsWith('/d/'),
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

            {showAppShell ? (
              // App layout: top bar over an optional secondary aside + content
              <div className="flex flex-col h-screen overflow-hidden">
                <TopBar />
                <div className="flex flex-1 min-h-0 overflow-hidden">
                  {/* Secondary aside: DM list on messages, conversation history on agent */}
                  {isMessagesView && (
                    <aside className="hidden lg:block w-80 bg-white border-r border-gray-200 flex-shrink-0">
                      <ChatSidebar />
                    </aside>
                  )}
                  {isAgentView && !isMessagesView && (
                    <aside className="hidden lg:block w-72 bg-white border-r border-gray-200 flex-shrink-0">
                      <AgentSessionsPanel />
                    </aside>
                  )}

                  {/* Main content area - takes remaining width, scrollable */}
                  <div className="flex-1 flex flex-col min-w-0 overflow-hidden relative">
                    <main className="flex-1 overflow-y-auto flex flex-col">
                      {children}
                    </main>
                  </div>
                </div>
              </div>
            ) : (
              // Public layout without sidebar
              <>
                {showHeader && (
                  <div className={isLandingOrBlog ? 'z-40' : `sticky top-0 z-40 bg-white/95 backdrop-blur-md${isCliAuth ? '' : ' border-b border-gray-300'}`}>
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
                          showHeaderButtons={!isCliAuth}
                          keepButtonSpace={isCliAuth}
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
