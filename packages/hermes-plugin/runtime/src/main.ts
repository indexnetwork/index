import { join } from 'node:path';

import { Agent, type AgentHost, type IntentActivation, type Model, type NegotiationEvent, type NegotiationSpeaker, type RunResult, type Step, type Tool } from '@indexnetwork/agent';

import { IndexClient } from './client.ts';
import { FilePrincipalRecords } from './principal.records.ts';

interface Bridge { url: string; token: string }
interface IntentRuntime {
  agent: Agent;
  controller: AbortController;
  listeners: Set<(event: NegotiationEvent) => Promise<void>>;
  records: FilePrincipalRecords;
  flushing: Promise<void>;
}
type SpeakerInput = Parameters<NegotiationSpeaker['run']>[0];
interface SpeakerCall {
  input: SpeakerInput;
  tools: Map<string, Tool>;
  steps: Step[];
  stopped: boolean;
  running: Promise<void>;
  finish(error: unknown): void;
}

const unusedModel: Model = { complete: async () => { throw new Error('This host uses native Hermes speaking sessions.'); } };

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

/** Native Hermes think/speaker sessions execute only the tools and fences supplied by the current agent. */
class Negotiator {
  private readonly runtimes = new Map<string, Promise<IntentRuntime>>();
  private readonly calls = new Map<string, SpeakerCall>();

  constructor(private readonly client: IndexClient, private readonly bridge: Bridge, private readonly stateDirectory: string) {}

  private runtime(intentId: string): Promise<IntentRuntime> {
    let pending = this.runtimes.get(intentId);
    if (!pending) {
      pending = this.create(intentId);
      this.runtimes.set(intentId, pending);
      void pending.catch(() => this.runtimes.delete(intentId));
    }
    return pending;
  }

