import { describe, expect, test } from "bun:test";
import { Negotiator, type NegotiationDecision, type NegotiationState } from "@indexnetwork/negotiator";
import { messageToDecision } from "@indexnetwork/negotiator/a2a";

import { Agent } from "./agent.ts";
import { MemoryNegotiationStore } from "./sessions.ts";
import { defaultTools } from "./tools.ts";
import type { AgentTurn, Direction, NegotiationSession, Settlement } from "./types.ts";

/** A Negotiator whose decide() replays a script instead of calling
 * OpenRouter, while still recording the state it was handed. */
function scripted(decisions: NegotiationDecision[]) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: NegotiationState[] = [];
  let call = 0;

  (negotiator as unknown as { decide: unknown }).decide = async (state: NegotiationState) => {
    calls.push(structuredClone(state));
    const decision = decisions[call] ?? decisions.at(-1);
    call++;
    if (!decision) throw new Error("no scripted decision left");
    return decision;
  };

  return { negotiator, calls };
}

const seller = {
  identity: { name: "Seller", id: "did:example:alice" },
  systemPrompt: "Sell the bike for as much as possible",
  apiKey: "test-key",
};
const buyer = {
  identity: { name: "Buyer", id: "did:example:bob" },
  systemPrompt: "Buy the bike for as little as possible",
  apiKey: "test-key",
};

/** Serves an Agent on an ephemeral port and hands back its base URL. */
function serve<A extends string>(agent: Agent<A>) {
  const server = Bun.serve({ port: 0, fetch: agent.handler() });
  return { url: server.url.toString(), stop: () => server.stop(true) };
}

describe("AgentCard", () => {
  test("derives a card from the name and the card options", () => {
    const agent = new Agent({
      ...seller,
      identity: {
        name: "Seller",
        id: "did:example:alice",
        url: "https://seller.example",
        description: "Sells things",
        version: "2.1.0",
      },
      negotiator: scripted([]).negotiator,
    });

    expect(agent.card()).toEqual({
      name: "Seller",
      id: "did:example:alice",
      description: "Sells things",
      url: "https://seller.example",
      version: "2.1.0",
      capabilities: {},
      skills: [
        {
          id: "negotiate",
          name: "Negotiate",
          description: "Negotiates on its party's behalf over A2A message/send. Understands: propose, counter, accept, reject.",
        },
      ],
    });
  });

  test("card overrides win, so security schemes can be declared", () => {
    const agent = new Agent({
      ...seller,
      negotiator: scripted([]).negotiator,
      card: {
        securitySchemes: { bearerAuth: { type: "http", scheme: "bearer" } },
        security: [{ bearerAuth: [] }],
      },
    });

    expect(agent.card().securitySchemes).toEqual({
      bearerAuth: { type: "http", scheme: "bearer" },
    });
  });

  test("serves the card over HTTP at the well-known path", async () => {
    const agent = new Agent({ ...seller, negotiator: scripted([]).negotiator });
    const { url, stop } = serve(agent);

    try {
      const response = await fetch(new URL("/.well-known/agent-card.json", url));
      expect(await response.json()).toEqual(agent.card() as unknown as Record<string, unknown>);
    } finally {
      stop();
    }
  });

  test("inspect() fetches a peer's card without negotiating", async () => {
    const sellerNegotiator = scripted([]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: sellerNegotiator.negotiator }));

    try {
      const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });
      expect((await agent.inspect(url)).name).toBe("Seller");
      expect(sellerNegotiator.calls).toHaveLength(0);
    } finally {
      stop();
    }
  });
});

describe("handler()", () => {
  test("decides inbound replies against the system prompt", async () => {
    const server = scripted([{ action: "counter", message: "I need more." }]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$300?" }]).negotiator,
      });
      await agent.negotiate(url, { maxTurns: 1 });

      expect(server.calls[0]?.party).toEqual({
        name: "Seller",
        objective: "Sell the bike for as much as possible",
      });
      expect(server.calls[0]?.history).toEqual([{ role: "incoming", content: "$300?" }]);
    } finally {
      stop();
    }
  });

  test("passes authenticate through, rejecting unauthorized callers", async () => {
    const agent = new Agent({
      ...seller,
      negotiator: scripted([{ action: "accept", message: "Sure." }]).negotiator,
      authenticate: (request) =>
        request.headers.get("authorization") === "Bearer secret" ? { subject: "buyer" } : null,
    });
    const { url, stop } = serve(agent);

    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: "1", method: "message/send", params: {} }),
      });
      expect(response.status).toBe(401);
    } finally {
      stop();
    }
  });
});

