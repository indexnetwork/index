import { describe, expect, test } from "bun:test";
import { Negotiator } from "../core/negotiator.ts";
import type { NegotiationDecision, NegotiationState } from "../core/types.ts";
import { A2ANegotiationClient } from "./client/negotiation-client.ts";
import { fetchAgentCard, sendA2AMessage } from "./client/transport.ts";
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

  test("fetchAgentCard() retrieves the card from a base URL", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "hi" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const card = await fetchAgentCard(httpServer.url.toString());
      expect(card).toEqual(agentCard("Seller"));
    } finally {
      httpServer.stop();
    }
  });

  test("server evaluate() attaches an artifact to the task, custom strategy overrides decide()", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "unused" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "counter"],
      agentCard: agentCard("Seller"),
      strategy: async () => ({ action: "counter", message: "from custom strategy" }),
      evaluate: (_task, decision) => ({
        artifactId: "eval-1",
        name: "turn-evaluation",
        parts: [{ kind: "data", data: { sawAction: decision.action } }],
      }),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "hi" }]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "counter"],
      });

      const { task, decision } = await client.initiate(httpServer.url.toString());
      // The server's custom strategy decided, not the default negotiator.decide().
      const sellerReply = task.history.at(-1)!;
      expect((sellerReply.parts[0]?.data as { message: string }).message).toBe(
        "from custom strategy",
      );
      expect(decision.action).toBe("propose"); // client's own decision, unaffected

      expect(task.artifacts).toEqual([
        {
          artifactId: "eval-1",
          name: "turn-evaluation",
          parts: [{ kind: "data", data: { sawAction: "counter" } }],
        },
      ]);
    } finally {
      httpServer.stop();
    }
  });

  test("client evaluate() returns an artifact on the turn result without touching the server's task", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "hi" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "opening offer" }]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose"],
        evaluate: (_task, decision) => ({
          artifactId: "client-eval",
          parts: [{ kind: "text", text: `client saw ${decision.action}` }],
        }),
      });

      const { task, artifact } = await client.initiate(httpServer.url.toString());
      expect(artifact).toEqual({
        artifactId: "client-eval",
        parts: [{ kind: "text", text: "client saw propose" }],
      });
      // Server's task is untouched by the client's local evaluation.
      expect(task.artifacts).toEqual([]);
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
