#!/usr/bin/env bun
/**
 * Standalone entrypoint for the eval ops API.
 *
 * Binds loopback unless EVAL_OPS_BIND is set explicitly, and every request must
 * also carry a session belonging to a verified @index.network Index account (see
 * ops.auth.ts). Authentication is defence in depth on top of the loopback
 * guards, not a replacement for them: it says *who* is driving a tool that can
 * spend money and flush a database, while the bind address, the `Host` check and
 * the `Origin` allowlist are what keep the site off the network. Do not set
 * EVAL_OPS_BIND to a non-loopback address — the guards would refuse the traffic
 * anyway, and this site has never been reviewed for exposure beyond loopback.
 *
 * The port is resolved once, here, and handed to both `Bun.serve` and
 * `createDefaultOpsContext` — the bridge callback URL must name the port this
 * process actually bound, and two independent reads of the environment are how
 * those drift.
 *
 * This is the *local* entrypoint, so it does not honour the platform's `PORT`:
 * `bun run eval:web` starts it with `--env-file=../../.env.test`, and that file
 * sets `PORT=3001` for the API service. `EVAL_OPS_PORT` changes the port here.
 * The deployed single-process entrypoint (apps/eval-ops/server.ts) is the one
 * the platform starts, and it does honour `PORT`.
 */
import path from "node:path";

import { createDefaultOpsContext, createOpsHandler, ensureConfigStorage, resolveBindHostname, resolveBindPort } from "./ops.server.js";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const port = resolveBindPort({ env: process.env, honourPlatformPort: false });
const context = await createDefaultOpsContext({ repoRoot, port });
await ensureConfigStorage(context);

const server = Bun.serve({
  hostname: resolveBindHostname(process.env),
  port,
  // SSE streams are quiet between log writes; the stream sends its own heartbeat,
  // and this raises Bun's 10s request idle timeout out of the way of it.
  idleTimeout: 255,
  fetch: createOpsHandler(context),
});

// Names the posture as well as the address: a `PORT` in the environment is
// deliberately ignored here, and silence about that would read as a bug.
console.log(
  `[eval-ops] listening on http://${server.hostname}:${server.port} (local API; PORT is ignored, EVAL_OPS_PORT sets this)`,
);
