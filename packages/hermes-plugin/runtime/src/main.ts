import { AgentRunner, type AgentEvent, type Execute, type ExecutionInput, type Tool } from '@indexnetwork/agent';

import { IndexClient } from './client.ts';

interface Bridge {
  url: string;
  token: string;
}

interface ActiveCall {
  tools: Map<string, Tool>;
}

function log(level: 'info' | 'warn', event: string, detail: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ level, event, ...detail })}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/** One principal-scoped agent runner using Hermes for complete reasoning runs. */
class Negotiator {
  private readonly calls = new Map<string, ActiveCall>();
  private readonly runner: AgentRunner;

  /** @param client - Authoritative Index REST host. @param bridge - Loopback Hermes bridge. */
  constructor(client: IndexClient, private readonly bridge: Bridge) {
    const execute: Execute = (input) => this.execute(input);
    this.runner = new AgentRunner({
      host: client,
      execute,
      log: (line) => log('info', 'agent', { line: line.trim() }),
      onError: (error) => log('warn', 'agent.failed', { reason: error instanceof Error ? error.message : String(error) }),
    });
  }

  /** @returns After authoritative state has been adopted and recovery work scheduled. */
  reconcile(): Promise<void> {
    return this.runner.reconcile();
  }

  /** @param event - Notification for a change already persisted by Index. */
  event(event: AgentEvent): void {
    this.runner.handle(event);
  }

  /** @param intentId - Intent explicitly requested by the dashboard. */
  wake(intentId: string): void {
    this.runner.wake(intentId);
  }

  /** Permanently cancel this runner and its active reasoning calls. */
  stop(): void {
    this.runner.stop();
  }

  /**
   * Invoke one package-owned tool for an active Hermes execution.
   * @param callId - Execution invocation ID.
   * @param name - Permitted tool name.
   * @param args - Model-produced arguments.
   * @returns Explicit success, feedback, and terminal status for the bridge.
   */
  async tool(callId: string, name: string, args: unknown): Promise<
    { ok: true; result: unknown; terminal: boolean } | { ok: false; error: string }
  > {
    const tool = this.calls.get(callId)?.tools.get(name);
    if (!tool) return { ok: false, error: `No permitted tool named "${name}".` };
    try {
      return { ok: true, result: (await tool.run(args)) ?? null, terminal: tool.terminal === true };
    } catch (error: unknown) {
      return { ok: false, error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async execute(input: ExecutionInput): Promise<void> {
    input.abortSignal.throwIfAborted();
    const callId = crypto.randomUUID();
    this.calls.set(callId, { tools: new Map(input.tools.map((tool) => [tool.name, tool])) });
    const cancel = () => {
      void fetch(`${this.bridge.url}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ callId }),
      }).catch(() => {});
    };
    input.abortSignal.addEventListener('abort', cancel, { once: true });
    try {
      const response = await fetch(`${this.bridge.url}/speak`, {
        method: 'POST',
        signal: input.abortSignal,
        headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId,
          operation: input.operation,
          principalId: input.principalId,
          intentId: input.intentId,
          opportunityId: input.opportunityId,
          instructions: input.instructions,
          prompt: input.prompt,
          maxSteps: input.maxSteps,
          tools: input.tools.map(({ name, description, parameters, terminal }) => ({
            name, description, parameters, terminal: terminal === true,
          })),
        }),
      });
      const body = await response.json() as { error?: string };
      if (!response.ok || body.error) {
        throw new Error(body.error ?? `Hermes execution failed (${response.status}).`);
      }
    } finally {
      input.abortSignal.removeEventListener('abort', cancel);
      this.calls.delete(callId);
    }
  }
}

function parseEvent(body: Record<string, unknown>): AgentEvent {
  const type = body.type;
  const intentId = body.intentId;
  if (typeof intentId !== 'string') throw new Error('intentId is required.');
  if (type === 'negotiation.turn') {
    if (typeof body.opportunityId !== 'string') throw new Error('opportunityId is required.');
    return { type, intentId, opportunityId: body.opportunityId };
  }
  if (type === 'principal.input' || type === 'intent.created' || type === 'intent.updated' || type === 'intent.lifecycle') {
    return { type, intentId };
  }
  throw new Error(`Unsupported agent event: ${String(type)}.`);
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const negotiator = new Negotiator(
  new IndexClient(required('INDEX_API_ORIGIN'), required('INDEX_SESSION_TOKEN'), required('INDEX_EXECUTOR_ID')),
  bridge,
);

const json = (body: unknown, status = 200) => Response.json(body, { status });

const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  idleTimeout: 0,
  fetch: async (request) => {
    if (request.headers.get('authorization') !== `Bearer ${bridge.token}`) {
      return json({ error: 'The Index bridge token is required.' }, 401);
    }
    const { pathname } = new URL(request.url);
    let body: Record<string, unknown>;
    try {
      body = await request.json() as Record<string, unknown>;
    } catch {
      return json({ error: 'The request body must be an object.' }, 400);
    }
    try {
      switch (pathname) {
        case '/reconcile':
          await negotiator.reconcile();
          return json({ ok: true });
        case '/event':
          negotiator.event(parseEvent(body));
          return json({ ok: true });
        case '/wake':
          negotiator.wake(String(body.intentId));
          return json({ ok: true });
        case '/tool':
          return json(await negotiator.tool(String(body.callId), String(body.name), body.args));
        case '/shutdown':
          queueMicrotask(() => void shutdown());
          return json({ ok: true });
        default:
          return json({ error: 'Unknown negotiator route.' }, 404);
      }
    } catch (error: unknown) {
      return json({ error: error instanceof Error ? error.message : String(error) }, 502);
    }
  },
});

async function shutdown(): Promise<void> {
  negotiator.stop();
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
