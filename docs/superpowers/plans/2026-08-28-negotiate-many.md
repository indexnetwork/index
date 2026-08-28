# Fan-out Negotiations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the agent run N negotiations concurrently, each in its own loop, and hear back once per tool call as a digest — settled, waiting on the party, out of turns, failed — instead of once per turn.

**Architecture:** `Agent` gains `runNegotiation()` (open and pump one negotiation to an event) and `resumeNegotiation()` (fold in the party's answer and pump again). A negotiation under the pump may decide `ask`, which a strategy wrapper intercepts *before* the wire and turns into a parked session. Two new tools, `negotiate_many` and `negotiate_resume`, fan out over `Promise.all` and render events through one `digest()` formatter. Existing `negotiate_open`/`negotiate_turn`/`negotiate()` are untouched.

**Tech Stack:** Bun, TypeScript, `@indexnetwork/negotiator` (A2A client, `DecisionStrategy`, `verifyAgreement`), `bun test`.

**Spec:** `docs/superpowers/specs/2026-08-28-negotiate-many-design.md`

## Global Constraints

- Build the sibling first: `cd ../negotiator && bun run build` — `file:../negotiator` resolves to its `dist/`.
- `bun test` must stay green and network-free; counterparties are served on `port: 0`, model calls are scripted.
- `bun run typecheck` must pass after every task.
- Do not touch `../negotiator`. Everything here uses its existing `allowedActions` and `strategy` seams.
- Invariants from `CLAUDE.md` hold: the Task is the record; settled stays settled; the agent holds no state; one clock; retries only in `ModelClient`.
- Per `CLAUDE.md`: after a test passes, break the code and check the test fails. Each task names the break.
- Commit messages end with `Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF`.
- Deviation from spec, deliberate: `negotiate()` is **not** rewritten as a wrapper. It keeps its transcript/artifact collection and its tests.

## File Structure

| File | Responsibility |
|---|---|
| `src/core/types.ts` | `NegotiationSession.pending` / `.guidance`; `NegotiationEvent` union; `NegotiationStore.delete?` |
| `src/core/sessions.ts` | `MemoryNegotiationStore.delete()` |
| `src/core/agent.ts` | `ASK_ACTION`, `Escalation`, `takeTurn(..., escalate)`, `runNegotiation()`, `resumeNegotiation()`, `record()` showing parked sessions |
| `src/core/digest.ts` (new) | `digest(events): string` — the one place events become text |
| `src/core/tools.ts` | `negotiate_many`, `negotiate_resume` |
| `src/core/fanout.test.ts` (new) | All tests for the above |
| `src/index.ts` | Export `NegotiationEvent`, `digest` |
| `README.md`, `CLAUDE.md` | Docs, test count |

---

### Task 1: Events, the pump, and `runNegotiation()` (no escalation yet)

**Files:**
- Modify: `src/core/types.ts` (after `NegotiationTurn`, ~line 244)
- Modify: `src/core/agent.ts` (after `continueNegotiation`, ~line 688)
- Create: `src/core/fanout.test.ts`

**Interfaces:**
- Produces: `type NegotiationEvent<A>`; `Agent.runNegotiation(url, options?: OpenNegotiationOptions, context?): Promise<NegotiationEvent<A>>`; private `Agent.pump(session, context?): Promise<NegotiationEvent<A>>`; helper `lastPeerDecision(session)`.

- [ ] **Step 1: Add the event type**

In `src/core/types.ts`, after `NegotiationTurn`:

```ts
/**
 * What a negotiation run under the fan-out pump reports when it stops.
 * One event per negotiation per tool call; the turns in between never
 * reach the agent loop. `failed` is an event rather than a throw so one
 * refused connection does not sink the other negotiations in the batch.
 */
export type NegotiationEvent<A extends string = string> =
  | {
      kind: "settled";
      id: string;
      peer?: string;
      state: A2ATaskState;
      settlement?: Settlement<A>;
      turns: number;
    }
  | {
      kind: "asking";
      id: string;
      peer?: string;
      question: string;
      /** The counterparty's most recent move, so the party can be told
       * what is on the table when asked. */
      last: NegotiationDecision<A> | null;
      turns: number;
    }
  | { kind: "budget"; id: string; peer?: string; last: NegotiationDecision<A> | null; turns: number }
  | { kind: "failed"; id: string; peer?: string; error: string; turns: number }
  | { kind: "skipped"; id: string; peer?: string; reason: string };
```

`A2ATaskState`, `Settlement`, `NegotiationDecision` are already imported/defined in that file.

- [ ] **Step 2: Write the failing tests**

Create `src/core/fanout.test.ts`:

```ts
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
    calls.push({ state: structuredClone(state), options: structuredClone(options) });
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test src/core/fanout.test.ts`
Expected: FAIL — `agent.runNegotiation is not a function`.

- [ ] **Step 4: Implement `runNegotiation` and `pump`**

In `src/core/agent.ts`, add after `continueNegotiation()` (before `takeTurn`):

```ts
  // --- outbound, run to an event ------------------------------------

  /**
   * Opens a negotiation and pumps it until something the agent loop needs
   * to hear: it settled, it needs the party, it ran out of turns, or it
   * failed. The turns in between never reach the loop. This is what
   * `negotiate_many` runs, one per counterparty, concurrently.
   *
   * The session is keyed under a provisional `local:` id until the
   * counterparty's Task exists, so a negotiation that stops before its
   * first turn can still be found and resumed.
   */
  async runNegotiation(
    url: string,
    options: OpenNegotiationOptions = {},
    context?: Pick<ToolContext, "negotiations" | "signal">,
  ): Promise<NegotiationEvent<A>> {
    const session: NegotiationSession = {
      id: `local:${crypto.randomUUID()}`,
      direction: "outbound",
      url,
      objective: this.objectiveFor(options.objective),
      peer: null,
      task: undefined as unknown as A2ATask,
    };
    context?.negotiations.set(session.id, session);

    if (options.discover !== false) {
      try {
        session.peer = await this.inspect(url, { signal: context?.signal });
      } catch (cause) {
        context?.negotiations.delete(session.id);
        return { kind: "failed", id: session.id, error: describe(cause), turns: 0 };
      }
    }

    return this.pump(session, context);
  }

  /** Takes turns until an event. Turns are counted from the Task, so a
   * session resumed in another process picks up the right count. */
  private async pump(
    session: NegotiationSession,
    context?: Pick<ToolContext, "negotiations" | "signal">,
  ): Promise<NegotiationEvent<A>> {
    const peer = session.peer?.name;

    for (;;) {
      const turns = sentTurns(session);
      if (turns >= this.maxTurns) {
        return { kind: "budget", id: session.id, peer, last: lastPeerDecision(session), turns };
      }

      let turn: NegotiationTurn<A>;
      try {
        turn = await this.takeTurn(session, undefined, context?.signal);
      } catch (cause) {
        return { kind: "failed", id: session.id, peer, error: describe(cause), turns };
      }
      context?.negotiations.set(session.id, session);

      if (turn.done || turn.settlement) {
        return {
          kind: "settled",
          id: session.id,
          peer,
          state: turn.state,
          ...(turn.settlement ? { settlement: turn.settlement } : {}),
          turns: sentTurns(session),
        };
      }
    }
  }
```

Note `takeTurn` already sets `session.id = result.task.id` after the first send. `pump` re-sets the map entry after every turn, so the map ends up holding the Task id; the `local:` key is removed in Task 2 (re-keying), where it starts to matter.

Add the two module-level helpers near `amountsIn`:

```ts
/** How many turns this side has sent. Client-side moves go over the wire
 * with role "user", so the Task history carries the count. */
function sentTurns(session: NegotiationSession): number {
  return session.task?.history.filter((message) => message.role === "user").length ?? 0;
}

/** The counterparty's most recent move, decoded, or null before they have
 * said anything. */
function lastPeerDecision<A extends string>(session: NegotiationSession): NegotiationDecision<A> | null {
  const reply = session.task?.history.findLast((message) => message.role === "agent");
  return reply ? (messageToDecision(reply) as NegotiationDecision<A> | null) : null;
}

function describe(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
```

Add `NegotiationEvent` to the `./types.ts` import in `agent.ts`. Check `A2AMessage.role` is `"user" | "agent"` in `../negotiator/src/a2a/wire/types.ts` before relying on it (`grep -n "role" ../negotiator/src/a2a/wire/types.ts`).

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test src/core/fanout.test.ts && bun run typecheck`
Expected: 3 pass.

- [ ] **Step 6: Break it** — in `pump`, change `if (turn.done || turn.settlement)` to `if (turn.done)` only; the first test still passes (task completes). Change it to `if (false)`: the first test should now fail on `client.calls` length or a thrown "already completed" — confirm it fails, then restore.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/agent.ts src/core/fanout.test.ts
git commit -m "Pump a negotiation to an event instead of a turn

Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF"
```

---

### Task 2: Escalation — the `ask` action, parking, and `resumeNegotiation()`

**Files:**
- Modify: `src/core/types.ts` (`NegotiationSession`, `NegotiationStore`)
- Modify: `src/core/sessions.ts`
- Modify: `src/core/agent.ts` (`takeTurn`, `pump`, new `resumeNegotiation`, `record`)
- Modify: `src/core/fanout.test.ts`

**Interfaces:**
- Consumes: `runNegotiation`, `pump`, `NegotiationEvent` from Task 1.
- Produces: `ASK_ACTION` (exported const), `class Escalation`, `Agent.resumeNegotiation(id: string, guidance: string, context?): Promise<NegotiationEvent<A>>`, `NegotiationSession.pending?: { question: string }`, `NegotiationSession.guidance?: string[]`, `NegotiationStore.delete?(id: string): void`.

- [ ] **Step 1: Extend the session and store types**

In `src/core/types.ts`, inside `NegotiationSession` after `task`:

```ts
  /** Set while the negotiation is parked on a question for the party this
   * agent acts for. Cleared by `resumeNegotiation()`. */
  pending?: { question: string };
  /** Standing guidance from the party, oldest first, folded into the
   * objective of every later turn. Unlike `negotiate_turn`'s per-turn
   * guidance, an answer given to a parked negotiation has to hold for
   * the rest of it. */
  guidance?: string[];
```

Inside `NegotiationStore`:

```ts
  /** Removes a session. Optional: only needed to drop the provisional
   * `local:` key once a parked negotiation has a Task id. A store
   * without it keeps a duplicate line in the record. */
  delete?(id: string): void;
```

In `src/core/sessions.ts`, add to `MemoryNegotiationStore`:

```ts
  delete(id: string): void {
    this.sessions.delete(id);
  }
```

- [ ] **Step 2: Write the failing tests**

Append to `src/core/fanout.test.ts`:

```ts
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
```

- [ ] **Step 3: Run to verify they fail**

Run: `bun test src/core/fanout.test.ts`
Expected: the six new tests fail (`ask` is sent over the wire; `resumeNegotiation` missing).

- [ ] **Step 4: Implement**

In `src/core/agent.ts`, near `DEFAULT_TERMINAL`:

```ts
/**
 * The one action a negotiation under the fan-out pump may take that a
 * one-vs-one turn may not: stop and ask the party. It is intercepted
 * before the wire, so the counterparty never sees it.
 */
export const ASK_ACTION = {
  action: "ask",
  description:
    "use only when your next move depends on something the party you act for has not told you — a limit, a date, a preference. State what you need to know. Nothing is sent to the counterparty",
} as const;

/** Thrown by the pump's strategy wrapper when the negotiator decides to
 * `ask`, so the turn stops before `sendTurn` reaches the network. */
class Escalation extends Error {
  constructor(readonly decision: NegotiationDecision<string>) {
    super(decision.message);
  }
}
```

Change `takeTurn`'s signature and body:

```ts
  private async takeTurn(
    session: NegotiationSession,
    guidance?: string,
    signal?: AbortSignal,
    escalate = false,
  ): Promise<NegotiationTurn<A>> {
    let sent: NegotiationDecision<A> | undefined;

    // Standing guidance from the party holds for the rest of this
    // negotiation; per-turn guidance is for this turn only.
    const standing = session.guidance?.length
      ? `${session.objective}\n\nGuidance from the party you act for:\n${session.guidance.join("\n")}`
      : session.objective;

    // Under the pump, `ask` is on the menu — and taking it throws before
    // anything is sent, which is the whole point of offering it.
    const strategy: DecisionStrategy<A> = escalate
      ? async (negotiator, state, actions, opts) => {
          const decision = await this.strategy(negotiator, state, actions, opts);
          if ((decision.action as string) === ASK_ACTION.action) throw new Escalation(decision);
          return decision;
        }
      : this.strategy;

    const client = new A2ANegotiationClient<A>({
      negotiator: this.negotiator,
      party: {
        name: this.identity.name,
        objective: guidance ? `${standing}\n\nFor this turn: ${guidance}` : standing,
      },
      allowedActions: escalate
        ? [...this.allowedActions, ASK_ACTION as unknown as ActionSpec<A>]
        : this.allowedActions,
      strategy,
      // ...rest of the options exactly as today
```

(Keep everything below the constructor call unchanged.)

In `pump`, pass `true` and catch `Escalation`:

```ts
      let turn: NegotiationTurn<A>;
      try {
        turn = await this.takeTurn(session, undefined, context?.signal, true);
      } catch (cause) {
        if (cause instanceof Escalation) {
          session.pending = { question: cause.decision.message };
          this.sessions.save(session);
          context?.negotiations.set(session.id, session);
          return { kind: "asking", id: session.id, peer, question: cause.decision.message, last: lastPeerDecision(session), turns };
        }
        return { kind: "failed", id: session.id, peer, error: describe(cause), turns };
      }
      // A negotiation parked before its first turn was keyed by a
      // provisional id; now the Task exists, the record uses the real one.
      if (before.startsWith("local:") && session.id !== before) {
        context?.negotiations.delete(before);
        this.sessions.delete?.(before);
      }
      context?.negotiations.set(session.id, session);
```

with `const before = session.id;` declared just before the `try`.

Add `resumeNegotiation` after `runNegotiation`:

```ts
  /**
   * Folds the party's answer into a parked negotiation and pumps it on.
   * Refusals are `skipped` events rather than throws, so a batch of
   * resumes reports every id.
   */
  async resumeNegotiation(
    id: string,
    guidance: string,
    context?: Pick<ToolContext, "negotiations" | "signal">,
  ): Promise<NegotiationEvent<A>> {
    const session = context?.negotiations.get(id) ?? this.sessions.get(id);
    const skip = (reason: string): NegotiationEvent<A> => ({
      kind: "skipped",
      id,
      peer: session?.peer?.name,
      reason,
    });

    if (!session) return skip(`No negotiation "${id}".`);
    if (session.direction === "inbound") {
      return skip("They contacted you; you answer their turns as they arrive.");
    }
    const state = session.task?.status.state;
    if (state && isTerminalTaskState(state)) {
      return skip(`already ended (${state}) — open a new negotiation if the terms need to change.`);
    }
    if (!session.pending) return skip("not waiting on you.");

    session.guidance = [...(session.guidance ?? []), guidance];
    delete session.pending;
    this.sessions.save(session);
    context?.negotiations.set(session.id, session);
    return this.pump(session, context);
  }
```

In `record()`, replace the `detail` expression:

```ts
      const detail = session.pending
        ? `waiting on your guidance: ${JSON.stringify(session.pending.question)}`
        : agreement.status === "open"
          ? `still open, ${session.task?.history.length ?? 0} turns so far`
          : `${agreement.status}${terms}`;
```

`record()` calls `verifyAgreement(session.task)`; a parked-before-open session has no task. Guard: `const agreement = session.task ? verifyAgreement(session.task) : { status: "open" as const };` — check `AgreementResult`'s shape in `../negotiator` and match the minimal fields `record()` reads (`status`, `terms`).

Add `DecisionStrategy` and `ActionSpec` to the negotiator imports in `agent.ts` if not already there.

- [ ] **Step 5: Run tests and typecheck**

Run: `bun test && bun run typecheck`
Expected: all pass, including the existing suite.

- [ ] **Step 6: Break it** — delete the `throw new Escalation(decision)` line. "an ask parks the negotiation and sends nothing" must fail on `server.calls` length (2, not 1). Restore. Then remove the `standing` guidance fold: "resume folds the answer" must fail on `seen`. Restore.

- [ ] **Step 7: Commit**

```bash
git add src/core/types.ts src/core/sessions.ts src/core/agent.ts src/core/fanout.test.ts
git commit -m "Let a pumped negotiation stop and ask its party

Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF"
```

---

### Task 3: The digest

**Files:**
- Create: `src/core/digest.ts`
- Create: tests in `src/core/fanout.test.ts` (append)

**Interfaces:**
- Consumes: `NegotiationEvent`.
- Produces: `digest(events: NegotiationEvent[]): string`.

- [ ] **Step 1: Write the failing test**

Append to `src/core/fanout.test.ts`:

```ts
import { digest } from "./digest.ts";

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
```

Move the `import { digest }` line to the top of the file with the other imports.

- [ ] **Step 2: Run to verify it fails**

Run: `bun test src/core/fanout.test.ts -t digest`
Expected: FAIL — cannot resolve `./digest.ts`.

- [ ] **Step 3: Implement**

Create `src/core/digest.ts`:

```ts
import type { NegotiationDecision } from "@indexnetwork/negotiator";
import type { NegotiationEvent } from "./types.ts";

/**
 * What the agent loop hears back from a batch of negotiations: one line
 * per negotiation, grouped by what it needs. This is the whole of what
 * crosses from the pump to the loop, so it carries exactly what the loop
 * can act on — a verdict, a question, an offer to compare — and nothing
 * that only the negotiator needed.
 */
export function digest(events: NegotiationEvent[]): string {
  if (!events.length) return "No negotiations.";

  const groups: [heading: string, kind: NegotiationEvent["kind"]][] = [
    ["Settled", "settled"],
    ["Waiting on you", "asking"],
    ["Out of turns", "budget"],
    ["Failed", "failed"],
    ["Not resumed", "skipped"],
  ];

  const sections: string[] = [];
  for (const [heading, kind] of groups) {
    const members = events.filter((event) => event.kind === kind);
    if (!members.length) continue;
    const hint =
      kind === "asking"
        ? " — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to"
        : "";
    sections.push(`${heading} (${members.length})${hint}:`, ...members.map(line));
  }
  return sections.join("\n");
}

function line(event: NegotiationEvent): string {
  const who = event.peer ? ` with ${event.peer}` : "";
  const head = `- ${event.id}${who} — `;
  switch (event.kind) {
    case "settled": {
      if (!event.settlement) return `${head}ended (${event.state})`;
      const { outcome, terms, reason } = event.settlement;
      const detail = terms ? JSON.stringify(terms) : reason;
      return `${head}${outcome}${detail ? `: ${detail}` : ""}`;
    }
    case "asking":
      return `${head}asks: ${JSON.stringify(event.question)}${lastMove(event.last)}`;
    case "budget":
      return `${head}${event.turns} turns, still open${lastMove(event.last)}`;
    case "failed":
      return `${head}${event.error}`;
    case "skipped":
      return `${head}${event.reason}`;
  }
}

function lastMove(decision: NegotiationDecision | null): string {
  if (!decision) return "";
  const terms = decision.terms ? ` ${JSON.stringify(decision.terms)}` : "";
  return ` (their last move: ${JSON.stringify(decision.message)}${terms})`;
}
```

Check the `Settlement` field names (`outcome`, `terms`, `reason`) against `src/core/types.ts` before relying on them.

- [ ] **Step 4: Run tests and typecheck**

Run: `bun test src/core/fanout.test.ts && bun run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/core/digest.ts src/core/fanout.test.ts
git commit -m "Render a batch of negotiation events as one digest

Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF"
```

---

### Task 4: `negotiate_many` and `negotiate_resume`

**Files:**
- Modify: `src/core/tools.ts` (`negotiationTools`)
- Modify: `src/core/fanout.test.ts`

**Interfaces:**
- Consumes: `Agent.runNegotiation`, `Agent.resumeNegotiation`, `digest`.
- Produces: tools named `negotiate_many` `{ targets: { url, objective }[] }` and `negotiate_resume` `{ ids: string[], guidance: string }`, both returning the digest string; included in `negotiationTools()` and so in `defaultTools()`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/fanout.test.ts` (add `import { negotiationTools, type Tool } from "./tools.ts";` and `import type { ModelMessage, ToolCall } from "./model.ts";` at the top):

```ts
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
```

Note on the third test: `Promise.all` interleaving means the propose/ask order across the two sessions is not fixed, but each session consumes exactly one `propose` then one `ask` before resume, so a script of two proposes then two asks works regardless of order only if both proposes are decided before either ask. They are: each session's first `decide` happens before its first network round trip returns. If this proves flaky, replace `scripted` for this test with a per-session script keyed on `state.history.length` (0 → propose, 1 → ask, 2 → counter).

- [ ] **Step 2: Run to verify they fail**

Run: `bun test src/core/fanout.test.ts -t "negotiate_many"`
Expected: FAIL — `no tool negotiate_many`.

- [ ] **Step 3: Implement the tools**

In `src/core/tools.ts`, import `digest` from `./digest.ts` and add inside `negotiationTools()` before the `return`:

```ts
  const many: Tool<{ targets: { url: string; objective: string }[] }> = {
    name: "negotiate_many",
    description:
      "Open negotiations with several agents at once and run each one on its own until it settles, needs something only the party you represent can tell you, or runs out of turns. Returns one digest with a line per negotiation. Prefer this over negotiate_open whenever there is more than one counterparty: you only hear about what needs you. For lines under 'Waiting on you', ask your party once with ask_user, then call negotiate_resume with every id the answer applies to." +
      SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "The counterparty agent's A2A base URL." },
              objective: {
                type: "string",
                description: "What to achieve with this counterparty specifically.",
              },
            },
            required: ["url", "objective"],
          },
        },
      },
      required: ["targets"],
    },
    run: async ({ targets }, context) =>
      digest(
        await Promise.all(
          targets.map((target) =>
            context.agent.runNegotiation(
              target.url,
              { objective: target.objective, discover: options.discover },
              context,
            ),
          ),
        ),
      ),
  };

  const resume: Tool<{ ids: string[]; guidance: string }> = {
    name: "negotiate_resume",
    description:
      "Give parked negotiations the answer they were waiting for and run them on. Pass every id the answer applies to; the guidance holds for the rest of each negotiation. Returns the same digest as negotiate_many. A negotiation that has already ended is not resumed — open a new one if the terms need to change." +
      SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Negotiation ids from the digest." },
        guidance: {
          type: "string",
          description: "What your party said, as it applies to these negotiations, e.g. 'Bob's ceiling is $460 and he can collect Sunday'.",
        },
      },
      required: ["ids", "guidance"],
    },
    run: async ({ ids, guidance }, context) =>
      digest(
        await Promise.all(ids.map((id) => context.agent.resumeNegotiation(id, guidance, context))),
      ),
  };

  return [open as Tool<never>, turn as Tool<never>, many as Tool<never>, resume as Tool<never>];
