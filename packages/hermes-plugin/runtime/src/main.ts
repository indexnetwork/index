import { join } from 'node:path';

import { NegotiationAgent, type NegotiationHost, type PrincipalMessage } from '@indexnetwork/agent';

import { IndexClient, type Principal } from './client.ts';
import { HermesModel } from './model.ts';
import { FilePrincipalStore } from './store.ts';

interface Bridge {
  url: string;
  token: string;
}

interface IntentRuntime {
  agent: NegotiationAgent;
  store: FilePrincipalStore;
  /** Short signal label for the Hermes session tile. */
  title: string;
  /** Serializes delivery so one H2A entry cannot be sent twice concurrently. */
  flushing: Promise<void>;
}

const ACTIONS: Record<string, string> = {
  propose: 'Proposed',
  counter: 'Countered',
  accept: 'Accepted',
  decline: 'Declined',
};

/** @param payload - The signal statement. @returns A session-tile label. */
function signalTitle(payload: string): string {
  const line = payload.trim().replace(/\s+/g, ' ');
  return line.length > 80 ? `${line.slice(0, 79)}…` : line || 'Index signal';
}

/** Structured lines on stderr; the Hermes plugin relays them into its own log. */
function log(level: 'info' | 'warn', event: string, detail: Record<string, unknown> = {}): void {
  process.stderr.write(`${JSON.stringify({ level, event, ...detail })}\n`);
}

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

/**
 * The Index negotiator running inside Hermes.
 *
 * This owns no negotiation logic: it wires the same `NegotiationAgent` the
 * hosted API runs to Hermes's model, this machine's checkpoint files, and the
 * Index REST protocol. One agent per signal, created on the first event for it.
 */
class Negotiator {
  private readonly runtimes = new Map<string, Promise<IntentRuntime>>();
  private principal?: Promise<{ principal: Principal; guidance: string }>;

  constructor(
    private readonly client: IndexClient,
    private readonly model: HermesModel,
    private readonly bridge: Bridge,
    private readonly stateDirectory: string,
  ) {}

  private context(): Promise<{ principal: Principal; guidance: string }> {
    return this.principal ??= (async () => {
      const [principal, guidance] = await Promise.all([this.client.principal(), this.client.guidance()]);
      return { principal, guidance };
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
      // A signal that could not start must be retried by the next event for it.
      pending.catch(() => this.runtimes.delete(intentId));
    }
    return pending;
  }

  private async create(intentId: string): Promise<IntentRuntime> {
    const { principal: { owner, principalContext }, guidance } = await this.context();
    const intent = await this.client.intent(intentId);
    const store = new FilePrincipalStore(join(this.stateDirectory, `${owner.id}.${intentId}.json`));
    const runtime = { store, title: signalTitle(intent.payload), flushing: Promise.resolve() } as IntentRuntime;

    const host: NegotiationHost = {
      status: (opportunityId, message) => log('info', 'status', { intentId, opportunityId, message }),
      retry: (_owner, attempt, reason) => log('warn', 'retry', { intentId, attempt, reason }),
      step: () => {},
      conversation: () => this.flush(runtime, intentId),
      turn: (_owner, input, record) => {
        log('info', 'turn', { intentId, opportunityId: record.opportunityId, action: input.action });
        void this.announce(intentId, runtime.title, `${ACTIONS[input.action] ?? input.action} · ${record.counterparty.name || 'Match'}\n${input.message}`);
      },
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
    }, host, { model: this.model, store });

    await runtime.agent.start();
    log('info', 'signal.started', { intentId });
    this.flush(runtime, intentId);
    return runtime;
  }

  /**
   * Reconsider every match of one signal.
   *
   * An event is a hint, not the decision: the agent re-reads each record from
   * the API, so a missed or duplicated wake costs nothing.
   *
   * @param intentId - The signal an Index event moved.
   */
  async wake(intentId: string): Promise<void> {
    const runtime = await this.runtime(intentId);
    const summaries = await this.client.listNegotiations();
    for (const { opportunityId, intentId: owning } of summaries) {
      if (owning !== intentId) continue;
      void runtime.agent.receive({ kind: 'opportunity.matched', opportunityId })
        .catch((error: unknown) => log('warn', 'error', { intentId, opportunityId, reason: String(error) }));
    }
  }

  /** @param intentId - The signal. @param text - The owner's direct message. @returns Whether it was accepted. */
  async message(intentId: string, text: string): Promise<boolean> {
    const runtime = await this.runtime(intentId);
    return Boolean(await runtime.agent.message(text));
  }

