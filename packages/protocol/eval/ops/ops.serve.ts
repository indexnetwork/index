#!/usr/bin/env bun
/**
 * Standalone entrypoint for the eval ops API.
 *
 * Binds loopback unless EVAL_OPS_BIND is set explicitly. That variable is the
 * hook where authentication must land before any non-local deployment: this
 * server has none, and everything it exposes can spend money and flush a database.
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