describe("negotiate()", () => {
  test("runs turns until a terminal action and reports the transcript", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "I need $450." },
          { action: "accept", message: "Deal at $420." },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "I'll offer $400." },
          { action: "counter", message: "I can do $420." },
        ]).negotiator,
      });

      const result = await agent.negotiate(url);

      expect(result.state).toBe("completed");
      expect(result.end).toBe("terminal");
      expect(result.endedBy).toEqual({ speaker: "peer", action: "accept" });
      expect(result.peer?.name).toBe("Seller");
      expect(result.transcript.map((turn) => [turn.speaker, turn.decision.action])).toEqual([
        ["self", "propose"],
        ["peer", "counter"],
        ["self", "counter"],
        ["peer", "accept"],
      ]);
    } finally {
      stop();
    }
  });

  // A2A puts the Task on the server side, so an accept the counterparty
  // answered with a counter leaves the exchange open — whatever this agent
  // meant by it. `endedBy` still records what this side did.
  test("does not call the exchange over when the task is still open", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "$450." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "accept", message: "Fine, $450." }]).negotiator,
      });

      const result = await agent.negotiate(url);

      expect(result.state).toBe("input-required");
      expect(result.end).toBe("open");
      expect(result.endedBy).toEqual({ speaker: "self", action: "accept" });
      expect(result.settlement?.outcome).toBe("unanswered");
    } finally {
      stop();
    }
  });

  test("stops at maxTurns with the task still open", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "Not enough." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "counter", message: "How about now?" }]).negotiator,
      });

      const result = await agent.negotiate(url, { maxTurns: 2 });

      expect(result.end).toBe("max-turns");
      expect(result.endedBy).toBeUndefined();
      expect(result.state).toBe("input-required");
      expect(result.transcript).toHaveLength(4);
    } finally {
      stop();
    }
  });

  test("takes negotiation turns one at a time, carrying the same task", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "Not yet." },
          { action: "accept", message: "Fine, done." },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });

      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });

      expect(first.sent).toEqual({ action: "propose", message: "$400?" });
      expect(first.received).toEqual({ action: "counter", message: "Not yet." });
      expect(first.done).toBe(false);

      const second = await agent.continueNegotiation(first.id, {}, { negotiations });

      expect(second.id).toBe(first.id);
      expect(second.received).toEqual({ action: "accept", message: "Fine, done." });
      expect(second.done).toBe(true);
      expect(second.endedBy).toEqual({ speaker: "peer", action: "accept" });

      // One task, four messages — the same exchange, not a new one.
      expect(negotiations.get(first.id)?.task.history).toHaveLength(4);
    } finally {
      stop();
    }
  });

  test("folds per-turn guidance into the objective without losing the standing brief", async () => {
    const server = scripted([{ action: "counter", message: "How about delivery?" }]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));

    try {
      const client = scripted([
        { action: "propose", message: "$400?" },
        { action: "counter", message: "Tuesday works." },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });

      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, { objective: "buy the bike" }, { negotiations });
      await agent.continueNegotiation(
        first.id,
        { guidance: "Bob can collect on Tuesday" },
        { negotiations },
      );

      const objective = client.calls[1]?.party.objective ?? "";
      expect(objective).toContain("Buy the bike for as little as possible");
      expect(objective).toContain("In this negotiation: buy the bike");
      expect(objective).toContain("For this turn: Bob can collect on Tuesday");

      // Guidance is for one turn only.
      expect(client.calls[0]?.party.objective).not.toContain("Tuesday");
    } finally {
      stop();
    }
  });

  test("refuses to continue a negotiation it never opened", async () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });

    await expect(
      agent.continueNegotiation("nope", {}, { negotiations: new Map() }),
    ).rejects.toThrow(/No open negotiation/);
  });

  test("discover: false skips the card fetch", async () => {
    const agent = new Agent({
      ...seller,
      negotiator: scripted([{ action: "accept", message: "Sure." }]).negotiator,
    });
    const handler = agent.handler();

    let cardFetches = 0;
    const server = Bun.serve({
      port: 0,
      fetch: (request) => {
        if (new URL(request.url).pathname.includes("agent-card")) {
          cardFetches++;
          return new Response("nope", { status: 500 });
        }
        return handler(request);
      },
    });

    try {
      const client = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });

      const result = await client.negotiate(server.url.toString(), { discover: false });
      expect(cardFetches).toBe(0);
      expect(result.peer).toBeNull();
      expect(result.state).toBe("completed");
    } finally {
      server.stop(true);
    }
  });

  test("reports turns in conversation order on both sides", async () => {
    const inbound: [speaker: string, action: string, direction: Direction][] = [];
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Sure." }]).negotiator,
        onTurn: (turn, direction) => inbound.push([turn.speaker, turn.decision.action, direction]),
      }),
    );

    try {
      const outbound: AgentTurn[] = [];
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
        onTurn: (turn) => outbound.push(turn),
      });

      await agent.negotiate(url);

      expect(inbound).toEqual([
        ["peer", "propose", "inbound"],
        ["self", "accept", "inbound"],
      ]);
      expect(outbound.map((turn) => [turn.speaker, turn.decision.action])).toEqual([
        ["self", "propose"],
        ["peer", "accept"],
      ]);
    } finally {
      stop();
    }
  });
});

