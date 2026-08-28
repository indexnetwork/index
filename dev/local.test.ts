import { describe, expect, test } from "bun:test";
import { Negotiator, type NegotiationDecision, type NegotiationState } from "@indexnetwork/negotiator";

import { Agent } from "../src/core/agent.ts";
import { runLocally } from "./local.ts";

function scripted(decisions: NegotiationDecision[]): Negotiator {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  let call = 0;
  (negotiator as unknown as { decide: unknown }).decide = async (_state: NegotiationState) => {
    const decision = decisions[call] ?? decisions.at(-1);
    call++;
    if (!decision) throw new Error("no scripted decision left");
    return decision;
  };
  return negotiator;
}

describe("runLocally", () => {
  test("drives both sides and reports turns in order", async () => {
    const buyer = new Agent({
      identity: { name: "Buyer", id: "did:example:buyer" },
      systemPrompt: "Buy the bike under $450",
      apiKey: "test-key",
      negotiator: scripted([
        { action: "propose", message: "$400?" },
        { action: "counter", message: "$420?" },
      ]),
    });

    const seller = new Agent({
      identity: { name: "Seller", id: "did:example:seller" },
      systemPrompt: "Sell the bike above $400",
      apiKey: "test-key",
      negotiator: scripted([
        { action: "counter", message: "$450." },
        { action: "accept", message: "$420 works." },
      ]),
    });

    const seen: [string, string][] = [];
    const negotiation = await runLocally(buyer, seller, {
      onTurn: (speaker, turn) => seen.push([speaker, turn.decision.action]),
    });

    expect(seen).toEqual([
      ["Buyer", "propose"],
      ["Seller", "counter"],
      ["Buyer", "counter"],
      ["Seller", "accept"],
    ]);
    expect(negotiation.end).toBe("terminal");
    expect(negotiation.state).toBe("completed");
  });

  test("honours maxTurns", async () => {
    const buyer = new Agent({
      identity: { name: "Buyer", id: "did:example:buyer" },
      systemPrompt: "Buy low",
      apiKey: "test-key",
      negotiator: scripted([{ action: "counter", message: "Lower?" }]),
    });
    const seller = new Agent({
      identity: { name: "Seller", id: "did:example:seller" },
      systemPrompt: "Sell high",
      apiKey: "test-key",
      negotiator: scripted([{ action: "counter", message: "Higher." }]),
    });

    const negotiation = await runLocally(buyer, seller, { maxTurns: 2 });

    expect(negotiation.end).toBe("max-turns");
    expect(negotiation.transcript).toHaveLength(4);
  });
});
