import { join } from 'node:path';

import { NegotiationAgent, type Model, type NegotiationHost, type PrincipalMessage, type RunResult, type Speaker, type Tool } from '@indexnetwork/agent';

import { IndexClient } from './client.ts';
import { FilePrincipalStore } from './store.ts';

interface Bridge {
  url: string;
  token: string;
}

interface IntentRuntime {
  agent: NegotiationAgent;
  store: FilePrincipalStore;
  title: string;
  flushing: Promise<void>;
}

const unusedModel: Model = {
  complete: async () => {
    throw new Error('This host uses a Hermes speaker.');
  },
};

function log(level: 'info' | 'warn', event: string, detail: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ level, event, ...detail })}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function signalTitle(payload: string): string {
  const line = payload.trim().replace(/\s+/g, ' ');
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || 'Index signal';
}

/** @indexnetwork/agent with Hermes as the speaker: one think session, one session per match. */
class Negotiator {
  private readonly runtimes = new Map<string, Promise<IntentRuntime>>();
  private readonly calls = new Map<string, Map<string, Tool<never>>>();
  private principal?: Promise<{ owner: { id: string; name: string | null }; principalContext: string; guidance: string }>;

  constructor(
    private readonly client: IndexClient,
    private readonly bridge: Bridge,
    private readonly stateDirectory: string,
  ) {}

  private context() {
    return this.principal ??= (async () => {
      const [principal, guidance] = await Promise.all([this.client.principal(), this.client.guidance()]);
      return { ...principal, guidance };
    })().catch((error: unknown) => {
      this.principal = undefined;
      throw error;
    });
  }

  private runtime(intentId: string): Promise<IntentRuntime> {
    let pending = this.runtimes.get(intentId);
    if (!pending) {
      pending = this.create(intentId);
      this.runtimes.set(intentId, pending);
      pending.catch(() => this.runtimes.delete(intentId));
    }
    return pending;
  }

  private speaker(intentId: string, title: string): Speaker {
    return {
      turn: (input) => this.speak(intentId, title, {
        kind: 'turn', opportunityId: input.opportunityId, counterparty: input.counterparty,
        prompt: input.prompt, tools: input.tools, signal: input.signal,
      }),
      inbox: (input) => this.speak(intentId, title, {
        kind: 'inbox', prompt: input.prompt, tools: input.tools, signal: input.signal,
      }),
    };
  }

