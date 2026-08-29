import { afterEach, describe, expect, test } from "bun:test";
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
import { MemoryNegotiationStore } from "./sessions.ts";

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

  test("negotiate_open and negotiate_turn offer ask too, and park instead of committing", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "counter", message: "No." }]).negotiator }),
    );
    try {
      const client = scripted([{ action: "propose", message: "$400?" }, { action: "ask", message: "Ceiling?" }]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      const negotiations = new Map<string, NegotiationSession>();
      const first = await agent.openNegotiation(url, {}, { negotiations });
      const second = await agent.continueNegotiation(first.id, {}, { negotiations });

      const offered = client.calls.map((c) =>
        c.options.allowedActions.map((a) => (typeof a === "string" ? a : a.action)),
      );
      expect(offered).toEqual([
        ["propose", "counter", "accept", "reject", "ask"],
        ["propose", "counter", "accept", "reject", "ask"],
      ]);

      // The second turn asked instead of sending — parked, not on the wire.
      expect(second.asking).toEqual({ question: "Ceiling?" });
      expect(second.done).toBe(false);
      expect(negotiations.get(first.id)?.pending).toEqual({ question: "Ceiling?" });
    } finally {
      stop();
    }
  });

  test("negotiate() itself still never offers ask — no loop to answer one", async () => {
    const { url, stop } = serve(
      new Agent({ ...seller, negotiator: scripted([{ action: "accept", message: "Deal." }]).negotiator }),
    );
    try {
      const client = scripted([{ action: "propose", message: "$400?" }]);
      const agent = new Agent({ ...buyer, negotiator: client.negotiator });
      await agent.negotiate(url);

      const offered = client.calls[0]?.options.allowedActions.map((a) =>
        typeof a === "string" ? a : a.action,
      );
      expect(offered).toEqual(["propose", "counter", "accept", "reject"]);
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

  test("negotiate_turn refuses a negotiation parked before its first turn", async () => {
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
        /negotiate_resume/,
      );
    } finally {
      stop();
    }
  });

  test("negotiate_turn after a resume re-key leaves one record entry", async () => {
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

      const resumed = await agent.resumeNegotiation(parked.id, "Sunday at the latest", { negotiations });
      // maxTurns caps the pump, not negotiate_turn: the exchange is still
      // open, which is what makes this a legal negotiate_turn target.
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
        "Skipped (1):",
        "- abcd — already ended (completed)",
      ].join("\n"),
    );
  });

  test("an empty batch says so", () => {
    expect(digest([])).toBe("No negotiations.");
  });
});

/** A Negotiator shared by several concurrently pumped sessions, whose
 * decide() is scripted per session instead of by call order.
 *
 * `scripted()`'s shared call counter assumes one negotiation is in
 * flight at a time; under `Promise.all` two sessions' calls interleave
 * unpredictably. Keying on `state.history.length` doesn't work either —
 * an `ask` is intercepted locally before anything is sent, so it and the
 * decide that follows a resume see the *same* history length. What does
 * stay stable per session is the negotiation's own objective: `objectiveFor`
 * always renders it as "...In this negotiation: <objective>", untouched by
 * whatever guidance gets appended after it. So key each call on that
 * `<objective>` tag and give each session its own sequential index. */
function scriptedBySession(scripts: Record<string, NegotiationDecision[]>) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: { state: NegotiationState; options: DecideOptions<string> }[] = [];
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

      const first = (await tool("negotiate_many").run!(
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

      const second = (await tool("negotiate_resume").run!(
        { ids, guidance: "Bob's ceiling is $460" } as never,
        context,
      )) as string;

      expect(second).toStartWith("Settled (2):");
      // Three sessions × 2 pre-resume calls (propose, ask) each = 6, then
      // the resume drives one more decide per resumed session.
      const after = client.calls.slice(6);
      expect(after).toHaveLength(2);
      expect(after.every((call) => call.state.party.objective.includes("ceiling is $460"))).toBe(true);

      // c was never resumed: still parked, and no call for it ever saw
      // the guidance meant for a and b.
      expect(sessionFor("c").pending).toBeDefined();
      const cCalls = client.calls.filter((call) => call.state.party.objective.includes("In this negotiation: c"));
      expect(cCalls.length).toBeGreaterThan(0);
      expect(cCalls.every((call) => !call.state.party.objective.includes("ceiling is $460"))).toBe(true);
    } finally {
      a.stop();
      b.stop();
      c.stop();
    }
  });
});

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Intercepts only OpenRouter chat calls and replays scripted assistant
 * messages; A2A traffic on local ports passes through. */
function mockModel(replies: Partial<ModelMessage>[]) {
  const requests: { messages: ModelMessage[] }[] = [];
  let call = 0;
  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input);
    if (!url.startsWith("https://openrouter.ai")) {
      return (originalFetch as (i: unknown, x?: RequestInit) => Promise<Response>)(input, init);
    }
    requests.push(JSON.parse(String(init?.body)));
    const message = replies[call] ?? replies.at(-1);
    call++;
    return new Response(JSON.stringify({ choices: [{ message }] }), { status: 200 });
  }) as unknown as typeof fetch;
  return requests;
}

function call(name: string, args: unknown, id = `call_${name}`): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}

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
        { role: "assistant", content: "", tool_calls: [call("negotiate_many", { targets })] },
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
      const event = await second.resumeNegotiation(parked.id, "$460", { negotiations: new Map() });

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

  test("negotiate_many skips a counterparty it is already negotiating with", async () => {
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

      expect(again.kind).toBe("skipped");
      if (again.kind !== "skipped") return;
      // Points at the negotiation that already exists, and at the tool
      // that moves it — a parked one needs the party's answer.
      expect(again.id).toBe(first.id);
      expect(again.reason).toContain("negotiate_resume");
      expect(negotiations.size).toBe(1);
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

      const text = (await tool("negotiate_many").run!(
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
    // actually reaches, the way `examples/06-server.ts` rebuilds and
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

      const instructions = agent.instructions();
      expect(instructions).toContain(`Waiting on your party right now: ${parked.id}`);
      expect(instructions).toContain("negotiate_resume");
      // The failure this prevents: finishing the run with the question
      // still unanswered.
      expect(instructions).toContain("before you report back");
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
  // declined: it had passed URLs to negotiate_many and got back lines
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
        "Waiting on you (1) — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to:",
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
