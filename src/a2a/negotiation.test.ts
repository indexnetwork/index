import { describe, expect, test } from "bun:test";
import { Negotiator } from "../core/negotiator.ts";
import type { NegotiationDecision, NegotiationState } from "../core/types.ts";
import { A2ANegotiationClient } from "./client/negotiation-client.ts";
import { sendA2AMessage } from "./client/transport.ts";
import { createA2AHandler } from "./server/handler.ts";
import { decisionToMessage } from "./wire/history.ts";
import type { AgentCard } from "./wire/types.ts";

/** A Negotiator whose decide() is scripted instead of hitting OpenRouter. */
function scriptedNegotiator(decisions: NegotiationDecision[]) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: NegotiationState[] = [];
  let call = 0;
  (negotiator as unknown as { decide: unknown }).decide = async (state: NegotiationState) => {
    calls.push(state);
    const decision = decisions[call] ?? decisions.at(-1);
    call++;
    if (!decision) throw new Error("no scripted decision left");
    return decision;
  };
  return { negotiator, calls };
}

function agentCard(name: string): AgentCard {
  return {
    name,
    url: "http://example.invalid",
    version: "1.0.0",
    capabilities: {},
    skills: [{ id: "negotiate", name: "Negotiate" }],
  };
}

describe("A2A client/server over real HTTP", () => {
  test("initiate() and continue() drive a full negotiation to completion", async () => {
    const server = scriptedNegotiator([
      { action: "counter", message: "I need at least $450." },
      { action: "accept", message: "Deal at $420." },
    ]);
    const client = scriptedNegotiator([
      { action: "propose", message: "I'll offer $400." },
      { action: "counter", message: "I can do $420." },
    ]);

    const handler = createA2AHandler({
      negotiator: server.negotiator,
      party: { name: "Seller", objective: "Sell high" },
      allowedActions: ["propose", "counter", "accept", "reject"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    const url = httpServer.url.toString();

    try {
      const a2aClient = new A2ANegotiationClient({
        negotiator: client.negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "counter", "accept", "reject"],
      });

      const first = await a2aClient.initiate(url);
      expect(first.decision).toEqual({ action: "propose", message: "I'll offer $400." });
      expect(first.task.status.state).toBe("input-required");
      expect(first.task.history).toHaveLength(2);

      const second = await a2aClient.continue(url, first.task);
      expect(second.decision).toEqual({ action: "counter", message: "I can do $420." });
      expect(second.task.status.state).toBe("completed");
      expect(second.task.history).toHaveLength(4);

      // Server's view of history alternates buyer/seller turns correctly.
      expect(server.calls[1]?.history).toEqual([
        { role: "incoming", content: "I'll offer $400." },
        { role: "outgoing", content: "I need at least $450." },
        { role: "incoming", content: "I can do $420." },
      ]);
    } finally {
      httpServer.stop();
    }
  });

  test("serves the agent card at /.well-known/agent-card.json", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "hi" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const response = await fetch(new URL("/.well-known/agent-card.json", httpServer.url));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual(agentCard("Seller"));
    } finally {
      httpServer.stop();
    }
  });

  test("returns a JSON-RPC error for an unknown taskId", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "hi" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const message = decisionToMessage(
        { action: "counter", message: "..." },
        "user",
        { taskId: "does-not-exist" },
      );

      await expect(sendA2AMessage(httpServer.url.toString(), message)).rejects.toThrow(
        /Unknown task/,
      );
    } finally {
      httpServer.stop();
    }
  });
});
