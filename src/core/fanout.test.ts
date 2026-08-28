import { describe, expect, test } from "bun:test";
import {
  Negotiator,
  type DecideOptions,
  type NegotiationDecision,
  type NegotiationState,
} from "@indexnetwork/negotiator";

import { Agent } from "./agent.ts";
import { digest } from "./digest.ts";
import { negotiationTools, type Tool } from "./tools.ts";
import type { ModelMessage, ToolCall } from "./model.ts";
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

describe("escalation", () => {
  test("an ask parks the negotiation and sends nothing", async () => {
    const server = scripted([{ action: "counter", message: "$480, pickup Saturday." }]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));
    try {
      const client = scripted([
        { action: "propose", message: "$400?" },
        { action: "ask", message: "What is the latest pickup day Bob can do?" },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      const event = await agent.runNegotiation(url, {}, { negotiations });

      expect(event.kind).toBe("asking");
      if (event.kind !== "asking") return;
      expect(event.question).toBe("What is the latest pickup day Bob can do?");
      expect(event.last).toEqual({ action: "counter", message: "$480, pickup Saturday." });
      expect(event.turns).toBe(1);
      // Only the propose reached the counterparty.
      expect(server.calls).toHaveLength(1);
      expect(negotiations.get(event.id)?.pending).toEqual({
        question: "What is the latest pickup day Bob can do?",
      });
      // The pump offers `ask`; one-vs-one turns do not.
      expect(client.calls[1]?.options.allowedActions).toContainEqual(
        expect.objectContaining({ action: "ask" }),
      );
    } finally {
      stop();
    }
  });

  test("negotiate_open and negotiate_turn never offer ask", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "No." }]).negotiator }),
    );
    try {
      const client = scripted([{ action: "propose", message: "$400?" }]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      await agent.continueNegotiation(first.id, {}, { negotiations });

      const offered = client.calls.map((c) =>
        c.options.allowedActions.map((a) => (typeof a === "string" ? a : a.action)),
      );
      expect(offered).toEqual([
        ["propose", "counter", "accept", "reject"],
        ["propose", "counter", "accept", "reject"],
      ]);
    } finally {
      stop();
    }
  });

  test("resume folds the answer into every later turn and clears the question", async () => {
    const server = scripted([
      { action: "counter", message: "$480, Saturday?" },
      { action: "counter", message: "$470?" },
      { action: "accept", message: "Fine." },
    ]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));
    try {
      const client = scripted([
        { action: "propose", message: "$400?" },
        { action: "ask", message: "Latest pickup day?" },
        { action: "counter", message: "$450, Sunday." },
        { action: "counter", message: "$460, Sunday." },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      const parked = await agent.runNegotiation(url, {}, { negotiations });
      expect(parked.kind).toBe("asking");

      const event = await agent.resumeNegotiation(parked.id, "Bob can do Sunday at the latest", {
        negotiations,
      });

      expect(event.kind).toBe("settled");
      expect(negotiations.get(parked.id)?.pending).toBeUndefined();
      expect(negotiations.get(parked.id)?.guidance).toEqual(["Bob can do Sunday at the latest"]);
      // Every decide after the answer sees it; none before did.
      const seen = client.calls.map((c) => c.state.party.objective.includes("Sunday at the latest"));
      expect(seen).toEqual([false, false, true, true]);
    } finally {
      stop();
    }
  });

  test("an ask before the first turn gets a local id, re-keyed once a Task exists", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }),
    );
    try {
      const client = scripted([
        { action: "ask", message: "What is Bob's ceiling?" },
        { action: "propose", message: "$400, final." },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      const parked = await agent.runNegotiation(url, {}, { negotiations });
      expect(parked.id).toStartWith("local:");
      expect([...negotiations.keys()]).toEqual([parked.id]);

      const event = await agent.resumeNegotiation(parked.id, "$450", { negotiations });

      expect(event.kind).toBe("settled");
      expect(event.id).not.toStartWith("local:");
      expect([...negotiations.keys()]).toEqual([event.id]);
      expect(agent.instructions().split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    } finally {
      stop();
    }
  });

  test("resume refuses what it cannot resume, one line each", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }),
    );
    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const settled = await agent.runNegotiation(url, {}, { negotiations });
      const before = negotiations.get(settled.id)?.task.status.state;

      const ended = await agent.resumeNegotiation(settled.id, "go lower", { negotiations });
      const unknown = await agent.resumeNegotiation("nope", "go lower", { negotiations });

      expect(ended.kind).toBe("skipped");
      if (ended.kind === "skipped") expect(ended.reason).toContain("already ended (completed)");
      expect(unknown.kind).toBe("skipped");
      if (unknown.kind === "skipped") expect(unknown.reason).toContain("No negotiation");
      // Nothing was walked backwards.
      expect(negotiations.get(settled.id)?.task.status.state).toBe(before);
    } finally {
      stop();
    }
  });

  test("the record shows a parked negotiation as waiting on the party", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "$480." }]).negotiator }),
    );
    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$400?" },
          { action: "ask", message: "Ceiling?" },
        ]).negotiator,
      });
      await agent.runNegotiation(url, {}, { negotiations: new Map() });
      expect(agent.instructions()).toContain('waiting on your guidance: "Ceiling?"');
    } finally {
      stop();
    }
  });
});

