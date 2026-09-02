import { afterEach, describe, expect, test } from "bun:test";
import type { NegotiationDecision } from "@indexnetwork/a2a/negotiator";

import { Agent } from "./agent.ts";
import { digest } from "./digest.ts";
import { MemoryNegotiationStore } from "./sessions.ts";
import {
  buyer,
  call,
  mockModel,
  restoreFetch,
  scripted,
  scriptedBySession,
  seller,
  serve,
  tool,
} from "./test-helpers.ts";
import type { NegotiationSession, NegotiationStore } from "./types.ts";

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
      expect(negotiations.get(event.id)?.task?.history).toHaveLength(4);
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
    // A server that is up but broken, so the error text is deterministic;
    // a refused connection says different things on different machines.
    const down = Bun.serve({ port: 0, fetch: () => new Response("down", { status: 500 }) });
    const url = down.url.toString();
    try {
      const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });
      const negotiations = new Map<string, NegotiationSession>();
      const event = await agent.runNegotiation(url, {}, { negotiations });

      expect({ event, left: negotiations.size }).toEqual({
        event: {
          kind: "failed",
          id: expect.stringMatching(/^local:/),
          url,
          error: `Failed to fetch agent card from ${url}.well-known/agent-card.json (500)`,
          turns: 0,
        },
        // Nothing to resume, so nothing is left behind.
        left: 0,
      });
    } finally {
      down.stop(true);
    }
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

  test("only the pump offers ask — the one-turn methods and negotiate() have no loop to answer one", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "No." }]).negotiator }),
    );
    try {
      const client = scripted([{ action: "propose", message: "$400?" }]);
      // One turn each, so every method decides exactly once.
      const agent = new Agent({ ...buyer, negotiator: client.negotiator, maxTurns: 1 });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      await agent.continueNegotiation(first.id, {}, { negotiations });
      await agent.negotiate(url);
      await agent.runNegotiation(url, {}, { negotiations: new Map() });

      const offered = client.calls.map((c) =>
        c.options.allowedActions.map((a) => (typeof a === "string" ? a : a.action)),
      );
      const plain = ["propose", "counter", "accept", "reject"];
      expect(offered).toEqual([plain, plain, plain, [...plain, "ask"]]);
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

      const event = await agent.answer(parked.id, "Bob can do Sunday at the latest", {
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

      const event = await agent.answer(parked.id, "$450", { negotiations });

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
      const before = negotiations.get(settled.id)?.task?.status.state;

      const ended = await agent.answer(settled.id, "go lower", { negotiations });
      const unknown = await agent.answer("nope", "go lower", { negotiations });

      // One assertion over both, so a wrong `kind` can't hide a wrong
      // `reason` behind a narrowing guard that never runs.
      expect({ ended, unknown, after: negotiations.get(settled.id)?.task?.status.state }).toEqual({
        ended: {
          kind: "skipped",
          id: settled.id,
          peer: "Seller",
          url,
          reason: "already ended (completed) — open a new negotiation if the terms need to change.",
        },
        unknown: { kind: "skipped", id: "nope", peer: undefined, reason: 'No negotiation "nope".' },
        // Nothing was walked backwards.
        after: before,
      });
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

  test("continueNegotiation refuses a negotiation parked before its first turn", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }),
    );
    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "ask", message: "What is Bob's ceiling?" }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const parked = await agent.runNegotiation(url, {}, { negotiations });
      expect(parked.kind).toBe("asking");

      await expect(agent.continueNegotiation(parked.id, {}, { negotiations })).rejects.toThrow(
        `Negotiation "${parked.id}" is waiting on your party ("What is Bob's ceiling?") — give them the answer with the answer tool, which keeps it for the rest of the negotiation.`,
      );
    } finally {
      stop();
    }
  });

  test("continueNegotiation after a resume re-key leaves one record entry", async () => {
    // Ask on the very first turn, before anything is sent — the case
    // that keys the session under a provisional `local:` id in the store
    // (see "an ask before the first turn gets a local id" above). Only
    // this shape can reveal a stale `local:` entry surviving a re-key:
    // once the first send succeeds the id is already real, and there is
    // nothing provisional left in the store to leak.
    const server = scripted([
      { action: "counter", message: "$480, Saturday?" },
      { action: "counter", message: "$470?" },
      { action: "accept", message: "Fine." },
    ]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));
    try {
      const sessions = new MemoryNegotiationStore();
      const client = scripted([
        { action: "ask", message: "Latest pickup day?" },
        { action: "counter", message: "$450, Sunday." },
        { action: "counter", message: "$460, Sunday." },
        { action: "accept", message: "Deal." },
      ]);
      const agent = new Agent({ ...buyer, sessions, maxTurns: 2, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      const parked = await agent.runNegotiation(url, {}, { negotiations });
      expect(parked.kind).toBe("asking");
      expect(parked.id).toStartWith("local:");

      const resumed = await agent.answer(parked.id, "Sunday at the latest", { negotiations });
      // maxTurns caps the pump, not continueNegotiation: the exchange is
      // still open, which is what makes this a legal one-turn target.
      expect(resumed.kind).toBe("budget");
      if (resumed.kind !== "budget") return;

      const taskId = resumed.id;
      expect(taskId).not.toStartWith("local:");

      const turn = await agent.continueNegotiation(taskId, {}, { negotiations });
      expect(turn.done).toBe(true);

      expect(sessions.list()).toHaveLength(1);
      expect([...negotiations.keys()]).toEqual([taskId]);
      expect(agent.instructions().split("\n").filter((l) => l.startsWith("- "))).toHaveLength(1);
    } finally {
      stop();
    }
  });

  test("a send-time failure leaves nothing in the record", async () => {
    const agent = new Agent({ ...buyer, negotiator: scripted([]).negotiator });
    const negotiations = new Map<string, NegotiationSession>();

    const event = await agent.runNegotiation("http://127.0.0.1:1", { discover: false }, { negotiations });

    expect(event.kind).toBe("failed");
    expect(negotiations.size).toBe(0);
    expect(agent.instructions()).not.toContain("local:");
  });
});