  private async speak(
    intentId: string,
    title: string,
    input: { kind: 'turn' | 'inbox'; opportunityId?: string; counterparty?: string; prompt: string; tools: Tool<never>[]; signal: AbortSignal },
  ): Promise<RunResult> {
    const callId = crypto.randomUUID();
    this.calls.set(callId, new Map(input.tools.map((tool) => [tool.name, tool])));
    try {
      const response = await fetch(`${this.bridge.url}/speak`, {
        method: 'POST',
        signal: input.signal,
        headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId, kind: input.kind, intentId, title, prompt: input.prompt,
          opportunityId: input.opportunityId, counterparty: input.counterparty,
        }),
      });
      const body = await response.json() as { end?: RunResult['end']; output?: string; error?: string };
      if (!response.ok) throw new Error(body.error ?? `Hermes speaker failed (${response.status}).`);
      return { end: body.end ?? 'done', output: body.output ?? '', steps: [], messages: [] };
    } finally {
      this.calls.delete(callId);
    }
  }

  async tool(callId: string, name: string, args: unknown): Promise<unknown> {
    const tool = this.calls.get(callId)?.get(name);
    if (!tool?.run) throw new Error(`No tool named "${name}".`);
    try {
      return await tool.run(args as never, { agent: undefined as never });
    } catch (error: unknown) {
      return { error: error instanceof Error ? error.message : String(error) };
    }
  }

  private async create(intentId: string): Promise<IntentRuntime> {
    const { owner, principalContext, guidance } = await this.context();
    const intent = await this.client.intent(intentId);
    const store = new FilePrincipalStore(join(this.stateDirectory, `${owner.id}.${intentId}.json`));
    const title = signalTitle(intent.payload);
    const runtime = { store, title, flushing: Promise.resolve() } as IntentRuntime;
    const host: NegotiationHost = {
      status: (opportunityId, message) => log('info', 'status', { intentId, opportunityId, message }),
      retry: (_owner, attempt, reason) => log('warn', 'retry', { intentId, attempt, reason }),
      step: () => {},
      conversation: () => { runtime.flushing = runtime.flushing.then(() => this.publishThink(runtime, intentId), () => {}); },
      end: (record) => log('info', 'end', {
        intentId, opportunityId: record.opportunityId,
        outcome: record.outcome ?? record.protocol.blockedReason,
      }),
      error: (opportunityId, _owner, reason) => log('warn', 'error', { intentId, opportunityId, reason }),
    };
    runtime.agent = new NegotiationAgent({
      owner, intent, principalContext, guidance,
      client: {
        readNegotiation: async (id) => {
          const record = await this.client.readNegotiation(id);
          if (record.intentId !== intentId) throw new Error('Negotiation is outside this principal/intent session.');
          return record;
        },
        submitTurn: (id, turn) => this.client.submitTurn(id, turn),
      },
    }, host, { model: unusedModel, store, speaker: this.speaker(intentId, title) });
    await runtime.agent.start();
    log('info', 'signal.started', { intentId });
    host.conversation();
    return runtime;
  }

  async wake(intentId: string): Promise<void> {
    const runtime = await this.runtime(intentId);
    const summaries = await this.client.listNegotiations();
    for (const { opportunityId, intentId: owning } of summaries) {
      if (owning !== intentId) continue;
      void runtime.agent.receive({ kind: 'opportunity.matched', opportunityId })
        .catch((error: unknown) => log('warn', 'error', { intentId, opportunityId, reason: String(error) }));
    }
  }

  async message(intentId: string, text: string): Promise<boolean> {
    return Boolean(await (await this.runtime(intentId)).agent.message(text));
  }

  async answer(intentId: string, questionId: string, text: string): Promise<boolean> {
    return Boolean(await (await this.runtime(intentId)).agent.answer(questionId, text));
  }

  async pending(intentId: string) {
    const runtime = await this.runtime(intentId);
    return { pending: runtime.agent.pending, queuedQuestions: runtime.agent.queuedQuestions };
  }

  async stop(): Promise<void> {
    const runtimes = await Promise.allSettled([...this.runtimes.values()]);
    await Promise.allSettled(runtimes.map((result) => result.status === 'fulfilled' ? result.value.agent.stop() : undefined));
  }

  private async publishThink(runtime: IntentRuntime, intentId: string): Promise<void> {
    const displayed = runtime.agent.pending?.id;
    const entries: PrincipalMessage[] = [];
    const retired: string[] = [];
    for (const message of runtime.agent.conversation) {
      if (runtime.store.delivered(message.id)) continue;
      if (message.kind === 'question' ? message.questionId === displayed : message.kind === 'message') {
        entries.push(message);
      } else {
        retired.push(message.id);
      }
    }
    if (retired.length) await runtime.store.markDelivered(retired);
    if (!entries.length) return;
    const response = await fetch(`${this.bridge.url}/think`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        intentId, title: runtime.title,
        entries: entries.map(({ kind, text }) => ({ kind, text })),
      }),
    });
    if (!response.ok) {
      log('warn', 'think.failed', { intentId, reason: (await response.text()).slice(0, 300) });
      return;
    }
    await runtime.store.markDelivered(entries.map(({ id }) => id));
  }
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const negotiator = new Negotiator(
  new IndexClient(required('INDEX_API_ORIGIN'), required('INDEX_SESSION_TOKEN'), required('INDEX_EXECUTOR_ID')),
  bridge,
  required('INDEX_STATE_DIR'),
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
        case '/wake':
          await negotiator.wake(String(body.intentId));
          return json({ ok: true });
        case '/message':
          return json({ accepted: await negotiator.message(String(body.intentId), String(body.text)) });
        case '/answer':
          return json({ accepted: await negotiator.answer(String(body.intentId), String(body.questionId), String(body.text)) });
        case '/pending':
          return json(await negotiator.pending(String(body.intentId)));
        case '/tool':
          return json({
            result: await negotiator.tool(String(body.callId), String(body.name), body.args),
          });
        case '/shutdown':
          queueMicrotask(() => void shutdown());
          return json({ ok: true });
        default:
          return json({ error: 'Unknown negotiator route.' }, 404);
      }
    } catch (error: unknown) {
      return json({ error: String(error) }, 502);
    }
  },
});

async function shutdown(): Promise<void> {
  await negotiator.stop();
  await server.stop();
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
console.log(JSON.stringify({ ready: true, port: server.port }));
