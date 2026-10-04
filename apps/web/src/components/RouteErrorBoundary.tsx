import { useRouteError } from "react-router";

import SiteLayout from "@/app/site/SiteLayout";
import { classifyChunkLoadError } from "@/lib/lazy-route-recovery";

/**
 * Renders a recoverable application error instead of React Router's default screen.
 * Uses the same public-site shell as the not-found page so both read as one family.
 */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const isChunkFailure = classifyChunkLoadError(error) !== null;

  return (
    <SiteLayout>
      <section className="site-hero" role="alert">
        <h1 className="site-h1">
          {isChunkFailure ? "This page needs a refresh" : "Something went wrong"}
        </h1>
        <p className="site-p">
          {isChunkFailure
            ? "Index may have been updated while this page was open. Refresh to load the latest version without losing this URL."
            : "This page couldn't load. Refresh to try again, or go home if it keeps happening."}
        </p>
        <div className="site-btn-row">
          <button className="site-btn" onClick={() => window.location.reload()} type="button">
            Refresh
          </button>
          {/* A full navigation, not a router Link: the router state is what just failed. */}
          <a className="site-btn site-btn--secondary" href="/">
            Go home
          </a>
        </div>
      </section>
    </SiteLayout>
  );
}
