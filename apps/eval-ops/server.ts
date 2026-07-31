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
 */
import path from 'node:path';

import { createDefaultOpsContext, createOpsHandler } from '../../packages/protocol/eval/ops/ops.server.js';
import { createSiteFetch } from './site';

const repoRoot = path.resolve(import.meta.dir, '../..');
const api = createOpsHandler(await createDefaultOpsContext({ repoRoot, uiUrl: '/' }));

Bun.serve({
  hostname: process.env.EVAL_OPS_BIND ?? '127.0.0.1',
  port: Number(process.env.EVAL_OPS_PORT ?? 4321),
  fetch: createSiteFetch({ api, distDir: path.join(import.meta.dir, 'dist') }),
});