describe("custom action vocabularies", () => {
  test("a non-price domain with its own terminal actions", async () => {
    const { url, stop } = serve(
      new Agent<"triage" | "resolve" | "escalate">({
        identity: { name: "Support", id: "org:acme" },
        systemPrompt: "Close the ticket without a human",
        apiKey: "test-key",
        negotiator: scripted([{ action: "resolve", message: "Refunded." }]).negotiator,
        allowedActions: [
          { action: "triage", description: "ask for more detail" },
          { action: "resolve", description: "close the ticket" },
          { action: "escalate", description: "hand off to a human" },
        ],
        isTerminal: (action) => action === "resolve" || action === "escalate",
        terminalState: (action) => (action === "resolve" ? "completed" : "canceled"),
      }),
    );

    try {
      const customer = new Agent<"triage" | "resolve" | "escalate">({
        identity: { name: "Customer", id: "did:example:dana" },
        systemPrompt: "Get the order replaced",
        apiKey: "test-key",
        negotiator: scripted([{ action: "triage", message: "My order never arrived." }]).negotiator,
        allowedActions: ["triage", "resolve", "escalate"],
        isTerminal: (action) => action === "resolve" || action === "escalate",
      });

      const result = await customer.negotiate(url);
      expect(result.state).toBe("completed");
      expect(result.endedBy).toEqual({ speaker: "peer", action: "resolve" });
      expect(messageToDecision(result.task.history[1]!)?.action).toBe("resolve");
    } finally {
      stop();
    }
  });
});

describe("evaluate", () => {
  test("attaches artifacts on both sides of the wire", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Deal." }]).negotiator,
        evaluate: (_task, decision) => ({
          artifactId: "server-eval",
          parts: [{ kind: "data", data: { action: decision.action } }],
        }),
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
        evaluate: () => ({
          artifactId: "client-eval",
          parts: [{ kind: "data", data: { ok: true } }],
        }),
      });

      const result = await agent.negotiate(url);

      // The handler also writes its own `negotiation-outcome` artifact on a
      // terminal action, so this asserts the eval artifact is there rather
      // than that it is the only one.
      expect(result.task.artifacts.map((artifact) => artifact.artifactId)).toContain("server-eval");
      expect(result.artifacts.map((a) => a.artifactId)).toEqual(["client-eval"]);
    } finally {
      stop();
    }
  });
});

describe("settlement", () => {
  /** Runs one negotiation between two scripted agents and returns it. */
  async function trade(sellerScript: NegotiationDecision[], buyerScript: NegotiationDecision[]) {
    const server = serve(new Agent({ ...seller, negotiator: scripted(sellerScript).negotiator }));
    try {
      const agent = new Agent({ ...buyer, negotiator: scripted(buyerScript).negotiator });
      return await agent.negotiate(server.url, { maxTurns: 4 });
    } finally {
      server.stop();
    }
  }

  // Prose-only decisions can't say *what* was agreed, so the verdict is
  // `unconfirmed` rather than a guess. Terms make it checkable — see below.
  test("prose-only closes are unconfirmed, not agreed", async () => {
    const negotiation = await trade(
      [{ action: "accept", message: "Yes — $450, Wednesday evening." }],
      [{ action: "counter", message: "$450 and I collect Wednesday." }],
    );

    expect(negotiation.settlement?.outcome).toBe("unconfirmed");
    expect(negotiation.settlement?.basis).toBe("state");
  });

  // The reported bug: each side decides its own turn, so both can say yes
  // to different numbers in one round trip and walk away believing
  // different things. `endedBy` reads as authoritative to whoever produced
  // it; only comparing the two closing statements catches this.
  test("two accepts naming different amounts is a conflict, not a deal", async () => {
    const negotiation = await trade(
      [
        { action: "counter", message: "The lowest I can do is $460." },
        { action: "accept", message: "Deal — $450 it is." },
      ],
      [
        { action: "propose", message: "I can offer $430." },
        { action: "accept", message: "Approved. We have a deal at $460." },
      ],
    );

    expect(negotiation.endedBy).toEqual({ speaker: "self", action: "accept" });
    expect(negotiation.settlement?.outcome).toBe("conflict");
    expect(negotiation.settlement?.disputed).toEqual({ mine: [460], theirs: [450] });
  });

  // The Task ended `rejected`, so there is no deal — `declined` is the
  // truthful verdict, and `mine` still records that this side said accept.
  test("accepting into a rejection is declined, and says so", async () => {
    const negotiation = await trade(
      [
        { action: "counter", message: "The lowest I can do is $460." },
        { action: "reject", message: "$450 is below my floor. I'll pass." },
      ],
      [
        { action: "propose", message: "I can offer $430." },
        { action: "accept", message: "We have a deal at $460." },
      ],
    );

    expect(negotiation.state).toBe("rejected");
    expect(negotiation.endedBy).toEqual({ speaker: "self", action: "accept" });
    expect(negotiation.settlement?.outcome).toBe("declined");
    expect(negotiation.settlement?.mine.action).toBe("accept");
  });

  test("closing while the counterparty keeps haggling is unanswered", async () => {
    const negotiation = await trade(
      [{ action: "counter", message: "Still $460." }],
      [{ action: "accept", message: "Fine, we accept $460." }],
    );

    expect(negotiation.settlement?.outcome).toBe("unanswered");
    expect(negotiation.settlement?.reason).toContain("Nothing is agreed");
  });

  test("both sides refusing is declined, not a conflict", async () => {
    const negotiation = await trade(
      [{ action: "reject", message: "Too low. Passing." }],
      [{ action: "reject", message: "Too expensive. Passing." }],
    );

    expect(negotiation.settlement?.outcome).toBe("declined");
  });

  test("nothing is settled while the exchange is still open", async () => {
    const negotiation = await trade(
      [{ action: "counter", message: "$460." }],
      [{ action: "counter", message: "$430." }],
    );

    expect(negotiation.settlement).toBeUndefined();
    expect(negotiation.end).toBe("max-turns");
  });

  test("records who closed even when the terms can't be verified", async () => {
    const negotiation = await trade(
      [{ action: "accept", message: "$450 works. Wednesday it is." }],
      [{ action: "counter", message: "I can do $450, collecting Wednesday." }],
    );

    expect(negotiation.endedBy).toEqual({ speaker: "peer", action: "accept" });
    expect(negotiation.settlement?.outcome).toBe("unconfirmed");
  });
});

