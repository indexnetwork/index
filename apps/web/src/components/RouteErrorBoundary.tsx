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
        title={isChunkFailure ? "This page needs a refresh" : "Something went wrong"}
        message={isChunkFailure
          ? "Index may have been updated while this page was open. Refresh to load the latest version without losing this URL."
          : "This page couldn't load. Refresh to try again, or go home if it keeps happening."}
      >
        <button className="site-btn" onClick={() => window.location.reload()} type="button">
          Refresh
        </button>
        {/* A full navigation, not a router Link: the router state is what just failed. */}
        <a className="site-btn site-btn--secondary" href="/">
          Go home
        </a>
      </StatusPage>
    </div>
  );
}
