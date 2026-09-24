import { IndexClient } from '@indexnetwork/client';
import type { Model, ModelMessage, ToolDefinition } from '@indexnetwork/agent';

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

/** One Hermes gateway completion. Tool execution stays in the agent loop. */
class HermesModel implements Model {
  constructor(private readonly bridge: Bridge) {}

  async complete(messages: ModelMessage[], tools: ToolDefinition[] = [], signal?: AbortSignal): Promise<ModelMessage> {
    const body = JSON.stringify({ messages, tools });
    let last: unknown;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const response = await fetch(`${this.bridge.url}/complete`, {
          method: 'POST',
          signal,
          headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
          body,
        });
        const payload = await response.json() as ModelMessage & { error?: string };
        if (!response.ok) throw new Error(payload.error ?? `Hermes completion failed (${response.status}).`);
        return {
          role: 'assistant',
          content: payload.content ?? null,
          ...(payload.tool_calls?.length ? { tool_calls: payload.tool_calls } : {}),
        };
      } catch (error) {
        last = error;
        if (signal?.aborted || attempt === 2 || (error instanceof Error && error.message.startsWith('Hermes completion failed'))) break;
        await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)));
      }
    }
    throw last;
  }
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const runner = startRunner({
  client: new IndexClient({
    baseUrl: required('INDEX_API_URL'),
    apiKey: required('INDEX_API_KEY'),
    agentId: required('INDEX_AGENT_ID'),
  }),
  model: new HermesModel(bridge),
  log: (line) => log('info', 'run', { line }),
  onError: (error) => log('warn', 'error', { reason: error instanceof Error ? error.message : String(error) }),
});

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  idleTimeout: 0,
  fetch: async (request) => {
    if (request.headers.get('authorization') !== `Bearer ${bridge.token}`) {
      return Response.json({ error: 'The Index bridge token is required.' }, { status: 401 });
    }
    if (new URL(request.url).pathname !== '/shutdown') {
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