describe("answer()", () => {
  /** A store that hands back copies, the way a sqlite-backed one does.
   * With the in-memory store the agent's session and the stored one are
   * the same object, so a save that lands before a mutation still reads
   * back mutated — this store is what makes such a bug visible. */
  function serializingStore(): NegotiationStore {
    const rows = new Map<string, string>();
    return {
      get: (id) => {
        const row = rows.get(id);
        return row ? JSON.parse(row) : undefined;
      },
      save: (session) => {
        rows.delete(session.id);
        rows.set(session.id, JSON.stringify(session));
      },
      list: () => [...rows.values()].map((row) => JSON.parse(row)),
      delete: (id) => {
        rows.delete(id);
      },
    };
  }

  test("an inbound answer reaches the store, not just the object in hand", async () => {
    // Inbound is the path with no later save: the answer is recorded and
    // the counterparty's next call reads it back from the store. If the
    // store were written before the guidance was folded in, the in-memory
    // store would still pass — its session *is* the mutated object — and
    // only a serializing one shows the reply being decided without it.
    const sessions = serializingStore();
    const server = scripted([
      { action: "ask", message: "Would Bob take $450?" },
      { action: "accept", message: "Then $450 it is." },
    ]);
    const { url, stop } = serve(new Agent({ ...seller, sessions, negotiator: server.negotiator }));
    try {
      const caller = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$450?" },
          { action: "counter", message: "Still $450." },
        ]).negotiator,
      });
      const first = await caller.openNegotiation(url);

      // A fresh agent over the same store, as after a restart.
      const second = new Agent({ ...seller, sessions, negotiator: server.negotiator });
      const event = await second.answer(first.id, "Yes, $450 is fine.");
      const stored = sessions.get(first.id);
      const reply = await caller.continueNegotiation(first.id);

      expect({
        event,
        stored: { guidance: stored?.guidance, pending: stored?.pending },
        told: server.calls.map((c) => c.state.party.objective.includes("Yes, $450 is fine.")),
        reply: reply.received?.action,
      }).toEqual({
        event: { kind: "recorded", id: first.id },
        stored: { guidance: ["Yes, $450 is fine."], pending: undefined },
        told: [false, true],
        reply: "accept",
      });
    } finally {
      stop();
    }
  });

  test("an unanswered settlement is answered with a next move, not a dead end", async () => {
    const server = scripted([
      { action: "counter", message: "Still $460." },
      { action: "accept", message: "Fine, $470." },
    ]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));
    try {
      const client = scripted([
        { action: "accept", message: "We accept $460." },
        { action: "counter", message: "$470 then." },
      ]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();

      // This side closed, they countered: the pump stops on the verdict,
      // and the Task is still open.
      const first = await agent.runNegotiation(url, {}, { negotiations });
      const outcome = first.kind === "settled" ? first.settlement?.outcome : first.kind;

      const second = await agent.answer(first.id, "Bob can go to $470", { negotiations });

      expect({
        outcome,
        second: { kind: second.kind, state: second.kind === "settled" ? second.state : undefined },
        told: client.calls.map((c) => c.state.party.objective.includes("Bob can go to $470")),
        guidance: negotiations.get(first.id)?.guidance,
      }).toEqual({
        outcome: "unanswered",
        second: { kind: "settled", state: "completed" },
        told: [false, true],
        guidance: ["Bob can go to $470"],
      });
    } finally {
      stop();
    }
  });

  test("a negotiation out of turns comes straight back as budget, sending nothing", async () => {
    const server = scripted([{ action: "counter", message: "$480?" }]);
    const { url, stop } = serve(new Agent({ ...seller, negotiator: server.negotiator }));
    try {
      const agent = new Agent({
        ...buyer,
        maxTurns: 1,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.runNegotiation(url, {}, { negotiations });
      const second = await agent.answer(first.id, "go to $450", { negotiations });

      // The cap is per negotiation, read from the Task; the guidance is
      // kept for a host that raises it.
      expect({
        first: first.kind,
        second: { kind: second.kind, turns: second.kind === "budget" ? second.turns : undefined },
        serverCalls: server.calls.length,
        guidance: negotiations.get(first.id)?.guidance,
      }).toEqual({
        first: "budget",
        second: { kind: "budget", turns: 1 },
        serverCalls: 1,
        guidance: ["go to $450"],
      });
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
        "Waiting on you (1) — ask your party once with ask_user, then call answer with every id the answer applies to:",
        '- 1a2b3c4d with Carol\'s Agent — asks: "Latest pickup day?" (their last move: "$480, Saturday" {"amount":480})',
        "Out of turns (1):",
        '- 5e6f7a8b with Dan\'s Agent — 10 turns, still open (their last move: "$500")',
        "Failed (1):",
        "- local:x — fetch failed",
        "Skipped (1):",
        "- abcd — already ended (completed)",
      ].join("\n"),
    );
  });

  test("an empty batch says so", () => {
    expect(digest([])).toBe("No negotiations.");
  });
});

