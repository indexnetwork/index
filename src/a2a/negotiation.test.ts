import { describe, expect, test } from "bun:test";
import { Negotiator } from "../core/negotiator.ts";
import type { NegotiationDecision, NegotiationState } from "../core/types.ts";
import { bearerCredentials } from "./client/auth.ts";
import { A2ANegotiationClient } from "./client/negotiation-client.ts";
import { fetchAgentCard, sendA2AMessage } from "./client/transport.ts";
import { bearerTokenAuth } from "./server/auth.ts";
import { createA2AHandler, OUTCOME_ARTIFACT_ID } from "./server/handler.ts";
import { TaskStore } from "./server/task-store.ts";
import { verifyAgreement } from "./wire/agreement.ts";
import { defaultStrategy } from "./wire/strategy.ts";
import { decisionToMessage } from "./wire/history.ts";
import { isTerminalTaskState } from "./wire/types.ts";
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

  test("rejects message/send with no/wrong bearer token when authenticate is set", async () => {
    const { negotiator } = scriptedNegotiator([{ action: "propose", message: "hi" }]);
    const handler = createA2AHandler({
      negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose"],
      agentCard: agentCard("Seller"),
      authenticate: bearerTokenAuth("secret-token"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const message = decisionToMessage({ action: "propose", message: "hi" }, "user", {});

      await expect(sendA2AMessage(httpServer.url.toString(), message)).rejects.toThrow(
        /401/,
      );
      await expect(
        sendA2AMessage(httpServer.url.toString(), message, bearerCredentials("wrong-token")),
      ).rejects.toThrow(/401/);

      // The public AgentCard stays reachable without credentials.
      const card = await fetchAgentCard(httpServer.url.toString());
      expect(card).toEqual(agentCard("Seller"));
    } finally {
      httpServer.stop();
    }
  });

  test("outcome reports the server-stamped task state, not this side's own action", async () => {
    // The counterparty rejects in the same round trip in which we accept.
    // Reading our own decision.action would tell this side there's a deal.
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([{ action: "reject", message: "Sold to someone else." }])
        .negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "accept", "reject"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "accept", message: "Deal!" }]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "accept", "reject"],
      });

      const { outcome, decision, task } = await client.initiate(httpServer.url.toString());
      expect(decision.action).toBe("accept");
      expect(outcome).toBe("rejected");
      expect(outcome).toBe(task.status.state);
      expect(verifyAgreement(task).status).toBe("declined");
    } finally {
      httpServer.stop();
    }
  });

  test("verifyAgreement() flags two accepts that name different terms", async () => {
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([
        { action: "counter", message: "Lowest is $460.", terms: { amount: 460 }, offerId: "o1" },
        { action: "accept", message: "Deal — $450 it is.", terms: { amount: 450 } },
      ]).negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "counter", "accept"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([
          { action: "propose", message: "I offer $430.", terms: { amount: 430 }, offerId: "o0" },
          { action: "accept", message: "Deal at $460.", terms: { amount: 460 }, acceptsOfferId: "o1" },
        ]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "counter", "accept"],
      });

      let result = await client.initiate(httpServer.url.toString());
      result = await client.continue(httpServer.url.toString(), result.task);

      // The task completes — but the two sides bound to different numbers.
      expect(result.outcome).toBe("completed");
      expect(verifyAgreement(result.task).status).toBe("conflict");
    } finally {
      httpServer.stop();
    }
  });

  test("verifyAgreement() confirms terms when the closing move names the offer it accepts", async () => {
    const OFFER = "offer-450";
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([
        {
          action: "accept",
          message: "Confirmed.",
          terms: { amount: 450, pickupDay: "Wed" },
          acceptsOfferId: OFFER,
        },
      ]).negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "accept"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([
          {
            action: "propose",
            message: "$450, pickup Wednesday?",
            terms: { amount: 450, pickupDay: "Wed" },
            offerId: OFFER,
          },
        ]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "accept"],
      });

      const { task, outcome } = await client.initiate(httpServer.url.toString());
      expect(outcome).toBe("completed");
      expect(verifyAgreement(task)).toEqual({
        status: "agreed",
        basis: "reference",
        terms: { amount: 450, pickupDay: "Wed" },
      });

      // The settled terms are recorded on the Task as an artifact, which is
      // where the spec puts results.
      const outcomeArtifact = task.artifacts.find((a) => a.artifactId === OUTCOME_ARTIFACT_ID);
      expect(outcomeArtifact?.parts[0]?.data).toEqual({
        state: "completed",
        status: "agreed",
        basis: "reference",
        terms: { amount: 450, pickupDay: "Wed" },
      });
    } finally {
      httpServer.stop();
    }
  });

  test("verifyAgreement() reports unconfirmed for a prose-only completion", async () => {
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([{ action: "accept", message: "Deal at $450." }]).negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "accept"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "I offer $450." }]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "accept"],
      });

      const { task } = await client.initiate(httpServer.url.toString());
      expect(verifyAgreement(task).status).toBe("unconfirmed");
    } finally {
      httpServer.stop();
    }
  });

  test("both sides reach the same verdict from the same task, regardless of who spoke last", async () => {
    const OFFER = "offer-500";
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([
        { action: "accept", message: "Agreed.", acceptsOfferId: OFFER },
      ]).negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "accept"],
      agentCard: agentCard("Seller"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([
          { action: "propose", message: "$500?", terms: { amount: 500 }, offerId: OFFER },
        ]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "accept"],
      });

      const { task } = await client.initiate(httpServer.url.toString());

      // Client's view and the server's stored view are the same Task, so the
      // verdict doesn't depend on which side asks.
      const fromClient = verifyAgreement(task);
      const fromServer = verifyAgreement(structuredClone(task));
      expect(fromClient).toEqual(fromServer);
      expect(fromClient).toEqual({ status: "agreed", basis: "reference", terms: { amount: 500 } });
    } finally {
      httpServer.stop();
    }
  });

  test("admits message/send with the correct bearer token, end to end via A2ANegotiationClient", async () => {
    const server = scriptedNegotiator([{ action: "accept", message: "Deal." }]);
    const handler = createA2AHandler({
      negotiator: server.negotiator,
      party: { name: "Seller", objective: "Sell" },
      allowedActions: ["propose", "accept"],
      agentCard: agentCard("Seller"),
      authenticate: bearerTokenAuth("secret-token"),
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "hi" }]).negotiator,
        party: { name: "Buyer", objective: "Buy" },
        allowedActions: ["propose", "accept"],
        credentials: bearerCredentials("secret-token"),
      });

      const { task } = await client.initiate(httpServer.url.toString());
      expect(task.status.state).toBe("completed");
    } finally {
      httpServer.stop();
    }
  });
});

