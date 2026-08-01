/**
 * Production entrypoint: the ops API plus the built SPA from one Bun server.
 * Binds loopback unless EVAL_OPS_BIND is set explicitly — that variable is the
 * hook where authentication must land before any non-local deployment.
 */
import path from 'node:path';

import { createDefaultOpsContext, createOpsHandler } from '../../packages/protocol/eval/ops/ops.server.js';

const repoRoot = path.resolve(import.meta.dir, '../..');
const api = createOpsHandler(await createDefaultOpsContext({ repoRoot }));
const dist = path.join(import.meta.dir, 'dist');

Bun.serve({
  hostname: process.env.EVAL_OPS_BIND ?? '127.0.0.1',
  port: Number(process.env.EVAL_OPS_PORT ?? 4321),
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) return api(request);
    const asset = Bun.file(path.join(dist, url.pathname === '/' ? 'index.html' : url.pathname));
    if (await asset.exists()) return new Response(asset);
    return new Response(Bun.file(path.join(dist, 'index.html')));
  },
});