  private async speak(title: string, input: SpeakerInput): Promise<RunResult> {
    const callId = crypto.randomUUID();
    const controller = new AbortController();
    let finish!: (error: unknown) => void;
    const finished = new Promise<never>((_resolve, reject) => { finish = reject; });
    const call: SpeakerCall = { input, tools: new Map(input.tools.map((tool) => [tool.name, tool])), steps: [], stopped: false, running: Promise.resolve(), finish };
    this.calls.set(callId, call);
    try {
      const response = fetch(`${this.bridge.url}/speak`, {
        method: 'POST',
        signal: AbortSignal.any([controller.signal, ...(input.signal ? [input.signal] : [])]),
        headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          callId, kind: input.kind, intentId: input.intentId, title,
          systemPrompt: input.systemPrompt, prompt: input.prompt,
          opportunityId: input.opportunityId, counterparty: input.counterparty,
          tools: input.tools.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.parameters } })),
        }),
      }).then(async (response) => {
        const body = await response.json() as { end?: RunResult['end']; output?: string; error?: string };
        if (!response.ok) throw new Error(body.error ?? `Hermes speaker failed (${response.status}).`);
        return { end: body.end ?? 'done', output: body.output ?? '', steps: call.steps, messages: [] } satisfies RunResult;
      });
      return await Promise.race([response, finished]);
    } finally {
      call.stopped = true;
      this.calls.delete(callId);
      controller.abort();
      try {
        const response = await fetch(`${this.bridge.url}/cancel`, {
          method: 'POST', signal: AbortSignal.timeout(5000),
          headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ callId }),
        });
        if (!response.ok) log('warn', 'speaker.cancel_failed', { callId, status: response.status });
      } catch (error) {
        log('warn', 'speaker.cancel_failed', { callId, reason: String(error) });
      }
    }
  }

  /** @param callId - Live native session. @param name - An offered domain tool. @param args - Native model arguments. @returns Tool result plus an immediate stop instruction after a domain completion fence. */
  async tool(callId: string, name: string, args: unknown): Promise<{ result: unknown; stop: boolean }> {
    const call = this.calls.get(callId);
    if (!call) return { result: { error: 'This Index run ended.' }, stop: true };
    const result = call.running.then(() => this.runTool(call, name, args));
    call.running = result.then(() => {}, () => {});
    return result;
  }

  private async runTool(call: SpeakerCall, name: string, args: unknown): Promise<{ result: unknown; stop: boolean }> {
    if (call.stopped || call.input.signal?.aborted) return { result: { error: 'This Index run ended.' }, stop: true };
    const tool = call.tools.get(name);
    let step: Step;
    let result: unknown;
    try {
      if (!tool?.run) throw new Error(`No tool named "${name}" in this run.`);
      result = await tool.run(args as never, call.input.context);
      step = { kind: 'tool', name, input: args, output: result };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      result = { error: reason };
      step = { kind: 'tool', name, input: args, error: reason };
    }
    call.steps.push(step);
    try {
      call.input.onStep?.(step);
    } catch (completion) {
      call.stopped = true;
      // Keep the original domain exception in this process. It is not an error
      // for Hermes to repair by calling another tool or retrying a POST.
      call.finish(completion);
    }
    return { result, stop: call.stopped };
  }

  private async create(intentId: string): Promise<IntentRuntime> {
    const [{ owner }, guidance, intent] = await Promise.all([this.client.principal(), this.client.guidance(), this.client.intent(intentId)]);
    const records = new FilePrincipalRecords(join(this.stateDirectory, `${owner.id}.${intentId}.records.json`), this.client, intentId);
    const title = signalTitle(intent.payload);
    const controller = new AbortController();
    const listeners = new Set<(event: NegotiationEvent) => Promise<void>>();
    const host: AgentHost = {
      subscribe: (receive) => {
        listeners.add(receive);
        return () => { listeners.delete(receive); };
      },
      event: (event) => log('info', event.type, { intentId, ...event }),
      status: (opportunityId, message) => log('info', 'status', { intentId, opportunityId, message }),
      retry: (_owner, attempt, reason) => log('warn', 'retry', { intentId, attempt, reason }),
      step: () => {},
      conversation: () => {
        runtime.flushing = runtime.flushing.then(() => records.publish()).catch((error: unknown) => {
          log('warn', 'h2a.failed', { intentId, reason: String(error) });
        });
      },
      end: (record) => log('info', 'end', { intentId, opportunityId: record.opportunityId, outcome: record.outcome ?? record.protocol.blockedReason }),
      error: (opportunityId, _owner, reason) => log('warn', 'error', { intentId, opportunityId, reason }),
    };
    const agent = new Agent({
      owner, intentId, guidance,
      client: {
        listNegotiations: () => this.client.negotiationsForIntent(intentId),
        readNegotiation: async (id) => {
          const record = await this.client.readNegotiation(id);
          if (record.intentId !== intentId) throw new Error('Negotiation is outside this principal/intent session.');
          return record;
        },
        submitTurn: (id, turn) => this.client.submitTurn(id, turn),
      },
    }, host, { model: unusedModel, records, speaker: { run: (input) => this.speak(title, input) }, signal: controller.signal });
    const runtime: IntentRuntime = { agent, controller, listeners, records, flushing: Promise.resolve() };
    try {
      await agent.ready;
    } catch (error) {
      // Closing can queue a final publication; drain it before a replacement runtime reads these records.
      await agent.closed.catch(() => {});
      await runtime.flushing.catch(() => {});
      throw error;
    }
    log('info', 'signal.started', { intentId });
    host.conversation();
    return runtime;
  }

  /** Observe A2A changes without turning stalls or reconnects into H2A activations. */
  async wake(intentId: string, activation?: IntentActivation): Promise<void> {
    const runtime = await this.runtime(intentId);
    if (activation) await runtime.agent.wake(activation);
    for (const record of await this.client.negotiationsForIntent(intentId)) {
      for (const receive of runtime.listeners) {
        void receive({ kind: 'opportunity.matched', opportunityId: record.opportunityId })
          .catch((error: unknown) => log('warn', 'error', { intentId, opportunityId: record.opportunityId, reason: String(error) }));
      }
    }
  }

  /** Review canonical owner input once per durable receipt, never reconstruct answers from text or repeat their writes. */
  async input(intentId: string, inputId: string): Promise<void> {
    const runtime = await this.runtime(intentId);
    const current = await runtime.records.read();
    const latest = current.messages.findLast((entry) => entry.kind === 'user' || entry.kind === 'answer');
    if (latest?.id !== inputId) return;
    await runtime.agent.wake({ id: `principal.input:${inputId}`, type: 'h2a.wake' });
  }

  async pending(intentId: string) { return { pending: (await this.runtime(intentId)).agent.pending }; }

  async stop(): Promise<void> {
    const runtimes = await Promise.allSettled([...this.runtimes.values()]);
    await Promise.allSettled(runtimes.map(async (result) => {
      if (result.status !== 'fulfilled') return;
      result.value.controller.abort();
      await result.value.agent.closed;
      await result.value.flushing;
    }));
  }
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const negotiator = new Negotiator(
  new IndexClient(required('INDEX_API_ORIGIN'), required('INDEX_SESSION_TOKEN'), required('INDEX_EXECUTOR_ID')),
  bridge, required('INDEX_STATE_DIR'),
);
const json = (body: unknown, status = 200) => Response.json(body, { status });
const server = Bun.serve({
  hostname: '127.0.0.1', port: 0, idleTimeout: 0,
  fetch: async (request) => {
    if (request.headers.get('authorization') !== `Bearer ${bridge.token}`) return json({ error: 'The Index bridge token is required.' }, 401);
    const { pathname } = new URL(request.url);
    let body: Record<string, unknown>;
    try { body = await request.json() as Record<string, unknown>; }
    catch { return json({ error: 'The request body must be an object.' }, 400); }
    try {
      switch (pathname) {
        case '/wake':
          await negotiator.wake(String(body.intentId), body.activation as IntentActivation | undefined);
          return json({ ok: true });
        case '/input':
          await negotiator.input(String(body.intentId), String(body.inputId));
          return json({ ok: true });
        case '/pending': return json(await negotiator.pending(String(body.intentId)));
        case '/tool': return json(await negotiator.tool(String(body.callId), String(body.name), body.args));
        case '/shutdown': queueMicrotask(() => void shutdown()); return json({ ok: true });
        default: return json({ error: 'Unknown negotiator route.' }, 404);
      }
    } catch (error: unknown) { return json({ error: String(error) }, 502); }
  },
});
async function shutdown(): Promise<void> {
  await negotiator.stop();
  await server.stop();
  process.exit(0);
}
process.on('SIGTERM', () => void shutdown());
process.on('SIGINT', () => void shutdown());
const supervisor = Number(process.env.INDEX_SUPERVISOR_PID ?? '');
if (Number.isInteger(supervisor) && supervisor > 0) {
  setInterval(() => {
    try { process.kill(supervisor, 0); }
    catch { void shutdown(); }
  }, 2000).unref();
}
console.log(JSON.stringify({ ready: true, port: server.port }));
