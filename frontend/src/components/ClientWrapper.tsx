'use client';

import { PropsWithChildren, useMemo, useState } from 'react';
import { usePathname } from 'next/navigation';
import Header from "@/components/Header";
import Sidebar from "@/components/Sidebar";
import ChatSidebar from "@/components/chat/ChatSidebar";
import ChatView from "@/components/chat/ChatView";
import { IndexFilterProvider } from "@/contexts/IndexFilterContext";
import { IndexesProvider } from "@/contexts/IndexesContext";
import { StreamChatProvider, useStreamChat } from "@/contexts/StreamChatContext";
import { useAuthContext } from "@/contexts/AuthContext";

export default function ClientWrapper({ children }: PropsWithChildren) {
  const pathname = usePathname();
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);
  const { isAuthenticated } = useAuthContext();

  // Define known routes to detect 404 pages
  const knownRoutes = useMemo(() => ['/', '/simulation', '/onboarding', '/l', '/i', '/u', '/index', '/admin'], []);
  const isKnownRoute = knownRoutes.some(route =>
    pathname === route ||
    pathname?.startsWith(route + '/')
  );
  // Show sidebar only on app pages (exclude landing '/' for unauthenticated, onboarding, invitation, and index join pages)
  // For authenticated users, '/' is the inbox so show sidebar there too
  const showSidebar = useMemo(() => {
    // Always hide on onboarding and invitation/index join pages
    if (pathname === '/onboarding' || pathname?.startsWith('/l/') || pathname?.startsWith('/index/')) {
      return false;
    }
    // Show on root if authenticated (inbox), otherwise hide (landing page)
    if (pathname === '/') {
      return isAuthenticated;
    }
    // Show on other app routes
    return knownRoutes.filter(route => route !== '/' && route !== '/onboarding' && route !== '/l' && route !== '/index').some(route =>
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname, knownRoutes, isAuthenticated]);

  // Hide header buttons on special pages (onboarding and invitation)
  const showHeaderButtons = useMemo(() =>
    pathname !== '/onboarding' && !pathname?.startsWith('/l/') && !pathname?.startsWith('/index/'), [pathname]);

  // Don't render header on 404 pages (unknown routes)
  if (!isKnownRoute && pathname) {
    return (
      <main>
        {children}
      </main>
    );
  }

  // Show right chat sidebar when authenticated and sidebar is visible
  const showChatSidebar = isAuthenticated && showSidebar;

  return (
    <IndexesProvider>
      <IndexFilterProvider>
        <StreamChatProvider>
          <ClientWrapperContent
            showSidebar={showSidebar}
            showChatSidebar={showChatSidebar}
            showHeaderButtons={showHeaderButtons}
            mobileSidebarOpen={mobileSidebarOpen}
            setMobileSidebarOpen={setMobileSidebarOpen}
          >
            {children}
          </ClientWrapperContent>
        </StreamChatProvider>
      </IndexFilterProvider>
    </IndexesProvider>
  );
}

function ClientWrapperContent({
  children,
  showSidebar,
  showChatSidebar,
  showHeaderButtons,
  mobileSidebarOpen,
  setMobileSidebarOpen,
}: PropsWithChildren<{
  showSidebar: boolean;
  showChatSidebar: boolean;
  showHeaderButtons: boolean;
  mobileSidebarOpen: boolean;
  setMobileSidebarOpen: (value: boolean | ((prev: boolean) => boolean)) => void;
}>) {
  const { activeChatId, openChats, clearActiveChat, closeChat } = useStreamChat();
  
  // Find the active chat details
  const activeChat = activeChatId ? openChats.find((c) => c.userId === activeChatId) : null;

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
        <Header
          showNavigation={false}
          showHeaderButtons={showHeaderButtons}
          onToggleSidebar={showSidebar ? () => setMobileSidebarOpen((v) => !v) : undefined}
          isSidebarOpen={showSidebar ? mobileSidebarOpen : undefined}
        />
      </div>

      {/* Page content with sidebar */}
      <main>
        <div className={`max-w-7xl mx-auto px-2 mt-10 flex ${showSidebar ? 'flex-col lg:flex-row' : 'flex-col'}`}>
          {/* Left Sidebar */}
          {showSidebar && (
            <aside id="app-sidebar" className={`w-full lg:w-72 lg:flex-shrink-0 lg:top-6 mb-8 lg:mb-0 ${mobileSidebarOpen ? 'block' : 'hidden'} lg:block`}>
              <Sidebar />
            </aside>
          )}

          {/* Main content area - Show ChatView if active, otherwise show children */}
          <div className={`w-full ${showSidebar ? 'lg:flex-1 lg:min-w-0' : ''} ${showChatSidebar ? 'lg:px-4' : ''}`}>
            {activeChat ? (
              <div className="h-full flex flex-col" style={{ minHeight: 'calc(100vh - 120px)' }}>
                <ChatView
                  userId={activeChat.userId}
                  userName={activeChat.userName}
                  userAvatar={activeChat.userAvatar}
                  minimized={false}
                  onClose={() => {
                    closeChat(activeChat.userId);
                    clearActiveChat();
                  }}
                  onToggleMinimize={() => {}} // Not used in middle column layout
                />
              </div>
            ) : (
              <div className="space-y-6 h-full">
                {children}
              </div>
            )}
          </div>

          {/* Right Chat Sidebar - can access InboxProvider from inbox page */}
          {showChatSidebar && (
            <aside className="hidden lg:block lg:w-72 lg:flex-shrink-0">
              <ChatSidebar />
            </aside>
          )}
        </div>
      </main>
    </div>
  );
} 