  /**
   * @param intentId - The signal. @param questionId - The question shown to the owner.
   * @param text - The owner's answer.
   * @returns Whether it still matched the displayed question.
   */
  async answer(intentId: string, questionId: string, text: string): Promise<boolean> {
    const runtime = await this.runtime(intentId);
    return Boolean(await runtime.agent.answer(questionId, text));
  }

  /** @param intentId - The signal. @returns The question currently shown, and how many wait behind it. */
  async pending(intentId: string): Promise<{ pending: unknown; queuedQuestions: number }> {
    const runtime = await this.runtime(intentId);
    return { pending: runtime.agent.pending, queuedQuestions: runtime.agent.queuedQuestions };
  }

  /** @returns When every signal's agent has stopped and its checkpoint is written. */
  async stop(): Promise<void> {
    const runtimes = await Promise.allSettled([...this.runtimes.values()]);
    await Promise.allSettled(runtimes.map((result) => result.status === 'fulfilled' ? result.value.agent.stop() : undefined));
  }

  /**
   * @param intentId - The signal. @param title - Session tile label. @param text - The submitted turn.
   * @returns When the bridge has accepted or refused the write.
   */
  private async announce(intentId: string, title: string, text: string): Promise<void> {
    try {
      const response = await fetch(`${this.bridge.url}/announce`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ intentId, title, text }),
      });
      if (!response.ok) {
        log('warn', 'announce.failed', { intentId, reason: (await response.text()).slice(0, 300) });
      }
    } catch (error: unknown) {
      log('warn', 'announce.failed', { intentId, reason: String(error) });
    }
  }

  private flush(runtime: IntentRuntime, intentId: string): void {
    runtime.flushing = runtime.flushing
      .then(() => this.deliver(runtime, intentId))
      .catch((error: unknown) => log('warn', 'error', { intentId, reason: `Delivery failed: ${String(error)}` }));
  }

  private async deliver(runtime: IntentRuntime, intentId: string): Promise<void> {
    const displayed = runtime.agent.pending?.id;
    const entries: PrincipalMessage[] = [];
    const retired: string[] = [];
    for (const message of runtime.agent.conversation) {
      if (runtime.store.delivered(message.id)) continue;
      // A question answered or canceled before it was sent is history now, and
      // the owner's own messages need no echo. Only the agent's questions and
      // updates are delivery.
      if (message.kind === 'question' ? message.questionId !== displayed : message.kind !== 'message') {
        retired.push(message.id);
        continue;
      }
      entries.push(message);
    }
    if (retired.length > 0) await runtime.store.markDelivered(retired);
    if (entries.length === 0) return;

    const response = await fetch(`${this.bridge.url}/deliver`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${this.bridge.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ entries: entries.map((message) => ({ intentId, ...message })) }),
    });
    const result = await response.json() as { delivered?: boolean; reason?: string; error?: string };
    if (!response.ok) throw new Error(result.error ?? `Hermes refused delivery (${response.status}).`);
    // An undelivered entry stays undelivered, so a closed owner conversation
    // defers questions instead of losing them.
    if (!result.delivered) {
      log('warn', 'delivery.deferred', { intentId, reason: result.reason });
      return;
    }
    await runtime.store.markDelivered(entries.map(({ id }) => id));
  }
}

const bridge: Bridge = { url: required('INDEX_BRIDGE_URL'), token: required('INDEX_BRIDGE_TOKEN') };
const negotiator = new Negotiator(
  new IndexClient(required('INDEX_API_ORIGIN'), required('INDEX_SESSION_TOKEN'), required('INDEX_EXECUTOR_ID')),
  new HermesModel(bridge),
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
    let body: Record<string, string>;
    try {
      body = await request.json() as Record<string, string>;
    } catch {
      return json({ error: 'The request body must be an object.' }, 400);
    }
    try {
      switch (pathname) {
        case '/wake':
          await negotiator.wake(body.intentId!);
          return json({ ok: true });
        case '/message':
          return json({ accepted: await negotiator.message(body.intentId!, body.text!) });
        case '/answer':
          return json({ accepted: await negotiator.answer(body.intentId!, body.questionId!, body.text!) });
        case '/pending':
          return json(await negotiator.pending(body.intentId!));
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

// The readiness handshake: the plugin reads this line to learn the control port.
console.log(JSON.stringify({ ready: true, port: server.port }));
