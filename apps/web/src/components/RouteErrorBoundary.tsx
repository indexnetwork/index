import { useRouteError } from "react-router";

import { StatusPage } from "@/components/SiteSignIn";
import { classifyChunkLoadError } from "@/lib/lazy-route-recovery";

/**
 * Renders a recoverable application error instead of React Router's default screen.
 * Uses the same shell as the not-found page so both read as one family.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const isChunkFailure = classifyChunkLoadError(error) !== null;

  return (
    <div role="alert">
      <StatusPage
        bar="error"
        title={isChunkFailure ? "this page needs a refresh" : "something went wrong"}
        message={isChunkFailure
          ? "index was updated while this page was open. refresh to load the latest version. you stay on this page."
          : "this page couldn't load. refresh to try again, or go home if it keeps happening."}
      >
        <button className="site-btn" onClick={() => window.location.reload()} type="button">
          refresh
        </button>
        {/* A full navigation, not a router Link: the router state is what just failed. */}
        <a className="site-btn site-btn--secondary" href="/">
          go home
        </a>
      </StatusPage>
    </div>
  );
}
