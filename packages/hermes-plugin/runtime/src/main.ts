import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

import { createOpenAICompatible } from '@ai-sdk/openai-compatible';
import { IndexClient } from '@indexnetwork/client';
import type { Model, NegotiateHook } from '@indexnetwork/agent';

import { startRunner } from '@indexnetwork/agent/runner';

interface Bridge {
  url: string;
  token: string;
}

function log(level: 'info' | 'warn', event: string, detail: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ level, event, ...detail })}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** A connection the bridge reset is tried again, up to three times. A response, even an error, is final. */
const retrying = (async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(input, init);
    } catch (error) {
      if (init?.signal?.aborted || attempt === 2) throw error;
      await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
    }
  }
}) as typeof fetch;

/** Hermes's gateway model, one completion per step. Tool execution stays in the agent loop. */
function hermesModel(bridge: Bridge): Model {
  return createOpenAICompatible({ name: 'hermes', baseURL: `${bridge.url}/v1`, apiKey: bridge.token, fetch: retrying }).chatModel('hermes');
}

/** The resident's negotiator. The sidecar names it only when `custom_negotiator` is on; otherwise, or with no file, the built-in negotiator runs. */
async function loadHook(): Promise<NegotiateHook | undefined> {
  const modulePath = process.env.INDEX_NEGOTIATOR_MODULE?.trim();
  if (!modulePath || !existsSync(modulePath)) return undefined;
  const loaded = await import(pathToFileURL(modulePath).href) as { default?: unknown };
  if (typeof loaded.default !== 'function') {
    throw new Error(`INDEX_NEGOTIATOR_MODULE must default-export a function (${modulePath}).`);
  }
  return loaded.default as NegotiateHook;
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const negotiate = await loadHook();
const runner = startRunner({
  client: new IndexClient({
    baseUrl: required('INDEX_API_URL'),
    apiKey: required('INDEX_API_KEY'),
    agentId: required('INDEX_AGENT_ID'),
  }),
  model: hermesModel(bridge),
  log: (line) => log('info', 'run', { line }),
  onError: (error) => log('warn', 'error', { reason: error instanceof Error ? error.message : String(error) }),
  ...(negotiate ? { negotiate } : {}),
});

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  idleTimeout: 0,
  fetch: async (request) => {
    if (request.headers.get('authorization') !== `Bearer ${bridge.token}`) {
      return Response.json({ error: 'The Index bridge token is required.' }, { status: 401 });
    }
    const path = new URL(request.url).pathname;
    if (path === '/morning' && request.method === 'POST') {
      const body = await request.json().catch(() => null) as { intentId?: string } | null;
      const intentId = body?.intentId?.trim();
      if (!intentId) return Response.json({ error: 'intentId is required.' }, { status: 400 });
      await runner.morning(intentId);
      return Response.json({ ok: true });
    }
    if (path !== '/shutdown') {
      return Response.json({ error: 'Unknown negotiator route.' }, { status: 404 });
    }
    queueMicrotask(() => void shutdown());
    return Response.json({ ok: true });
  },
});

async function shutdown(): Promise<void> {
  runner.stop();
  await server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());

const supervisor = Number(process.env.INDEX_SUPERVISOR_PID ?? '');
if (Number.isInteger(supervisor) && supervisor > 0) {
  setInterval(() => {
    try {
      process.kill(supervisor, 0);
    } catch {
      void shutdown();
    }
  }, 2000).unref();
}

console.log(JSON.stringify({ ready: true, port: server.port }));
