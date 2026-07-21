import { useRouteError } from "react-router";

import { classifyChunkLoadError } from "@/lib/lazy-route-recovery";

/** Renders a recoverable application error instead of React Router's default screen. */
export function RouteErrorBoundary() {
  const error = useRouteError();
  const isChunkFailure = classifyChunkLoadError(error) !== null;

  return (
    <main className="flex min-h-screen items-center justify-center bg-white px-6 py-16 text-neutral-950">
      <section
        className="w-full max-w-md rounded-2xl border border-neutral-200 bg-white p-8 text-center shadow-sm"
        role="alert"
      >
        <p className="mb-3 text-sm font-medium uppercase tracking-[0.16em] text-neutral-500">
          Index Network
        </p>
        <h1 className="text-2xl font-semibold tracking-tight">
          {isChunkFailure ? "This page needs a refresh" : "Something went wrong"}
        </h1>
        <p className="mt-3 text-sm leading-6 text-neutral-600">
          {isChunkFailure
            ? "Index may have been updated while this page was open. Refresh to load the latest version without losing this URL."
            : "We couldn't load this page. Refresh and try again, or return home if the problem continues."}
        </p>
        <div className="mt-7 flex flex-col gap-3 sm:flex-row sm:justify-center">
          <button
            className="rounded-full bg-neutral-950 px-5 py-2.5 text-sm font-medium text-white transition-colors hover:bg-neutral-800 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2"
            onClick={() => window.location.reload()}
            type="button"
          >
            Refresh page
          </button>
          <a
            className="rounded-full border border-neutral-300 px-5 py-2.5 text-sm font-medium text-neutral-800 transition-colors hover:bg-neutral-50 focus:outline-none focus:ring-2 focus:ring-neutral-950 focus:ring-offset-2"
            href="/"
          >
            Go to home
          </a>
        </div>
      </section>
    </main>
  );
}