describe("negotiate / answer", () => {
  test("runs every target concurrently and returns one digest", async () => {
    const a = serve(new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator }));
    const b = serve(new Agent({ ...seller, identity: { name: "Seller B", id: "did:example:b" }, negotiator: scripted([{ action: "reject", message: "No." }]).negotiator }));
    try {
      const client = scripted([{ action: "propose", message: "$400." }]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const context = { agent: agent as unknown as Agent, negotiations: new Map<string, NegotiationSession>() };

      const text = (await tool("negotiate").run!(
        { targets: [{ url: a.url, objective: "a" }, { url: b.url, objective: "b" }] } as never,
        context,
      )) as string;

      expect(text).toStartWith("Settled (2):");
      expect(text).toContain(`with Seller (${a.url}) —`);
      expect(text).toContain(`with Seller B (${b.url}) —`);
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

      const text = (await tool("negotiate").run!(
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
    // A third counterparty, parked alongside a and b but never resumed —
    // it should sit untouched, still waiting, while the other two settle.
    const c = serve(new Agent({ ...seller, identity: { name: "Seller C", id: "did:example:c" }, negotiator: mk().negotiator }));
    try {
      // Negotiations interleave on one shared client. `scripted()`'s
      // call-order counter can't tell them apart — whichever session's
      // network round trip resolves first claims the next script entry,
      // so on an unlucky interleaving one session would get a second
      // "propose" and skip straight to a settlement (the seller's second
      // scripted reply is "accept"), never reaching "ask". Script each
      // session (keyed by its own objective, "a"/"b"/"c") independently
      // instead, via `scriptedBySession`.
      const script = [
        { action: "propose", message: "$400?" },
        { action: "ask", message: "Ceiling?" },
        { action: "counter", message: "$450." },
      ];
      const client = scriptedBySession({ a: script, b: script, c: script });
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const context = { agent: agent as unknown as Agent, negotiations: new Map<string, NegotiationSession>() };

      const first = (await tool("negotiate").run!(
        {
          targets: [
            { url: a.url, objective: "a" },
            { url: b.url, objective: "b" },
            { url: c.url, objective: "c" },
          ],
        } as never,
        context,
      )) as string;
      expect(first).toContain("Waiting on you (3)");

      const sessionFor = (tag: string) =>
        [...context.negotiations.values()].find((s) => s.objective.includes(`In this negotiation: ${tag}`))!;
      const ids = [sessionFor("a").id, sessionFor("b").id];

      const second = (await tool("answer").run!(
        { ids, guidance: "Bob's ceiling is $460" } as never,
        context,
      )) as string;

      // Three sessions × 2 pre-resume calls (propose, ask) each = 6, then
      // the answer drives one more decide per answered session — and only
      // those. c was never answered: still parked, and no call for it ever
      // saw the guidance meant for a and b.
      const tagOf = (call: { state: { party: { objective: string } } }) =>
        /In this negotiation: (\S+)/.exec(call.state.party.objective)?.[1];
      const told = (call: { state: { party: { objective: string } } }) =>
        call.state.party.objective.includes("ceiling is $460");
      expect({
        heading: second.split("\n")[0],
        after: client.calls.slice(6).map((call) => [tagOf(call), told(call)]).sort(),
        c: {
          pending: sessionFor("c").pending,
          told: client.calls.filter((call) => tagOf(call) === "c").map(told),
        },
      }).toEqual({
        heading: "Settled (2):",
        after: [["a", true], ["b", true]],
        c: { pending: { question: "Ceiling?" }, told: [false, false] },
      });
    } finally {
      a.stop();
      b.stop();
      c.stop();
    }
  });
});


afterEach(restoreFetch);

describe("through the agent loop", () => {
  test("three negotiations cost the main model one round, not three", async () => {
    const servers = [1, 2, 3].map((n) =>
      serve(
        new Agent({
          ...seller,
          identity: { name: `Seller ${n}`, id: `did:example:s${n}` },
          negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator,
        }),
      ),
    );
    try {
      const targets = servers.map((s, i) => ({ url: s.url, objective: `bike ${i}` }));
      const requests = mockModel([
        { role: "assistant", content: "", tool_calls: [call("negotiate", { targets })] },
        { role: "assistant", content: "All three agreed." },
      ]);
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });

      const result = await agent.run("Buy a bike from whoever will sell.");

      expect(result.end).toBe("done");
      expect(requests).toHaveLength(2);
      const toolResult = requests[1]?.messages.at(-1);
      expect(toolResult?.role).toBe("tool");
      expect(toolResult?.content).toStartWith("Settled (3):");
      expect(result.negotiations).toHaveLength(3);
    } finally {
      for (const s of servers) s.stop();
    }
  });

  test("a negotiation parked in one process resumes in another", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "counter", message: "$480?" },
          { action: "accept", message: "OK." },
        ]).negotiator,
      }),
    );
    try {
      const sessions = new MemoryNegotiationStore();
      const first = new Agent({
        ...buyer,
        sessions,
        negotiator: scripted([
          { action: "propose", message: "$400?" },
          { action: "ask", message: "Ceiling?" },
        ]).negotiator,
      });
      const parked = await first.runNegotiation(url, {}, { negotiations: new Map() });
      expect(parked.kind).toBe("asking");

      const second = new Agent({
        ...buyer,
        sessions,
        negotiator: scripted([{ action: "counter", message: "$450." }]).negotiator,
      });
      const event = await second.answer(parked.id, "$460", { negotiations: new Map() });

      expect(event.kind).toBe("settled");
      expect(sessions.get(parked.id)?.pending).toBeUndefined();
    } finally {
      stop();
    }
  });
});