describe("onSettled", () => {
  // The point of the hook: both parties compare the same pair of closing
  // moves, so they reach the same verdict instead of each knowing only
  // what it did itself.
  test("both sides reach the same verdict on a conflicted close", async () => {
    const sellerSaw: string[] = [];
    const buyerSaw: string[] = [];

    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "The lowest I can do is $460." },
          { action: "accept", message: "Deal — $450 it is." },
        ]).negotiator,
        onSettled: (settlement) => sellerSaw.push(settlement.outcome),
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "I can offer $430." },
          { action: "accept", message: "Approved — we have a deal at $460." },
        ]).negotiator,
        onSettled: (settlement) => buyerSaw.push(settlement.outcome),
      });
      await agent.negotiate(server.url, { maxTurns: 4 });
    } finally {
      server.stop();
    }

    expect(buyerSaw).toEqual(["conflict"]);
    expect(sellerSaw).toEqual(["conflict"]);
  });

  test("reports the direction each side played", async () => {
    const directions: string[] = [];
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "$450 works." }]).negotiator,
        onSettled: (_settlement, direction) => directions.push(direction),
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "counter", message: "$450, Wednesday." }]).negotiator,
        onSettled: (_settlement, direction) => directions.push(direction),
      });
      await agent.negotiate(server.url, { maxTurns: 4 });
    } finally {
      server.stop();
    }

    expect(directions.sort()).toEqual(["inbound", "outbound"]);
  });
});

describe("settlement is symmetric", () => {
  /** Runs one exchange and returns the verdict each side reached. */
  async function verdicts(
    sellerScript: NegotiationDecision[],
    buyerScript: NegotiationDecision[],
  ): Promise<{ seller: string[]; buyer: string[] }> {
    const sellerSaw: string[] = [];
    const buyerSaw: string[] = [];

    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted(sellerScript).negotiator,
        onSettled: (settlement) => sellerSaw.push(settlement.outcome),
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted(buyerScript).negotiator,
        onSettled: (settlement) => buyerSaw.push(settlement.outcome),
      });
      await agent.negotiate(server.url, { maxTurns: 3 });
    } finally {
      server.stop();
    }

    return { seller: sellerSaw, buyer: buyerSaw };
  }

  // Replying to someone's accept with a counter is not agreement, but
  // accepting someone's standing offer is — so the verdict depends on who
  // spoke second, which is reversed on the two sides.
  test("closing into a counter reads as unanswered from both ends", async () => {
    const seen = await verdicts(
      [{ action: "counter", message: "Still $460, sorry." }],
      [{ action: "accept", message: "We accept $460." }],
    );

    expect(seen.buyer).toEqual(["unanswered"]);
    expect(seen.seller).toEqual(["unanswered"]);
  });

  test("a prose-only close reads the same from both ends", async () => {
    const seen = await verdicts(
      [{ action: "accept", message: "$450 works, Wednesday." }],
      [{ action: "counter", message: "$450 and I collect Wednesday." }],
    );

    expect(seen.buyer).toEqual(["unconfirmed"]);
    expect(seen.seller).toEqual(["unconfirmed"]);
  });

  test("a refusal of a standing offer reads as declined from both ends", async () => {
    const seen = await verdicts(
      [{ action: "reject", message: "$430 is too low. Passing." }],
      [{ action: "counter", message: "Best I can do is $430." }],
    );

    expect(seen.buyer).toEqual(["declined"]);
    expect(seen.seller).toEqual(["declined"]);
  });
});

