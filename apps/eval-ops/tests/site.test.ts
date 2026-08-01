// @vitest-environment node
// This suite is the Bun server's own routing, not a browser: happy-dom replaces
// `Response`, and its version cannot read a `Bun.file` body (it stringifies it to
// "[object Blob]"), which would make the static-file assertions test the DOM stub
// rather than the server.
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createSiteFetch } from '../site';

/**
 * The single-process entrypoint's forwarding rule.
 *
 * This is the seam that decides, per request, whether the ops API answers or the
 * built SPA does — and it shipped forwarding only `/api/`. `/callback` is not
 * under `/api/`, and cannot be: the sign-in bridge's own validator accepts that
 * pathname and no other. So the bridge redirected the operator's browser, with a
 * freshly minted API key in the query string, to a path this server answered with
 * `index.html`. The key was never exchanged and never invalidated, and it stayed
 * in the URL bar, in browser history, and in the `Referer` of the SPA's own asset
 * requests, for a sign-in that could never complete.
 */

let dist: string;
/** Every request the stub API was handed, in order. */
let forwarded: string[];

/** Stands in for the ops handler: records the path and answers recognisably. */
const api = async (request: Request): Promise<Response> => {
  forwarded.push(new URL(request.url).pathname);
  return new Response('from the ops api', { status: 200 });
};

beforeEach(async () => {
  dist = await mkdtemp(path.join(tmpdir(), 'eval-ops-site-'));
  await writeFile(path.join(dist, 'index.html'), '<!doctype html><title>spa</title>');
  await mkdir(path.join(dist, 'assets'));
  await writeFile(path.join(dist, 'assets', 'app.js'), 'console.log("spa")');
  forwarded = [];
});

afterEach(async () => {
  await rm(dist, { recursive: true, force: true });
});

const fetchSite = (pathname: string) =>
  createSiteFetch({ api, distDir: dist })(new Request(`http://127.0.0.1:4321${pathname}`));

describe('the single-process entrypoint', () => {
  it('forwards the sign-in callback to the ops API, not to the SPA', async () => {
    const response = await fetchSite('/callback?state=abc&api_key=radioactive');

    expect(forwarded).toEqual(['/callback']);
    expect(await response.text()).toBe('from the ops api');
  });

  it('forwards every /api path to the ops API', async () => {
    for (const pathname of ['/api', '/api/auth/status', '/api/runs', '/api/runs/some-id/stream']) {
      expect(await (await fetchSite(pathname)).text()).toBe('from the ops api');
    }

    expect(forwarded).toEqual(['/api', '/api/auth/status', '/api/runs', '/api/runs/some-id/stream']);
  });

  it('serves the SPA for everything the API does not own', async () => {
    expect(await (await fetchSite('/')).text()).toContain('<title>spa</title>');
    expect(await (await fetchSite('/assets/app.js')).text()).toBe('console.log("spa")');
    // A client-side route has no file of its own: the fallback is what makes a
    // hard refresh on /launch work.
    expect(await (await fetchSite('/launch')).text()).toContain('<title>spa</title>');
    expect(forwarded).toEqual([]);
  });
});