```

`ToolContext.negotiations` is a `Map`, and `runNegotiation`/`resumeNegotiation` take `Pick<ToolContext, "negotiations" | "signal">`, so `context` passes straight through.

- [ ] **Step 4: Run the whole suite and typecheck**

Run: `bun test && bun run typecheck`
Expected: PASS. Existing tests that count tools or list tool names (grep `negotiate_turn` in `loop.test.ts` and `agent.test.ts` "publishes tools as skills") may need the two new names added — `derivedSkills()` already skips `negotiate_*`, so the card tests should be unaffected; fix any that enumerate `defaultTools()`.

- [ ] **Step 5: Break it** — in `negotiate_many`, replace `Promise.all(targets.map(...))` with a sequential `for` loop. All three tests still pass (concurrency is a latency property). That is expected and acceptable; the correctness break to check instead: make `runNegotiation` rethrow instead of returning `failed` — "one unreachable target does not sink the others" must fail. Restore.

- [ ] **Step 6: Commit**

```bash
git add src/core/tools.ts src/core/fanout.test.ts
git commit -m "Fan out negotiations and hear back once, as a digest

Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF"
```

---

### Task 5: Through the loop, across processes, and documented

**Files:**
- Modify: `src/core/fanout.test.ts`
- Modify: `src/index.ts`
- Modify: `README.md` (after "Negotiating, one turn at a time"), `CLAUDE.md` (test count, invariants)

**Interfaces:**
- Consumes: everything above.
- Produces: exports `ASK_ACTION`, `digest`, `type NegotiationEvent`.

- [ ] **Step 1: Write the failing tests**

Append to `src/core/fanout.test.ts` (add `import { afterEach } from "bun:test"` alongside the existing import, and `import { MemoryNegotiationStore } from "./sessions.ts"`; the `mockModel` helper is copied from `loop.test.ts` because that file does not export it):

```ts
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
```

- [ ] **Step 2: Run to verify**

Run: `bun test src/core/fanout.test.ts -t "through the agent loop"`
Expected: PASS already if Tasks 1–4 are correct — these are integration checks. If the first fails on `requests` length, the tool threw instead of returning a digest; find out why before touching the test.

- [ ] **Step 3: Exports**

In `src/index.ts`: add `ASK_ACTION` to the `./core/agent.ts` export line; add `export { digest } from "./core/digest.ts";`; add `NegotiationEvent` to the `./core/types.ts` type export list.

- [ ] **Step 4: README**

After the "Negotiating, one turn at a time" section, add:

````markdown
### Negotiating with many at once

One counterparty at a time is a conversation. Ten is management: reading
every turn of every exchange would bury the agent in payloads it can't
act on, and cost a model call per turn. So `negotiationTools()` also
gives the model a pair that works the way a subagent does — run in its
own context, report back once:

| Tool | Does |
| --- | --- |
| `negotiate_many` | Opens every target concurrently and runs each to an event. Returns one digest. |
| `negotiate_resume` | Folds the party's answer into parked negotiations and runs them on. |

A negotiation under `negotiate_many` may take one action a one-vs-one
turn may not: `ask`. It is intercepted before the wire — the counterparty
never sees it — and the negotiation parks with its question. The digest
groups what came back:

```
Settled (2):
- 61b3061c with Alice's Agent — agreed: {"amount":460}
- 9f2a1c3d with Bob's Agent — declined
Waiting on you (1) — ask your party once with ask_user, then call negotiate_resume with every id the answer applies to:
- 1a2b3c4d with Carol's Agent — asks: "Latest pickup day?" (their last move: "$480, Saturday" {"amount":480})
```

Same-kind questions from several negotiations are the model's to
coalesce: it asks the party once and passes every applicable id to
`negotiate_resume`. Guidance given that way is standing — it holds for
the rest of each negotiation — unlike `negotiate_turn`'s per-turn
`guidance`.

Parked negotiations travel on `RunResult.negotiations` and live in the
`NegotiationStore`, so a fresh `Agent` over the same store can resume
them. The same methods are available directly as `runNegotiation()` and
`resumeNegotiation()`; both return a `NegotiationEvent`, and `digest()`
renders a batch of them.
````

- [ ] **Step 5: CLAUDE.md**

Update the test count in the `bun test` comment to the number `bun test` prints. Add to "Invariants worth not breaking":

```markdown
- **The loop hears events, not turns.** `negotiate_many` runs each
  negotiation to a settlement, a question, or a budget and returns one
  digest; the turns in between never enter the transcript. Ten
  negotiations once cost the main model a call per turn each. `ask` is
  offered only under that pump and is intercepted before the wire.
```

- [ ] **Step 6: Full verification**

Run: `bun test && bun run typecheck`
Expected: all pass; note the count for CLAUDE.md.

- [ ] **Step 7: Commit**

```bash
git add src/index.ts src/core/fanout.test.ts README.md CLAUDE.md
git commit -m "Document fan-out negotiations and export the pieces

Claude-Session: https://claude.ai/code/session_01QEnFixpEBJtk7jG58q2jSF"
```