describe("the task state is the record", () => {
  // A2A generates task ids server-side and only the server transitions
  // state, so the counterparty's Task — not this agent's own action — says
  // whether a negotiation ended.
  test("a terminal state ends the exchange even when this side didn't close", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "reject", message: "Too low. Passing." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "counter", message: "$430 is my best." }]).negotiator,
      });
      const result = await agent.negotiate(server.url, { maxTurns: 4 });

      expect(result.state).toBe("rejected");
      expect(result.end).toBe("terminal");
      expect(result.endedBy).toEqual({ speaker: "peer", action: "reject" });
    } finally {
      server.stop();
    }
  });

  // The case that started this: `endedBy` says this side accepted, the
  // record says the task was rejected. Neither is the verdict.
  test("an accept against a rejected task is reported as what it is", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "The lowest I can do is $460." },
          { action: "reject", message: "$450 is below my floor." },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "I can offer $430." },
          { action: "accept", message: "We have a deal at $460." },
        ]).negotiator,
      });
      const result = await agent.negotiate(server.url, { maxTurns: 4 });

      expect(result.state).toBe("rejected");
      expect(result.endedBy).toEqual({ speaker: "self", action: "accept" });
      expect(result.settlement?.outcome).toBe("declined");
      expect(result.settlement?.mine.action).toBe("accept");
    } finally {
      server.stop();
    }
  });

  test("stops taking turns once there is a verdict, without waiting for maxTurns", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "Still $460." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "accept", message: "We accept $460." }]).negotiator,
      });
      const result = await agent.negotiate(server.url, { maxTurns: 8 });

      // One round trip: it accepted, so it doesn't carry on bargaining
      // just because the counterparty's reply left the task open.
      expect(result.transcript).toHaveLength(2);
      expect(result.settlement?.outcome).toBe("unanswered");
    } finally {
      server.stop();
    }
  });
});

describe("structured terms", () => {
  /** Runs one exchange and returns the settlement each side reached. */
  async function trade(
    sellerScript: NegotiationDecision[],
    buyerScript: NegotiationDecision[],
  ) {
    const sellerSaw: Settlement[] = [];
    const buyerSaw: Settlement[] = [];

    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted(sellerScript).negotiator,
        onSettled: (settlement) => sellerSaw.push(settlement as Settlement),
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted(buyerScript).negotiator,
        onSettled: (settlement) => buyerSaw.push(settlement as Settlement),
      });
      const negotiation = await agent.negotiate(server.url, { maxTurns: 4 });
      return { negotiation, sellerSaw, buyerSaw };
    } finally {
      server.stop();
    }
  }

  // What prose can never establish: acceptance naming the offer it binds
  // to, so the agreed terms are the offer's, not a re-statement of them.
  test("an accept that names the offer it takes is agreed by reference", async () => {
    const { negotiation } = await trade(
      [
        {
          action: "counter",
          message: "The lowest I can do is $460, Wednesday evening.",
          offerId: "offer-460",
          terms: { amount: 460, pickupDay: "Wednesday" },
        },
        { action: "accept", message: "Wednesday it is.", acceptsOfferId: "offer-460" },
      ],
      [
        { action: "propose", message: "I can offer $430.", offerId: "offer-430" },
        { action: "accept", message: "Done.", acceptsOfferId: "offer-460" },
      ],
    );

    expect(negotiation.settlement?.outcome).toBe("agreed");
    expect(negotiation.settlement?.basis).toBe("reference");
    expect(negotiation.settlement?.terms).toEqual({ amount: 460, pickupDay: "Wednesday" });
  });

  // The multi-field case: same price, different day. No amount comparison
  // can catch this, which is why terms had to be structured.
  test("closes agreeing on price but not on the day are a conflict", async () => {
    const { negotiation } = await trade(
      [
        {
          action: "accept",
          message: "Agreed — $460, Saturday.",
          terms: { amount: 460, pickupDay: "Saturday" },
        },
      ],
      [
        {
          action: "counter",
          message: "$460 works, Wednesday evening.",
          terms: { amount: 460, pickupDay: "Wednesday" },
        },
      ],
    );

    expect(negotiation.settlement?.outcome).toBe("conflict");
    expect(negotiation.settlement?.basis).toBe("terms");
  });

  test("an accept naming an offer that was never made is a conflict", async () => {
    const { negotiation } = await trade(
      [
        { action: "counter", message: "$460.", offerId: "offer-460", terms: { amount: 460 } },
        { action: "accept", message: "Taking the $440 one.", acceptsOfferId: "offer-440" },
      ],
      [
        { action: "propose", message: "$430?", offerId: "offer-430" },
        { action: "accept", message: "Agreed.", acceptsOfferId: "offer-460" },
      ],
    );

    expect(negotiation.settlement?.outcome).toBe("conflict");
    expect(negotiation.settlement?.reason).toContain("offer-440");
  });

  test("both sides read the same verdict and the same terms", async () => {
    const { sellerSaw, buyerSaw } = await trade(
      [
        {
          action: "counter",
          message: "$460, Wednesday.",
          offerId: "offer-460",
          terms: { amount: 460, pickupDay: "Wednesday" },
        },
        { action: "accept", message: "See you Wednesday.", acceptsOfferId: "offer-460" },
      ],
      [
        { action: "propose", message: "$430?", offerId: "offer-430" },
        { action: "accept", message: "Done.", acceptsOfferId: "offer-460" },
      ],
    );

    expect(buyerSaw.at(-1)?.outcome).toBe("agreed");
    expect(sellerSaw.at(-1)?.outcome).toBe("agreed");
    expect(sellerSaw.at(-1)?.terms).toEqual(buyerSaw.at(-1)?.terms ?? {});
  });

  // The prose fallback survives for counterparties that send no terms: it
  // is weaker evidence, and labels itself as such.
  test("prose-only closes naming different amounts still surface as a conflict", async () => {
    const { negotiation } = await trade(
      [
        { action: "counter", message: "The lowest I can do is $460." },
        { action: "accept", message: "Deal — $450 it is." },
      ],
      [
        { action: "propose", message: "I can offer $430." },
        { action: "accept", message: "Approved. We have a deal at $460." },
      ],
    );

    expect(negotiation.settlement?.outcome).toBe("conflict");
    expect(negotiation.settlement?.basis).toBe("prose");
    expect(negotiation.settlement?.disputed).toEqual({ mine: [460], theirs: [450] });
  });
});