describe("digest()", () => {
  test("groups events, one line each, and omits empty groups", () => {
    const text = digest([
      {
        kind: "settled", id: "61b3061c", peer: "Alice's Agent", state: "completed", turns: 3,
        settlement: { outcome: "agreed", basis: "terms", reason: "", terms: { amount: 460 } } as never,
      },
      { kind: "settled", id: "9f2a1c3d", peer: "Bob's Agent", state: "rejected", turns: 2,
        settlement: { outcome: "declined", basis: "state", reason: "They refused." } as never },
      { kind: "asking", id: "1a2b3c4d", peer: "Carol's Agent", turns: 1,
        question: "Latest pickup day?", last: { action: "counter", message: "$480, Saturday", terms: { amount: 480 } } },
      { kind: "budget", id: "5e6f7a8b", peer: "Dan's Agent", turns: 10, last: { action: "counter", message: "$500" } },
      { kind: "failed", id: "local:x", turns: 0, error: "fetch failed" },
      { kind: "skipped", id: "abcd", reason: "already ended (completed)" },
    ]);

    expect(text).toBe(
      [
        "Settled (2):",
        '- 61b3061c with Alice\'s Agent — agreed: {"amount":460}',
        "- 9f2a1c3d with Bob's Agent — declined: They refused.",
        "Waiting on you (1) — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to:",
        '- 1a2b3c4d with Carol\'s Agent — asks: "Latest pickup day?" (their last move: "$480, Saturday" {"amount":480})',
        "Out of turns (1):",
        '- 5e6f7a8b with Dan\'s Agent — 10 turns, still open (their last move: "$500")',
        "Failed (1):",
        "- local:x — fetch failed",
        "Not resumed (1):",
        "- abcd — already ended (completed)",
      ].join("\n"),
    );
  });

  test("an empty batch says so", () => {
    expect(digest([])).toBe("No negotiations.");
  });
});

function tool(name: string) {
  const found = negotiationTools().find((t) => t.name === name) as Tool<never> | undefined;
  if (!found?.run) throw new Error(`no tool ${name}`);
  return found;
}

describe("negotiate_many / negotiate_resume", () => {
  test("runs every target concurrently and returns one digest", async () => {
    const a = serve(new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }));
    const b = serve(new Agent({ ...seller, identity: { name: "Seller B", id: "did:example:b" }, negotiator: scripted([{ action: "reject", message: "No." }]).negotiator }));
    try {
      const client = scripted([{ action: "propose", message: "$400." }]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const context = { agent: agent as unknown as Agent, negotiations: new Map<string, NegotiationSession>() };

      const text = (await tool("negotiate_many").run!(
        { targets: [{ url: a.url, objective: "a" }, { url: b.url, objective: "b" }] } as never,
        context,
      )) as string;

      expect(text).toStartWith("Settled (2):");
      expect(text).toContain("with Seller —");
      expect(text).toContain("with Seller B —");
      expect(context.negotiations.size).toBe(2);
    } finally {
      a.stop();
      b.stop();
    }
  });

  test("one unreachable target does not sink the others", async () => {
    const a = serve(new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }));
    try {
      const agent = new Agent({ ...buyer, negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator });
      const context = { agent: agent as unknown as Agent, negotiations: new Map<string, NegotiationSession>() };

      const text = (await tool("negotiate_many").run!(
        { targets: [{ url: a.url, objective: "a" }, { url: "http://127.0.0.1:1", objective: "b" }] } as never,
        context,
      )) as string;

      expect(text).toContain("Settled (1):");
      expect(text).toContain("Failed (1):");
    } finally {
      a.stop();
    }
  });

  test("resume fans one answer out to several ids", async () => {
    const mk = () => scripted([{ action: "counter", message: "$480?" }, { action: "accept", message: "OK." }]);
    const a = serve(new Agent({ ...seller, negotiator: mk().negotiator }));
    const b = serve(new Agent({ ...seller, identity: { name: "Seller B", id: "did:example:b" }, negotiator: mk().negotiator }));
    try {
      // Two negotiations interleave on one scripted client, so the script
      // is symmetric: propose, ask, then counter for whichever comes next.
      const client = scripted([
        { action: "propose", message: "$400?" },
        { action: "propose", message: "$400?" },
        { action: "ask", message: "Ceiling?" },
        { action: "ask", message: "Ceiling?" },
        { action: "counter", message: "$450." },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const context = { agent: agent as unknown as Agent, negotiations: new Map<string, NegotiationSession>() };

      const first = (await tool("negotiate_many").run!(
        { targets: [{ url: a.url, objective: "a" }, { url: b.url, objective: "b" }] } as never,
        context,
      )) as string;
      expect(first).toContain("Waiting on you (2)");
      const ids = [...context.negotiations.keys()];

      const second = (await tool("negotiate_resume").run!(
        { ids, guidance: "Bob's ceiling is $460" } as never,
        context,
      )) as string;

      expect(second).toStartWith("Settled (2):");
      const after = client.calls.slice(4);
      expect(after.every((c) => c.state.party.objective.includes("ceiling is $460"))).toBe(true);
      expect(after).toHaveLength(2);
    } finally {
      a.stop();
      b.stop();
    }
  });
});