// A live run showed the loop model, handed a digest with one negotiation
// waiting on its party, re-opening all four counterparties from scratch
// instead of answering — and agreeing with one of them twice, at which
// point the party had bought two bikes. The Task-level invariants all
// held; nothing had told the agent not to, and nothing had stopped it.
describe("one negotiation per counterparty", () => {
  test("opening a second negotiation with a counterparty already open is refused", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "Not yet." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      expect(first.done).toBe(false);

      await expect(agent.openNegotiation(url, {}, { negotiations })).rejects.toThrow(
        /already negotiating with/,
      );
      // Nothing was opened: one negotiation, and the counterparty was
      // never called a second time.
      expect(negotiations.size).toBe(1);
    } finally {
      stop();
    }
  });

  test("a refusal does not block a fresh one — going back with a new offer is the point", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "reject", message: "No thanks." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      expect(first.done).toBe(true);

      const second = await agent.openNegotiation(url, {}, { negotiations });
      expect(second.id).not.toBe(first.id);
      expect(negotiations.size).toBe(2);
    } finally {
      stop();
    }
  });

  // The failure that started this: the agent had *agreed* with a seller,
  // then opened a second negotiation with them and agreed again. Both
  // Tasks were terminal and individually valid; the party had bought the
  // same thing twice.
  test("a deal already closed blocks another negotiation with that counterparty", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "accept", message: "Done at $400.", acceptsOfferId: "offer-400" },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$400?", offerId: "offer-400", terms: { amount: 400 } },
        ]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      expect(first.settlement?.outcome).toBe("agreed");

      await expect(agent.openNegotiation(url, {}, { negotiations })).rejects.toThrow(
        /already closed with/,
      );
      expect(negotiations.size).toBe(1);
    } finally {
      stop();
    }
  });

  test("a deal for one intent leaves the same counterparty open for another", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([
          { action: "accept", message: "Done at $400.", acceptsOfferId: "offer-400" },
        ]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$400?", offerId: "offer-400", terms: { amount: 400 } },
        ]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();

      const bike = agent.for({ statement: "Buy a used road bike" });
      const closed = await bike.openNegotiation(url, {}, { negotiations });
      expect(closed.settlement?.outcome).toBe("agreed");

      // Same counterparty, different thing entirely. Buying a bike from
      // someone is no reason not to negotiate a desk with them.
      const desk = agent.for({ statement: "Buy a standing desk" });
      const second = await desk.openNegotiation(url, {}, { negotiations });

      expect(second.id).not.toBe(closed.id);
      expect(negotiations.size).toBe(2);
    } finally {
      stop();
    }
  });

  test("negotiate skips a counterparty it is already negotiating with", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "$480?" }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$400?" },
          { action: "ask", message: "Ceiling?" },
        ]).negotiator,
      });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.runNegotiation(url, {}, { negotiations });
      expect(first.kind).toBe("asking");

      const again = await agent.runNegotiation(url, {}, { negotiations });

      // Points at the negotiation that already exists, and at the tool
      // that moves it — a parked one needs the party's answer.
      expect({ again, size: negotiations.size }).toEqual({
        again: {
          kind: "skipped",
          id: first.id,
          peer: "Seller",
          url,
          reason: `You are already negotiating with Seller ("${first.id}"). It is waiting on your party: "Ceiling?" — give them the answer with the answer tool, rather than opening a second one: both would settle independently, and your party would be committed twice.`,
        },
        size: 1,
      });
    } finally {
      stop();
    }
  });

  // The risk in refusing a second negotiation is refusing too much. What
  // follows fixes the boundaries: a negotiation that never started is no
  // obstacle, and `negotiate()` — where every call is deliberately its
  // own exchange — is not affected at all.
  test("a failed open leaves nothing behind, so trying again is allowed", async () => {
    const agent = new Agent({
      ...buyer,
      negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
    });
    const negotiations = new Map<string, NegotiationSession>();

    const first = await agent.runNegotiation("http://127.0.0.1:1", { discover: false }, { negotiations });
    const again = await agent.runNegotiation("http://127.0.0.1:1", { discover: false }, { negotiations });

    expect(first.kind).toBe("failed");
    // Not "skipped": there is nothing to continue, so a retry is the only
    // thing left and refusing it would strand the counterparty for good.
    expect(again.kind).toBe("failed");
  });

  test("negotiate() is unaffected — each call is its own exchange", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });

      const one = await agent.negotiate(url, { maxTurns: 2 });
      const two = await agent.negotiate(url, { maxTurns: 2 });

      expect(one.task.id).not.toBe(two.task.id);
    } finally {
      stop();
    }
  });

  test("an unfinished negotiation blocks even with no context map, from the store", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "Not yet." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      await agent.openNegotiation(url, {}, { negotiations: new Map() });

      // A host that keeps no per-run map still gets the guard: the store
      // is the record either way.
      await expect(agent.openNegotiation(url)).rejects.toThrow(/already negotiating with/);
    } finally {
      stop();
    }
  });

  test("the same counterparty twice in one batch opens one negotiation", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      const context = {
        agent: agent as unknown as Agent,
        negotiations: new Map<string, NegotiationSession>(),
      };

      const text = (await tool("negotiate").run!(
        { targets: [{ url, objective: "a" }, { url, objective: "again" }] } as never,
        context,
      )) as string;

      expect(text).toContain("Settled (1):");
      expect(text).toContain("Skipped (1):");
      expect(context.negotiations.size).toBe(1);
    } finally {
      stop();
    }
  });
});