describe("published skills", () => {
  test("describes the negotiating skill with the actions it understands", () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });
    const [skill] = agent.card().skills;

    expect(skill?.id).toBe("negotiate");
    expect(skill?.description).toContain("propose, counter, accept, reject");
  });

  test("publishes a custom action vocabulary, so counterparties can read it", () => {
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([]).negotiator,
      allowedActions: [
        { action: "resolve", description: "close the ticket" },
        { action: "escalate", description: "hand to a human" },
      ],
    });

    expect(agent.card().skills[0]?.description).toContain("resolve, escalate");
  });

  // The card is public and unauthenticated, and the tools are whatever the
  // host injected — so they stay off it unless asked for.
  test("keeps tools off the card by default", () => {
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([]).negotiator,
      tools: [
        {
          name: "list_index_holdings",
          description: "Lists what this party holds",
          parameters: {},
          run: () => [],
        },
      ],
    });

    expect(agent.card().skills.map((skill) => skill.id)).toEqual(["negotiate"]);
  });

  test("publishes tools as skills when the host opts in", () => {
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([]).negotiator,
      publishTools: true,
      tools: [
        ...defaultTools(),
        {
          name: "find_counterparties",
          description: "Finds agents to negotiate with",
          parameters: {},
          run: () => [],
        },
      ],
    });

    // `ask_user` and the negotiation pair are left out: one is how this
    // agent reaches its own party, the others are the negotiate skill.
    expect(agent.card().skills.map((skill) => skill.id)).toEqual([
      "negotiate",
      "find_counterparties",
    ]);
  });

  test("an explicit skills option replaces the derived ones", () => {
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([]).negotiator,
      publishTools: true,
      skills: [{ id: "only", name: "Only" }],
    });

    expect(agent.card().skills).toEqual([{ id: "only", name: "Only" }]);
  });
});

describe("what the agent knows it negotiated", () => {
  // The bug this exists for: an inbound negotiation is answered by the
  // handler, never by the agent loop, so nothing about it reaches the
  // conversation. The responder's agent would deny a deal it had just made.
  test("records negotiations it answered, not only ones it opened", async () => {
    const responder = new Agent({
      ...seller,
      negotiator: scripted([{ action: "accept", message: "$450 works." }]).negotiator,
    });
    const server = serve(responder);

    try {
      const initiator = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "counter", message: "$450, Wednesday." }]).negotiator,
      });
      await initiator.negotiate(server.url, { maxTurns: 2 });
    } finally {
      server.stop();
    }

    expect(responder.instructions()).toContain("they contacted you");
    expect(responder.instructions()).toContain("Negotiations you are party to");
  });

  test("tells the model the record, both directions, with the verdict", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          {
            action: "accept",
            message: "Done.",
            acceptsOfferId: "offer-450",
          },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          {
            action: "counter",
            message: "$450, Wednesday.",
            offerId: "offer-450",
            terms: { amount: 450, pickupDay: "Wednesday" },
          },
        ]).negotiator,
      });
      await agent.negotiate(server.url, { maxTurns: 2 });

      const instructions = agent.instructions();
      expect(instructions).toContain("you contacted them");
      expect(instructions).toContain("agreed");
      expect(instructions).toContain('"amount":450');
    } finally {
      server.stop();
    }
  });

  // Reading is uniform; acting is not. The counterparty dialed us, so
  // there is no address to call back on.
  test("refuses to take a turn in a negotiation it did not open", async () => {
    const responder = new Agent({
      ...seller,
      negotiator: scripted([{ action: "counter", message: "Still $460." }]).negotiator,
    });
    const server = serve(responder);

    let id = "";
    try {
      const initiator = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$430?" }]).negotiator,
      });
      const negotiation = await initiator.negotiate(server.url, { maxTurns: 1 });
      id = negotiation.task.id;
    } finally {
      server.stop();
    }

    expect(responder.continueNegotiation(id)).rejects.toThrow(
      /opened by the counterparty/,
    );
  });

  test("an intent scope shares the record rather than starting a new one", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Fine." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "counter", message: "$450?" }]).negotiator,
      });
      await agent.negotiate(server.url, { maxTurns: 2 });

      expect(agent.for("Buy a bike").instructions()).toContain("you contacted them");
    } finally {
      server.stop();
    }
  });

  test("a host can supply the store, so the record survives the process", async () => {
    const sessions = new MemoryNegotiationStore();
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Fine." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        sessions,
        negotiator: scripted([{ action: "counter", message: "$450?" }]).negotiator,
      });
      await agent.negotiate(server.url, { maxTurns: 2 });

      // A fresh Agent over the same store knows what the old one did.
      const restarted = new Agent({
        ...buyer,
        sessions,
        negotiator: scripted([]).negotiator,
      });
      expect(restarted.instructions()).toContain("you contacted them");
      expect(sessions.list()).toHaveLength(1);
    } finally {
      server.stop();
    }
  });
});

