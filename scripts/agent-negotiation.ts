#!/usr/bin/env bun
/** Standalone REST host. No API-server or database imports. */
import { createInterface } from 'node:readline/promises';

import { createSeat, runNegotiation, type Intent, type Negotiation, type NegotiationClient, type NegotiationHost, type TurnInput, type User } from './agent-negotiation.session';

/** Index transport belongs to this host, never to the agent library. */
class IndexClient implements NegotiationClient {
  constructor(private readonly origin: string, private readonly apiKey: string) {}

  /** @returns The authenticated owner, whose identity cannot be supplied by the model. */
  async me(): Promise<User> {
    return (await this.request<{ user: User }>('/auth/me')).user;
  }

  /** @returns The caller's own intent, including its statement. */
  async readIntent(id: string): Promise<Intent> {
    return (await this.request<{ intent: Intent }>(`/intents/${encodeURIComponent(id)}`)).intent;
  }

  /** @returns The negotiation and authoritative turn log as this owner sees them. */
  async readNegotiation(id: string): Promise<Negotiation> {
    return (await this.request<{ negotiation: Negotiation }>(`/negotiations/${encodeURIComponent(id)}`)).negotiation;
  }

  /**
   * @param id - The single negotiation selected by the operator.
   * @param turn - The agent's decision on behalf of its principal.
   * @returns The server record after the turn.
   * @throws When Index rejects the turn or the request fails. Never retries a POST.
   */
  async submitTurn(id: string, turn: TurnInput): Promise<Negotiation> {
    return (await this.request<{ negotiation: Negotiation }>(`/negotiations/${encodeURIComponent(id)}/turns`, turn)).negotiation;
  }

  private async request<T>(path: string, turn?: TurnInput): Promise<T> {
    const response = await fetch(`${this.origin}/api${path}`, {
      method: turn ? 'POST' : 'GET',
      headers: { 'x-api-key': this.apiKey, 'Content-Type': 'application/json' },
      body: turn ? JSON.stringify(turn) : undefined,
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) {
      throw new Error(`Index ${response.status}: ${await response.text()}`);
    }
    return await response.json() as T;
  }
}

const USAGE = `Usage: bun run agent:negotiate <opportunity-id> <instructions-file> <counterparty-instructions-file>

Required environment: INDEX_API_KEY, INDEX_COUNTERPARTY_API_KEY, OPENROUTER_API_KEY
INDEX_API_URL defaults to http://localhost:3001 (origin only, without /api).

Runs both principals' agents, following Index's turn order without per-turn approval.
Each instructions file belongs to the corresponding key's owner and stays private
from the other agent. Only principal questions need terminal input; without a TTY,
a question stops the session unanswered. Empty answers also stop, without a reply.
Stops on settlement, a failure/no progress, or a 12-turn safety limit. No SSE,
background scheduling, DMs, or restart state. Never give either key to a model.
`;

function showState(record: Negotiation, owners: User[]): void {
  const name = (id: string | null) => owners.find((owner) => owner.id === id)?.name ?? id;
  console.log(`Status: ${record.outcome ?? 'open'}; recorded turns: ${record.turnCount}; waiting on: ${name(record.awaitingUserId) ?? 'nobody'}`);
  for (const turn of record.turns) {
    console.log(`\n${turn.turnIndex + 1}. ${name(turn.seatUserId)} [${turn.action}]\n${turn.message}`);
  }
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === '--help') {
    console.log(USAGE);
    return;
  }
  const [opportunityId, instructionsPath, counterpartyInstructionsPath] = args;
  if (args.length !== 3 || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(opportunityId)) {
    throw new Error(USAGE);
  }
  const origin = new URL(process.env.INDEX_API_URL ?? 'http://localhost:3001');
  if (!['http:', 'https:'].includes(origin.protocol) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('INDEX_API_URL must be an HTTP(S) origin without credentials, a path, query, or fragment.');
  }
  const participants = [];
  for (const [env, path] of [['INDEX_API_KEY', instructionsPath], ['INDEX_COUNTERPARTY_API_KEY', counterpartyInstructionsPath]]) {
    const apiKey = process.env[env];
    if (!apiKey) throw new Error(`${env} is required. Supply separate keys for the two principals.`);
    const instructions = (await Bun.file(path).text()).trim();
    if (!instructions) throw new Error(`${path} is empty. Supply that principal’s preferences and limits.`);
    const client = new IndexClient(origin.origin, apiKey);
    const owner = await client.me();
    const initial = await client.readNegotiation(opportunityId);
    const intent = await client.readIntent(initial.intentId);
    participants.push({ owner, initial, intent, instructions, client });
  }
  const [first, second] = participants;
  if (first.owner.id === second.owner.id || first.initial.counterparty.userId !== second.owner.id || second.initial.counterparty.userId !== first.owner.id) {
    throw new Error('The keys must represent the two distinct principals in this negotiation.');
  }
  const owners = participants.map(({ owner }) => owner);
  console.log(`Index: ${origin.origin}\nPrincipals: ${owners.map((owner) => owner.name ?? owner.id).join(' and ')}`);
  const record = await first.client.readNegotiation(opportunityId);
  showState(record, owners);
  if (record.settledAt) {
    console.log('No run: the negotiation is already settled.');
    return;
  }
  if (!process.env.OPENROUTER_API_KEY) throw new Error('OPENROUTER_API_KEY is required to run the agents.');
  const terminal = process.stdin.isTTY ? createInterface({ input: process.stdin, output: process.stdout }) : undefined;
  const controller = new AbortController();
  const host: NegotiationHost = {
    status: (message) => console.log(`\n${message}`),
    turn: (owner, input, result) => {
      console.log(`\n${owner.name ?? owner.id} [${input.action}]: ${input.message}`);
      console.log(`Recorded by Index; turnCount=${result.turnCount}, outcome=${result.outcome ?? 'open'}`);
    },
    retry: (owner, attempt, reason) => console.error(`${owner.name ?? owner.id}: model retry ${attempt}: ${reason}`),
    step: (_owner, step) => {
      if (step.kind === 'tool') console.log(`Tool ${step.name}: ${step.error ?? 'completed'}`);
    },
    ask: async (owner, question) => {
      console.log(`\nQuestion for ${owner.name ?? owner.id}: ${question.question}`);
      if (question.options) console.log(question.options.join('\n'));
      if (!terminal) {
        console.log('Paused unanswered: use an interactive terminal to answer principal questions.');
        return null;
      }
      const answer = await terminal.question('Principal answer (empty to stop): ');
      if (!answer.trim()) console.log('Stopped with the principal question unanswered. No reply was invented.');
      return answer;
    },
    output: (_owner, result) => console.log(`Agent ended: ${result.end}\n${result.output}`),
  };
  try {
    await runNegotiation(participants.map((participant) => createSeat(participant, opportunityId, host)), opportunityId, host, controller.signal);
  } finally {
    controller.abort();
    terminal?.close();
    console.log('\nFresh Index transcript:');
    showState(await first.client.readNegotiation(opportunityId), owners);
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
