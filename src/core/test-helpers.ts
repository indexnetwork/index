// Fixtures shared by the test files. Not a `.test.ts`, so `bun test` doesn't
// collect it as a suite, and excluded from the build so no `.d.ts` is emitted.
import {
  Negotiator,
  type DecideOptions,
  type NegotiationDecision,
  type NegotiationState,
} from "@indexnetwork/a2a/negotiator";

import type { Agent } from "./agent.ts";
import type { ModelMessage, ToolCall } from "./model.ts";
import { negotiationTools, type Tool } from "./tools.ts";

export interface RecordedCall {
  state: NegotiationState;
  options: DecideOptions<string>;
}

/** A Negotiator whose decide() replays a script instead of calling
 * OpenRouter, recording both the state and the options each call was
 * handed. The last decision repeats once the script runs out. */
export function scripted(decisions: NegotiationDecision[]) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: RecordedCall[] = [];
  let call = 0;

  (negotiator as unknown as { decide: unknown }).decide = async (
    state: NegotiationState,
    options: DecideOptions<string>,
  ) => {
    // `options.signal` is the incoming request's AbortSignal, which
    // structuredClone cannot clone (DataCloneError) — record everything
    // else about the call.
    const { signal: _signal, ...clonable } = options;
    calls.push({ state: structuredClone(state), options: structuredClone(clonable) as DecideOptions<string> });
    const decision = decisions[call] ?? decisions.at(-1);
    call++;
    if (!decision) throw new Error("no scripted decision left");
    return decision;
  };

  return { negotiator, calls };
}

/** One script per negotiation, for an agent running several at once.
 *
 * Several negotiations pumped concurrently by one Negotiator interleave
 * their decide() calls, so a single sequential script can't tell them
 * apart, and the history length can't either — two negotiations parked at
 * the same point and resumed together see the same length. What does stay
 * stable per session is the negotiation's own objective: `objectiveFor`
 * always renders it as "...In this negotiation: <objective>", untouched by
 * whatever guidance gets appended after it. So key each call on that
 * `<objective>` tag and give each session its own sequential index. */
export function scriptedBySession(scripts: Record<string, NegotiationDecision[]>) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: RecordedCall[] = [];
  const counts = new Map<string, number>();

  (negotiator as unknown as { decide: unknown }).decide = async (
    state: NegotiationState,
    options: DecideOptions<string>,
  ) => {
    const { signal: _signal, ...clonable } = options;
    calls.push({ state: structuredClone(state), options: structuredClone(clonable) as DecideOptions<string> });
    const key = /In this negotiation: (\S+)/.exec(state.party.objective)?.[1];
    const decisions = (key && scripts[key]) || [];
    const index = counts.get(key ?? "") ?? 0;
    counts.set(key ?? "", index + 1);
    const decision = decisions[index] ?? decisions.at(-1);
    if (!decision) throw new Error(`no scripted decision left for "${key}"`);
    return decision;
  };

  return { negotiator, calls };
}

export const seller = {
  identity: { name: "Seller", id: "did:example:alice" },
  systemPrompt: "Sell the bike for as much as possible",
  apiKey: "test-key",
};
export const buyer = {
  identity: { name: "Buyer", id: "did:example:bob" },
  systemPrompt: "Buy the bike for as little as possible",
  apiKey: "test-key",
};

/** Serves an Agent on an ephemeral port and hands back its base URL. */
export function serve<A extends string>(agent: Agent<A>) {
  const server = Bun.serve({ port: 0, fetch: agent.handler() });
  return { url: server.url.toString(), stop: () => server.stop(true) };
}

/** A counterparty that accepts the connection and never answers — the
 * failure that used to park the caller with no way out. */
export function silent() {
  const server = Bun.serve({
    port: 0,
    fetch: () => new Promise<Response>(() => {}),
  });
  return { url: server.url.toString(), stop: () => server.stop(true) };
}

const originalFetch = globalThis.fetch;

/** Puts the real fetch back. Each file that uses `mockModel` registers
 * `afterEach(restoreFetch)` itself — a cached module would register it once,
 * for whichever file imported first. */
export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

/**
 * Intercepts only OpenRouter chat calls and replays scripted assistant
 * messages, or whole responses when an entry is a function. Everything
 * else — the A2A traffic between agents on real local ports — is passed
 * through to the original fetch. Returns the request bodies it saw.
 */
export function mockModel(
  replies: (Partial<ModelMessage> | ((init?: RequestInit) => Response | Promise<Response>))[],
) {
  const requests: { model: string; messages: ModelMessage[]; tools?: unknown[] }[] = [];
  let call = 0;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input);
    if (!url.startsWith("https://openrouter.ai")) {
      return (originalFetch as (i: unknown, x?: RequestInit) => Promise<Response>)(input, init);
    }

    requests.push(JSON.parse(String(init?.body)));
    const reply = replies[call] ?? replies.at(-1);
    call++;
    if (typeof reply === "function") return await reply(init);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), { status: 200 });
  }) as unknown as typeof fetch;

  return requests;
}

export function call(name: string, args: unknown, id = `call_${name}`): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

/** A tool from `negotiationTools()` by name. */
export function tool(name: string) {
  const found = negotiationTools().find((t) => t.name === name) as Tool<never> | undefined;
  if (!found?.run) throw new Error(`no tool ${name}`);
  return found;
}