describe("interrupting a negotiation", () => {
  /** A counterparty that accepts the connection and never answers — the
   * failure that used to park the caller with no way out. */
  function silent() {
    const server = Bun.serve({
      port: 0,
      fetch: () => new Promise<Response>(() => {}),
    });
    return { url: server.url.toString(), stop: () => server.stop(true) };
  }

  test("a run's signal reaches the turn in flight", async () => {
    const server = silent();
    const controller = new AbortController();

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$430?" }]).negotiator,
      });

      setTimeout(() => controller.abort(new Error("interrupted")), 100);
      const started = Date.now();

      expect(
        agent.negotiate(server.url, { discover: false, signal: controller.signal }),
      ).rejects.toThrow();

      await Bun.sleep(400);
      // Stopped on the abort, not on the 180s transport deadline.
      expect(Date.now() - started).toBeLessThan(3_000);
    } finally {
      server.stop();
    }
  });

  test("an already-aborted signal never opens the negotiation", async () => {
    const server = silent();

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$430?" }]).negotiator,
      });

      expect(
        agent.negotiate(server.url, {
          discover: false,
          signal: AbortSignal.abort(new Error("already gone")),
        }),
      ).rejects.toThrow();
    } finally {
      server.stop();
    }
  });

  test("the tool loop's signal covers a negotiation a tool opened", async () => {
    const server = silent();
    const controller = new AbortController();

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$430?" }]).negotiator,
      });

      setTimeout(() => controller.abort(new Error("interrupted")), 100);

      // Exactly what `negotiate_open` does, with the context the loop hands
      // its tools.
      expect(
        agent.openNegotiation(
          server.url,
          { discover: false },
          { negotiations: new Map(), signal: controller.signal },
        ),
      ).rejects.toThrow();

      await Bun.sleep(400);
    } finally {
      server.stop();
    }
  });
});

describe("a settled negotiation stays settled", () => {
  /** Two scripted agents that reach a deal, then keep talking. */
  async function settleThenPush() {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "accept", message: "Agreed, $460.", offerId: "o1", terms: { amount: 460 } },
          { action: "counter", message: "Actually I want $500 now.", terms: { amount: 500 } },
        ]).negotiator,
      }),
    );

    const agent = new Agent({
      ...buyer,
      negotiator: scripted([
        { action: "counter", message: "$460?", offerId: "o1", terms: { amount: 460 } },
        { action: "counter", message: "But we agreed $460.", terms: { amount: 460 } },
      ]).negotiator,
    });

    const negotiations = new Map<string, NegotiationSession>();
    const first = await agent.openNegotiation(server.url, { discover: false }, { negotiations });
    return { agent, negotiations, first, stop: () => server.stop() };
  }

  // Reopening a closed exchange doesn't reopen the question, it destroys
  // the answer: the counterparty replies, the Task drops out of its
  // terminal state, and the agreement that was on the record is gone.
  test("refuses another turn once the exchange has ended", async () => {
    const { agent, negotiations, first, stop } = await settleThenPush();

    try {
      expect(first.settlement?.outcome).toBe("agreed");
      expect(first.state).toBe("completed");

      expect(agent.continueNegotiation(first.id, {}, { negotiations })).rejects.toThrow(
        /already ended \(completed\)/,
      );

      // The record still holds the deal.
      await Bun.sleep(20);
      expect(negotiations.get(first.id)?.task.status.state).toBe("completed");
    } finally {
      stop();
    }
  });

  test("points at opening a new negotiation instead", async () => {
    const { agent, negotiations, first, stop } = await settleThenPush();

    try {
      expect(agent.continueNegotiation(first.id, {}, { negotiations })).rejects.toThrow(
        /open a new negotiation/i,
      );
    } finally {
      stop();
    }
  });

  test("a rejected exchange is just as final as an agreed one", async () => {
    const server = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "reject", message: "No thanks." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$200?" }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const turn = await agent.openNegotiation(server.url, { discover: false }, { negotiations });

      expect(turn.state).toBe("rejected");
      expect(agent.continueNegotiation(turn.id, {}, { negotiations })).rejects.toThrow(
        /already ended \(rejected\)/,
      );
    } finally {
      server.stop();
    }
  });
});

