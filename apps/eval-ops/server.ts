/**
 * Production entrypoint: the ops API plus the built SPA from one Bun server.
 *
 * Binds loopback unless EVAL_OPS_BIND is set explicitly, and every request is
 * still gated on a verified @index.network Index session — this entrypoint
 * mounts the same handler, with the same guards, as the standalone API.
 *
 * Because the SPA and the API share one origin here, a completed sign-in returns
 * the browser to `/`; the two-process dev flow serves the UI elsewhere, which is
 * why the target is configuration rather than a constant. `createSiteFetch` owns
 * the forwarding rule, so `/callback` cannot be answered with index.html.
 *
 * This is the entrypoint a platform starts, so it honours the `PORT` that
 * platform injects — unlike the local API entrypoint (ops.serve.ts), which is
 * started with `.env.test` loaded and would otherwise take the API service's
 * `PORT=3001`. The port is resolved once and handed to both `Bun.serve` and
 * `createDefaultOpsContext`, because the bridge callback URL must name the port
 * this process actually bound.
 *
 * Reaching it from a browser needs more than a wider bind: EVAL_OPS_PUBLIC_ORIGIN
 * must also name the deployed origin, or the Host and Origin allowlists refuse
 * every request.
 */
import path from 'node:path';

import { createDefaultOpsContext, createOpsHandler, resolveBindHostname, resolveBindPort } from '../../packages/protocol/eval/ops/ops.server.js';
import { createSiteFetch } from './site';

const repoRoot = path.resolve(import.meta.dir, '../..');
const port = resolveBindPort({ env: process.env, honourPlatformPort: true });
const api = createOpsHandler(await createDefaultOpsContext({ repoRoot, uiUrl: '/', port }));

const server = Bun.serve({
  hostname: resolveBindHostname(process.env),
  port,
  // The run-log SSE stream is quiet between log writes and sends its own comment
  // heartbeat every HEARTBEAT_MS (15s, ops.server.ts). Bun's default request idle
  // timeout is 10s, so without this a run that produces no output for ten seconds
  // — which is every run while a model is thinking — has its stream closed before
  // the first heartbeat can hold it open. Matches ops.serve.ts, which is the same
  // handler and needs the same allowance.
  idleTimeout: 255,
  fetch: createSiteFetch({ api, distDir: path.join(import.meta.dir, 'dist') }),
});

console.log(
  `[eval-ops] listening on http://${server.hostname}:${server.port} (single-process site; honours the platform's PORT)`,
);
