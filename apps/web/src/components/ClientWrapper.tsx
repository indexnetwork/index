import { PropsWithChildren, useMemo } from 'react';
import { useLocation } from 'react-router';
import { NetworkFilterProvider } from "@/contexts/NetworkFilterContext";
import { NetworksProvider } from "@/contexts/NetworksContext";
import { ConversationProvider } from "@/contexts/ConversationContext";
import { useAuthContext } from "@/contexts/AuthContext";

const appRoutes = ['/', '/i', '/u', '/networks', '/chat', '/negotiations', '/settings', '/agents'];
// /l is chrome-free web invite join; /index stays app-only public join.
const bareRoutes = ['/', '/l', '/index', '/login', '/download', '/i/new', '/found-in-translation', '/overview', '/protocol', '/blog', '/about', '/hermes', '/pages', '/waitlist', '/9db20a5fbe', '/cli-auth'];

export default function ClientWrapper({ children }: PropsWithChildren) {
  const { pathname } = useLocation();
  const { isAuthenticated } = useAuthContext();

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
              <div className="workbench mac-desktop h-screen overflow-hidden">
                <main className="h-full overflow-hidden flex flex-col">
                  {children}
                </main>
              </div>
            ) : (
              <main className="flex flex-col min-h-screen">
                {children}
              </main>
            )}
          </div>
      </NetworkFilterProvider>
      </ConversationProvider>
    </NetworksProvider>
  );
}
