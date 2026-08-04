/**
 * The single-process request routing: which requests the ops API answers, and
 * which ones are the built SPA.
 *
 * Separated from server.ts so the decision is testable without starting a
 * listener or building a real ops context. The rule is `isOpsServerPath`, which
 * lives with the API rather than here — a bare `startsWith('/api/')` at this
 * mount point silently swallowed `/callback`, so the SPA answered the sign-in
 * bridge with index.html and the freshly minted API key was left in the URL bar
 * and browser history for a sign-in that could never complete.
 */
import path from 'node:path';

import { isOpsServerPath } from '../../packages/protocol/eval/ops/ops.paths';

export interface SiteOptions {
  /** The ops API handler: everything `isOpsServerPath` claims goes here. */
  api: (request: Request) => Promise<Response>;
  /** Directory holding the built SPA. */
  distDir: string;
}

/**
 * Builds the fetch handler that serves the ops API and the built SPA together.
 *
 * Anything the API does not own is a file if one exists, and the SPA's
 * index.html otherwise — client-side routes have no file of their own, so the
 * fallback is what makes `/launch` and `/r/:id` work on a hard refresh.
 */
export function createSiteFetch(options: SiteOptions): (request: Request) => Promise<Response> {
  const { api, distDir } = options;
  return async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    if (isOpsServerPath(url.pathname)) return api(request);
    const asset = Bun.file(path.join(distDir, url.pathname === '/' ? 'index.html' : url.pathname));
    if (await asset.exists()) return new Response(asset);
    return new Response(Bun.file(path.join(distDir, 'index.html')));
  };
}