// A live run once had one party's agent dial a counterparty while that
// same counterparty's agent was mid-dial back for the same real deal —
// each side settled its own Task without the other ever seeing it. These
// guard the same-agent case `rivalNegotiationWith` alone can't catch: an
// inbound negotiation carries no return address, so it can only be
// correlated by intent, not by counterparty.
describe("cross-direction rivals (the same deal, from the other side)", () => {
  test("an unfinished inbound negotiation blocks opening an outbound one under the same intent", async () => {
    const middle = new Agent({
      ...buyer,
      negotiator: scripted([{ action: "counter", message: "Not yet." }]).negotiator,
    }).for({ statement: "Buy a used road bike" });
    const { url: middleUrl, stop: stopMiddle } = serve(middle);

    try {
      const caller = new Agent({
        ...seller,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });
      const opened = await caller.openNegotiation(middleUrl);
      expect(opened.done).toBe(false);

      await expect(
        middle.openNegotiation("http://127.0.0.1:1", { discover: false }),
      ).rejects.toThrow(/already negotiating this with you/);
    } finally {
      stopMiddle();
    }
  });

  test("an unfinished outbound negotiation blocks accepting a new inbound one under the same intent", async () => {
    const { url: sellerUrl, stop: stopSeller } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "Not yet." }]).negotiator }),
    );
    const middle = new Agent({
      ...buyer,
      negotiator: scripted([{ action: "counter", message: "Sure, what's your offer?" }]).negotiator,
    }).for({ statement: "Buy a used road bike" });
    const { url: middleUrl, stop: stopMiddle } = serve(middle);

    try {
      const opened = await middle.openNegotiation(sellerUrl);
      expect(opened.done).toBe(false);

      const caller = new Agent({
        ...seller,
        negotiator: scripted([{ action: "propose", message: "$390?" }]).negotiator,
      });
      // Refused over the wire (409), before `middle`'s handler ever
      // creates a Task for it — the message is worded for whoever called
      // in, not for `middle`'s own model, so it doesn't echo
      // `secondNegotiationRefusal`'s tool names.
      await expect(caller.openNegotiation(middleUrl)).rejects.toThrow(/already has an unfinished negotiation/);
    } finally {
      stopSeller();
      stopMiddle();
    }
  });

  test("a different intent is not a rival, in either direction", async () => {
    const { url: sellerUrl, stop: stopSeller } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "Not yet." }]).negotiator }),
    );
    const middle = new Agent({
      ...buyer,
      negotiator: scripted([{ action: "counter", message: "Sure." }]).negotiator,
    }).for({ statement: "Buy a used road bike" });
    const { url: middleUrl, stop: stopMiddle } = serve(middle);

    // Same identity and session store, rescoped to something unrelated and
    // served on its own port — `for()` is a lens, not a new agent, but a
    // host that rescopes what's listening swaps which intent a caller
    // actually reaches, the way `examples/06-persistence.ts` rebuilds and
    // re-serves an agent whenever its intent changes.
    const desk = middle.for({ statement: "Buy a standing desk" });
    const { url: deskUrl, stop: stopDesk } = serve(desk);

    try {
      const opened = await middle.openNegotiation(sellerUrl);
      expect(opened.done).toBe(false);

      // The inbound caller reaches `desk`'s scope, not the bike one — the
      // bike negotiation open on `middle` is not a rival to it.
      const caller = new Agent({
        ...seller,
        negotiator: scripted([{ action: "propose", message: "$50?" }]).negotiator,
      });
      const inbound = await caller.openNegotiation(deskUrl);
      expect(inbound.done).toBe(false);
    } finally {
      stopSeller();
      stopMiddle();
      stopDesk();
    }
  });

  test("an inbound negotiation that ended with no deal frees the intent up again", async () => {
    const middle = new Agent({
      ...buyer,
      negotiator: scripted([{ action: "reject", message: "Not interested." }]).negotiator,
    }).for({ statement: "Buy a used road bike" });
    const { url: middleUrl, stop: stopMiddle } = serve(middle);

    try {
      const caller = new Agent({
        ...seller,
        negotiator: scripted([{ action: "propose", message: "$400?" }]).negotiator,
      });
      const opened = await caller.openNegotiation(middleUrl);
      expect(opened.done).toBe(true);

      // Declined, not agreed — the counterparty's rejection frees `middle`
      // to dial someone else about the same intent. The dial itself still
      // fails (nothing is listening on :1); the point is *why* it fails —
      // not refused as a rival.
      const outbound = await middle
        .openNegotiation("http://127.0.0.1:1", { discover: false })
        .catch((e) => e as Error);
      expect(outbound).toBeInstanceOf(Error);
      expect((outbound as Error).message).not.toMatch(/already negotiating this with you/);
    } finally {
      stopMiddle();
    }
  });
});