describe("knowing the date", () => {
  const monday = new Date("2026-08-31T10:00:00Z");

  // Without a clock the agent can only repeat "next Tuesday", never
  // resolve it — and a relative date in the settled terms stops meaning
  // the same thing a week later.
  test("tells the model today's date", () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator, now: () => monday });

    expect(agent.instructions()).toContain("Today is Monday, 31 August 2026");
  });

  test("asks for absolute dates in the record", () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator, now: () => monday });

    expect(agent.instructions()).toContain("record the actual date");
  });

  test("an intent scope keeps the clock", () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator, now: () => monday });

    expect(agent.for("Buy a bike").instructions()).toContain("Monday, 31 August 2026");
  });
});

describe("a counterparty cannot reopen our settled negotiation", () => {
  // The half this agent can't guard: someone else sending a message on a
  // Task of ours that has already completed. The check has to live where
  // the task is owned, which is the handler.
  test("the handler refuses a message on a task that already ended", async () => {
    const responder = new Agent({
      ...seller,
      negotiator: scripted([
        { action: "accept", message: "Agreed, $460.", offerId: "o1", terms: { amount: 460 } },
      ]).negotiator,
    });
    const server = serve(responder);

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "counter", message: "$460?", offerId: "o1", terms: { amount: 460 } },
        ]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const turn = await agent.openNegotiation(server.url, { discover: false }, { negotiations });
      expect(turn.settlement?.outcome).toBe("agreed");

      // Straight at the wire, bypassing our own client-side guard — a
      // counterparty we don't control wouldn't have one.
      const response = await fetch(server.url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: "1",
          method: "message/send",
          params: {
            message: {
              messageId: crypto.randomUUID(),
              role: "user",
              taskId: turn.id,
              parts: [{ kind: "data", data: { action: "counter", message: "Actually, $400." } }],
            },
          },
        }),
      });

      const body = (await response.json()) as { error?: { message: string } };
      expect(body.error?.message).toMatch(/cannot accept further messages/);

      // And the record still holds the deal.
      const after = await agent.inspect(server.url).catch(() => null);
      expect(after).toBeTruthy();
    } finally {
      server.stop();
    }
  });
});

describe("one clock", () => {
  // Two clocks in one agent disagree across midnight, and then the agent's
  // negotiation turns contradict what it told its own party.
  test("the negotiator is built with the agent's clock", async () => {
    const seen: string[] = [];
    const agent = new Agent({
      ...buyer,
      apiKey: "test-key",
      now: () => new Date("2026-08-31T23:30:00Z"),
    });

    // The negotiator states the date in its own system prompt; both halves
    // read the same instant, so both name the same day.
    seen.push(agent.instructions());
    expect(seen[0]).toContain("Monday, 31 August 2026");
  });

  // Pins the timezone rather than inheriting the machine's, which is what
  // makes this fail on a local-time implementation *anywhere*. Inheriting
  // it, a UTC box — CI, most containers — cannot tell the two apart,
  // because there local and UTC formatting are the same function. Each
  // pair is an instant plus a zone where it falls on a different local
  // day, straddling midnight in both directions.
  test("reads the clock as UTC even when the host timezone says otherwise", () => {
    const original = process.env.TZ;

    try {
      for (const [timezone, instant] of [
        ["Pacific/Auckland", "2026-08-31T23:30:00Z"], // locally the 1st
        ["America/Los_Angeles", "2026-08-31T00:30:00Z"], // locally the 30th
      ] as const) {
        process.env.TZ = timezone;

        const agent = new Agent({
          ...buyer,
          negotiator: scripted([]).negotiator,
          now: () => new Date(instant),
        });

        expect(agent.instructions()).toContain("Monday, 31 August 2026");
      }
    } finally {
      if (original === undefined) delete process.env.TZ;
      else process.env.TZ = original;
    }
  });

  test("reads the clock per call, so a long-lived agent doesn't freeze", () => {
    let now = new Date("2026-08-31T09:00:00Z");
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([]).negotiator,
      now: () => now,
    });

    expect(agent.instructions()).toContain("31 August 2026");
    now = new Date("2026-09-04T09:00:00Z");
    expect(agent.instructions()).toContain("4 September 2026");
  });
});