describe("A2A deadlines", () => {
  /** A server that accepts the connection and then never answers — the
   * failure that used to park an initiator forever. */
  function silentServer() {
    return Bun.serve({ port: 0, fetch: () => new Promise<Response>(() => {}) });
  }

  const message = decisionToMessage({ action: "propose", message: "hi" }, "user", {});

  test("sendA2AMessage() gives up on a counterparty that never replies", async () => {
    const httpServer = silentServer();
    try {
      await expect(
        sendA2AMessage(httpServer.url.toString(), message, undefined, { timeoutMs: 50 }),
      ).rejects.toThrow(/A2A message\/send to .* timed out after 50ms/);
    } finally {
      httpServer.stop(true);
    }
  });

  test("sendA2AMessage() honours a caller's signal and reports it as theirs", async () => {
    const httpServer = silentServer();
    const controller = new AbortController();
    try {
      const pending = sendA2AMessage(httpServer.url.toString(), message, undefined, {
        signal: controller.signal,
      });
      controller.abort(new Error("host gave up"));
      await expect(pending).rejects.toThrow("host gave up");
    } finally {
      httpServer.stop(true);
    }
  });

  test("fetchAgentCard() gives up on an endpoint that never answers", async () => {
    const httpServer = silentServer();
    try {
      await expect(
        fetchAgentCard(httpServer.url.toString(), undefined, { timeoutMs: 50 }),
      ).rejects.toThrow(/Agent card fetch from .* timed out after 50ms/);
    } finally {
      httpServer.stop(true);
    }
  });

  test("a turn's signal reaches the request in flight, not just the loop around it", async () => {
    const httpServer = silentServer();
    const controller = new AbortController();
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "I'll offer $400." }])
          .negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "accept"],
      });

      const pending = client.initiate(httpServer.url.toString(), {
        signal: controller.signal,
      });
      controller.abort(new Error("^C"));
      await expect(pending).rejects.toThrow("^C");
    } finally {
      httpServer.stop(true);
    }
  });

  test("the client's timeoutMs bounds a send when no signal is given", async () => {
    const httpServer = silentServer();
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "hi" }]).negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "accept"],
        timeoutMs: 50,
      });

      await expect(client.initiate(httpServer.url.toString())).rejects.toThrow(
        /timed out after 50ms/,
      );
    } finally {
      httpServer.stop(true);
    }
  });

  test("the turn's signal reaches the strategy, so this side's model call is bounded too", async () => {
    const httpServer = silentServer();
    const controller = new AbortController();
    let strategySignal: AbortSignal | undefined;
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "hi" }]).negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "accept"],
        strategy: async (_negotiator, _state, _allowedActions, options) => {
          strategySignal = options?.signal;
          return { action: "propose", message: "hi" };
        },
      });

      const pending = client.initiate(httpServer.url.toString(), {
        signal: controller.signal,
      });
      controller.abort(new Error("^C"));
      await expect(pending).rejects.toThrow("^C");
      expect(strategySignal).toBe(controller.signal);
    } finally {
      httpServer.stop(true);
    }
  });

  test("an exported strategy is still callable with three arguments", async () => {
    // `defaultStrategy`/`strategyWithTerms` are public API, so a caller
    // composing on top of one must still be able to invoke it the way it
    // was invocable before `options` existed. This is really a
    // compile-time assertion — `bun run typecheck` covers this file — and
    // it fails to build if `options` ever stops being optional.
    const { negotiator } = scriptedNegotiator([{ action: "accept", message: "ok" }]);
    const state: NegotiationState = {
      party: { name: "Seller", objective: "Sell high" },
      history: [],
    };

    const decision = await defaultStrategy(negotiator, state, ["accept", "reject"]);

    expect(decision).toEqual({ action: "accept", message: "ok" });
  });

  test("the handler hands the request's signal to its strategy", async () => {
    let strategySignal: AbortSignal | undefined;
    const handler = createA2AHandler({
      negotiator: scriptedNegotiator([{ action: "accept", message: "ok" }]).negotiator,
      party: { name: "Seller", objective: "Sell high" },
      allowedActions: ["accept", "reject"],
      agentCard: agentCard("Seller"),
      strategy: async (_negotiator, _state, _allowedActions, options) => {
        strategySignal = options?.signal;
        return { action: "accept", message: "ok" };
      },
    });

    const httpServer = Bun.serve({ port: 0, fetch: handler });
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "propose", message: "hi" }]).negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "accept"],
      });
      await client.initiate(httpServer.url.toString());

      // A caller that hangs up mid-turn should stop the server's own model
      // call: the reply it would produce has nowhere left to go.
      expect(strategySignal).toBeInstanceOf(AbortSignal);
    } finally {
      httpServer.stop(true);
    }
  });
});


