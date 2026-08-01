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
 * EVAL_OPS_PORT is read here for the bind and again in `createDefaultOpsContext`
 * for the bridge callback URL. They must agree, or the sign-in bridge delivers
 * the credential to a port nothing is listening on; a test in
 * tests/server.spec.ts pins that they read the same variable and default.
 */
import path from "node:path";

import { createDefaultOpsContext, createOpsHandler } from "./ops.server.js";

const repoRoot = path.resolve(import.meta.dir, "../../../..");
const context = await createDefaultOpsContext({ repoRoot });

const server = Bun.serve({
  hostname: process.env.EVAL_OPS_BIND ?? "127.0.0.1",
  port: Number(process.env.EVAL_OPS_PORT ?? 4321),
  // SSE streams are quiet between log writes; the stream sends its own heartbeat,
  // and this raises Bun's 10s request idle timeout out of the way of it.
  idleTimeout: 255,
  fetch: createOpsHandler(context),
});

console.log(`[eval-ops] listening on http://${server.hostname}:${server.port}`);