describe("the record says what to do next", () => {
  test("a parked negotiation is named, with the tool that answers it", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "counter", message: "$480." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([
          { action: "propose", message: "$400?" },
          { action: "ask", message: "Ceiling?" },
        ]).negotiator,
      });
      const parked = await agent.runNegotiation(url, {}, { negotiations: new Map() });

      // The failure this prevents: finishing the run with the question
      // still unanswered.
      expect(agent.instructions()).toContain(
        `Waiting on your party right now: ${parked.id}. Ask with ask_user, then call answer with every id the answer applies to — before you report back, not after.`,
      );
    } finally {
      stop();
    }
  });

  test("nothing parked, nothing to chase", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      await agent.runNegotiation(url, {}, { negotiations: new Map() });

      expect(agent.instructions()).not.toContain("Waiting on your party right now");
    } finally {
      stop();
    }
  });
});

describe("digest lines name the counterparty's URL", () => {
  // A live run misread its own digest and recommended a seller that had
  // declined: it had passed URLs to negotiate and got back lines
  // keyed by id and name, with nothing to join them on.
  test("the URL each result came from is on the line", () => {
    const text = digest([
      {
        kind: "settled",
        id: "61b3061c",
        peer: "Alice's Agent",
        url: "http://localhost:8101",
        state: "completed",
        turns: 3,
        settlement: { outcome: "agreed", basis: "terms", reason: "", terms: { amount: 460 } } as never,
      },
      {
        kind: "asking",
        id: "1a2b3c4d",
        peer: "Carol's Agent",
        url: "http://localhost:8102",
        turns: 1,
        question: "Latest pickup day?",
        last: null,
      },
    ]);

    expect(text).toBe(
      [
        "Settled (1):",
        '- 61b3061c with Alice\'s Agent (http://localhost:8101) — agreed: {"amount":460}',
        "Waiting on you (1) — ask your party once with ask_user, then call answer with every id the answer applies to:",
        '- 1a2b3c4d with Carol\'s Agent (http://localhost:8102) — asks: "Latest pickup day?"',
      ].join("\n"),
    );
  });

  test("events carry the URL they negotiated against", async () => {
    const { url, stop } = serve(
      new Agent({
        ...seller,
        negotiator: scripted([{ action: "accept", message: "Yes." }]).negotiator,
      }),
    );

    try {
      const agent = new Agent({
        ...buyer,
        negotiator: scripted([{ action: "propose", message: "$400." }]).negotiator,
      });
      const event = await agent.runNegotiation(url, {}, { negotiations: new Map() });

      expect(event.url).toBe(url);
      expect(digest([event])).toContain(`(${url})`);
    } finally {
      stop();
    }
  });
});

describe("an unanswered settlement points back to answer", () => {
  // `unanswered` is the one Settled outcome where the Task is still open —
  // this side closed and the counterparty kept talking. Read like every
  // other Settled line it looks finished; a model that believed that once
  // left the exchange open forever, since a fresh negotiation with the
  // same counterparty is refused as a rival of the very session it just
  // walked away from.
  test("carries a hint distinct from a real terminal outcome", () => {
    const text = digest([
      {
        kind: "settled",
        id: "56d1e4cf",
        peer: "Seller",
        url: "http://localhost:8101",
        state: "input-required",
        turns: 1,
        settlement: {
          outcome: "unanswered",
          basis: "state",
          reason: 'You closed with "accept", but they replied with "counter" rather than closing too.',
        } as never,
      },
    ]);

    // The whole line: a terminal outcome's line (see "groups events" above)
    // carries no such hint, and this is what distinguishes the two.
    expect(text).toBe(
      [
        "Settled (1):",
        '- 56d1e4cf with Seller (http://localhost:8101) — unanswered: You closed with "accept", but they replied with "counter" rather than closing too. — the exchange is still open; answer this id with how to respond to their last move, do not open a new one',
      ].join("\n"),
    );
  });
});
