import { PropsWithChildren, useMemo } from 'react';
import { useLocation } from 'react-router';
import { NetworkFilterProvider } from "@/contexts/NetworkFilterContext";
import { NetworksProvider } from "@/contexts/NetworksContext";
import { ConversationProvider } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";
import { useCompact } from "@/hooks/useCompact";
import { useVisualViewport } from "@/hooks/useVisualViewport";
import MobileTabBar, { isTabRoot } from "@/components/workbench/MobileTabBar";
import ConsentGate from "@/components/ConsentGate";
import AppFrame from "@/components/intents-home/AppFrame";
import { IntentsDataProvider } from "@/contexts/IntentsDataContext";

const appRoutes = ['/', '/i', '/u', '/networks', '/chat', '/negotiations', '/settings', '/agents', '/onboarding'];
// /l is the chrome-free web invite join.
const bareRoutes = ['/', '/l', '/login', '/download', '/found-in-translation', '/protocol', '/blog', '/about', '/hermes', '/pages', '/waitlist', '/9db20a5fbe', '/cli-auth', '/s', '/mcp'];

export default function ClientWrapper({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuthContext();
  const compact = useCompact();

  const isBareRoute = useMemo(() => {
    // Root is bare (landing) only for guests; authenticated users get the app shell.
    if (pathname === '/') return !isAuthenticated;
    return bareRoutes.some(route =>
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname, isAuthenticated]);

  const isAppRoute = useMemo(() => {
    return appRoutes.some(route =>
      pathname === route || pathname?.startsWith(route + '/')
    );
  }, [pathname]);

  const showAppShell = isAppRoute && !isBareRoute;
  // Desktop, signed in: every app page sits beside the intents rail. Onboarding
  // comes before there is anything to put in it.
  const framed = showAppShell && isAuthenticated && !compact && !pathname.startsWith('/onboarding');
  useVisualViewport(showAppShell);

  if (isBareRoute) {
    return (
      <NetworksProvider>
        {children}
      </NetworksProvider>
    );
  }

  return (
    <NetworksProvider>
      <ConversationProvider>
      <NetworkFilterProvider>
          {/* No min-h-screen under the app shell: iOS 100vh is the toolbar-hidden
              height, which made the document scroll the shell under the URL bar. */}
          <div className={`backdrop relative bg-[#FDFDFD] ${showAppShell ? "" : "min-h-screen"}`}>
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

            <ConsentGate>
              {showAppShell ? (
                <div className="workbench mac-desktop wb-viewport overflow-hidden flex flex-col">
                  <main className="flex-1 min-h-0 overflow-hidden flex flex-col">
                    {framed ? (
                      <IntentsDataProvider>
                        <AppFrame>{children}</AppFrame>
                      </IntentsDataProvider>
                    ) : children}
                  </main>
                  {compact && isAuthenticated && isTabRoot(pathname) && <MobileTabBar />}
                </div>
              ) : (
                <main className="flex flex-col min-h-screen">
                  {children}
                </main>
              )}
            </ConsentGate>
          </div>
      </NetworkFilterProvider>
      </ConversationProvider>
    </NetworksProvider>
  );
}