describe("a settled task stays settled", () => {
  const offer = { amount: 460, currency: "USD" };

  /** A handler that has already closed a deal, plus the task it closed and
   * the store holding the server's own copy of it — the client's copy came
   * over the wire and can't tell us whether the server's record moved. */
  async function settledTask() {
    const taskStore = new TaskStore();
    const handler = createA2AHandler({
      taskStore,
      negotiator: scriptedNegotiator([
        { action: "accept", message: "Deal at $460.", terms: offer, offerId: "srv-1" },
        // Would reopen the haggling if it were ever allowed to run.
        { action: "counter", message: "Actually, $500?", terms: { amount: 500 } },
      ]).negotiator,
      party: { name: "Seller", objective: "Sell high" },
      allowedActions: ["propose", "counter", "accept", "reject"],
      agentCard: agentCard("Seller"),
    });
    const httpServer = Bun.serve({ port: 0, fetch: handler });
    const client = new A2ANegotiationClient({
      negotiator: scriptedNegotiator([
        { action: "propose", message: "I'll offer $460.", terms: offer, offerId: "cli-1" },
      ]).negotiator,
      party: { name: "Buyer", objective: "Buy low" },
      allowedActions: ["propose", "counter", "accept", "reject"],
    });
    const { task, outcome } = await client.initiate(httpServer.url.toString());
    expect(outcome).toBe("completed");
    expect(verifyAgreement(task).status).toBe("agreed");
    return { httpServer, task, taskStore };
  }

  test("the handler refuses a message/send on a finished task", async () => {
    const { httpServer, task } = await settledTask();
    try {
      // Straight down the wire, bypassing the client's own guard — this is
      // a counterparty we don't control, which is the case that matters.
      const message = decisionToMessage({ action: "counter", message: "reopen?" }, "user", {
        taskId: task.id,
        contextId: task.contextId,
      });

      await expect(
        sendA2AMessage(httpServer.url.toString(), message),
      ).rejects.toThrow(/is completed and cannot accept further messages/);
    } finally {
      httpServer.stop(true);
    }
  });

  test("the refused message leaves the server's own record intact", async () => {
    const { httpServer, task, taskStore } = await settledTask();
    try {
      const message = decisionToMessage({ action: "counter", message: "reopen?" }, "user", {
        taskId: task.id,
        contextId: task.contextId,
      });
      await sendA2AMessage(httpServer.url.toString(), message).catch(() => {});

      // The server's copy, not the client's — the client's came over the
      // wire and would look untouched however the server behaved.
      const stored = taskStore.get(task.id);
      expect(stored).toBeDefined();
      expect(stored!.status.state).toBe("completed");
      expect(stored!.history).toHaveLength(2); // the refused message was never appended
      expect(verifyAgreement(stored!)).toMatchObject({ status: "agreed", terms: offer });
    } finally {
      httpServer.stop(true);
    }
  });

  test("the outcome artifact never contradicts the task's own state", async () => {
    const { httpServer, task, taskStore } = await settledTask();
    try {
      const message = decisionToMessage({ action: "counter", message: "reopen?" }, "user", {
        taskId: task.id,
        contextId: task.contextId,
      });
      await sendA2AMessage(httpServer.url.toString(), message).catch(() => {});

      const stored = taskStore.get(task.id)!;
      const outcome = stored.artifacts.find((a) => a.artifactId === OUTCOME_ARTIFACT_ID);
      const data = outcome?.parts[0]?.data as { state: string; status: string };
      expect(data.state).toBe(stored.status.state);
      expect(data.status).toBe("agreed");
    } finally {
      httpServer.stop(true);
    }
  });

  test("continue() refuses a finished task without spending a model call", async () => {
    const { httpServer, task } = await settledTask();
    let decided = false;
    try {
      const client = new A2ANegotiationClient({
        negotiator: scriptedNegotiator([{ action: "counter", message: "reopen?" }]).negotiator,
        party: { name: "Buyer", objective: "Buy low" },
        allowedActions: ["propose", "counter", "accept", "reject"],
        strategy: async () => {
          decided = true;
          return { action: "counter", message: "reopen?" };
        },
      });

      await expect(
        client.continue(httpServer.url.toString(), task),
      ).rejects.toThrow(/already completed/);
      expect(decided).toBe(false);
    } finally {
      httpServer.stop(true);
    }
  });

  test("isTerminalTaskState() names every final state and no in-flight one", () => {
    for (const state of ["completed", "failed", "canceled", "rejected"] as const) {
      expect(isTerminalTaskState(state)).toBe(true);
    }
    for (const state of ["submitted", "working", "input-required"] as const) {
      expect(isTerminalTaskState(state)).toBe(false);
    }
  });
});
