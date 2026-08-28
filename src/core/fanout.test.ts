import { describe, expect, test } from "bun:test";
import {
  Negotiator,
  type DecideOptions,
  type NegotiationDecision,
  type NegotiationState,
} from "@indexnetwork/negotiator";

import { Agent } from "./agent.ts";
import type { NegotiationSession } from "./types.ts";

/** A Negotiator whose decide() replays a script, recording both the
 * state and the options each call was handed. */
export function scripted(decisions: NegotiationDecision[]) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: { state: NegotiationState; options: DecideOptions<string> }[] = [];
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

export function serve<A extends string>(agent: Agent<A>) {
  const server = Bun.serve({ port: 0, fetch: agent.handler() });
  return { url: server.url.toString(), stop: () => server.stop(true) };
}

describe("runNegotiation()", () => {
  test("pumps turns to a settlement and reports one event", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "I need $450.", terms: { amount: 450 } },
          { action: "accept", message: "Deal at $420.", acceptsOfferId: "offer-420" },
        ]).negotiator,
      }),
    );
    try {
      const client = scripted([
        { action: "propose", message: "I'll offer $400.", terms: { amount: 400 } },
        { action: "counter", message: "I can do $420.", offerId: "offer-420", terms: { amount: 420 } },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      const event = await agent.runNegotiation(url, { objective: "buy it" }, { negotiations });

      expect(event.kind).toBe("settled");
      if (event.kind !== "settled") return;
      expect(event.state).toBe("completed");
      expect(event.peer).toBe("Seller");
      expect(event.turns).toBe(2);
      expect(event.settlement?.outcome).toBe("agreed");
      // The whole exchange ran inside one call.
      expect(client.calls).toHaveLength(2);
      expect(negotiations.get(event.id)?.task.history).toHaveLength(4);
    } finally {
      stop();
    }
  });

  test("stops at maxTurns with a budget event carrying their last offer", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "Still $450." }]).negotiator,
      }),
    );
    try {
      const agent = new Agent({
        ...buyer,
        maxTurns: 2,
        negotiator: scripted([{ action: "counter", message: "$400." }]).negotiator,
      });
      const event = await agent.runNegotiation(url, {}, { negotiations: new Map() });

      expect(event.kind).toBe("budget");
      if (event.kind !== "budget") return;
      expect(event.turns).toBe(2);
      expect(event.last).toEqual({ action: "counter", message: "Still $450." });
    } finally {
      stop();
    }
  });

  test("a counterparty that cannot be reached is a failed event, not a throw", async () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });
    const event = await agent.runNegotiation("http://127.0.0.1:1", {}, { negotiations: new Map() });

    expect(event.kind).toBe("failed");
    if (event.kind !== "failed") return;
    expect(event.id).toStartWith("local:");
    expect(event.error).not.toBe("");
  });
});
