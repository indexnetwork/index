import { describe, expect, test } from "bun:test";

import { CANDIDATE_USER_ID, FakeNegotiationHost, INTENT_ID, NETWORK_ID, OPPORTUNITY_ID, SOURCE_USER_ID } from "./fixtures/negotiation-host.fixture.js";
import type { NegotiationTurnAuthor, NegotiationTurnAuthorInput } from "../../internal/negotiations/negotiation.turn-author.js";
import { NegotiationAuthoredTurnSchema, NegotiationOpeningTurnSchema } from "../../internal/negotiations/negotiation.turn.js";
import type { NegotiationAuthoredTurn, NegotiationTurn } from "../../internal/negotiations/negotiation.turn.js";
import { maybeEnqueueRoundReflect } from "../../internal/negotiations/negotiation.round-reflect.js";
import { Negotiations } from "../negotiations.js";

/**
 * NegotiationGraph end-to-end coverage (#1494), modeled on
 * `capabilities/tests/intents.spec.ts`: a fake host implementing the real
 * `NegotiationGraphDatabase` port, driving the real `graph.invoke`. Unlike
 * `intents.spec.ts` this is deliberately provider-free — no API key, no
 * network call, no `createModel`/`createStructuredModel` construction
 * anywhere in this file — which is what lets this file run in the
 * credential-free Hermes-security CI gate instead of the excluded
 * LIVE_MODEL_SPECS set. Every scripted turn is still validated through the
 * graph's own zod schemas
 * (`NegotiationAuthoredTurnSchema`/`NegotiationOpeningTurnSchema`).
 *
 * One shared author speaks for BOTH seats: a `turn` node that produces a
 * *continuing* verb loops the graph straight back into itself, self-playing
 * the whole negotiation within one `invoke()` call until someone pauses. The
 * only way to hand control back to a test (or a real external caller, e.g.
 * `respond_to_negotiation`) is a pause — `ScriptedTurnAuthor` falls back to
 * `pause(needs_principal)` once its script is exhausted, so a short script
 * naturally stops self-play exactly where a test wants to take over with an
 * explicit `{ negotiationId, turn, byUserId }` invoke.
 *
 * In production the author is the speaking seat's own PersonalAgent in
 * negotiation scope; the port takes ids only, so a scripted author reads the
 * fake host directly to decide whether it is opening.
 */

/** A provider-free stand-in for the PersonalAgent's negotiation scope. */
class ScriptedTurnAuthor implements NegotiationTurnAuthor {
  private readonly script: NegotiationAuthoredTurn[];
  private cursor = 0;
  readonly calls: Array<NegotiationTurnAuthorInput & { isOpening: boolean }> = [];

  constructor(private readonly host: FakeNegotiationHost, script: NegotiationAuthoredTurn[]) {
    this.script = script;
  }

  async authorTurn(input: NegotiationTurnAuthorInput): Promise<NegotiationAuthoredTurn> {
    // The real author reads the thread itself; so does this one. Raw message
    // count, not parsed turns — the graph's opening rule keys off the same.
    const isOpening = (this.host.messages.get(input.negotiationId) ?? []).length === 0;
    this.calls.push({ ...input, isOpening });
    const next = this.script[this.cursor];
    this.cursor += 1;
    // Once the script is exhausted, pause rather than throw: control returns
    // to the caller instead of every scenario needing an exact-length script.
    // An opening turn can never be a pause, so its fallback is outreach.
    const turn: NegotiationAuthoredTurn = next ?? (isOpening
      ? { verb: "outreach", message: "(unscripted opening)", reasoning: "(unscripted)" }
      : { verb: "pause", reason: "needs_principal", payload: { question: "Nothing scripted — awaiting external input." } });
    return isOpening ? NegotiationOpeningTurnSchema.parse(turn) : NegotiationAuthoredTurnSchema.parse(turn);
  }
}

describe("NegotiationGraph — open, turns, pause, resume, verdict", () => {
  test("a submitted passive-round sibling prevents an early all-paused wake", async () => {
    const host = new FakeNegotiationHost();
    const passiveIntentId = "intent-bob-1";
    const metadata = (opportunityId: string) => ({
      type: "negotiation" as const,
      opportunityId,
      sourceUserId: SOURCE_USER_ID,
      candidateUserId: CANDIDATE_USER_ID,
      initiatorUserId: SOURCE_USER_ID,
      networkId: NETWORK_ID,
      seats: { [passiveIntentId]: { userId: CANDIDATE_USER_ID, round: 0 } },
      drainGeneration: 0,
    });
    const paused = await host.createNegotiationTask({
      conversationId: "conversation-paused",
      briefs: {},
      metadata: metadata("opportunity-paused"),
    });
    const submitted = await host.createNegotiationTask({
      conversationId: "conversation-submitted",
      briefs: {},
      metadata: metadata("opportunity-submitted"),
    });
    await host.database.updateNegotiationTaskState(paused.id, "paused", {
      reason: "needs_principal",
      pausedBy: CANDIDATE_USER_ID,
    });
    host.tasks.set(submitted.id, { ...submitted, state: "submitted" });

    const check = { userId: CANDIDATE_USER_ID, intentId: passiveIntentId, round: 0 };
    await maybeEnqueueRoundReflect(host.database, async (job) => { host.enqueueReflect(job); }, check);
    expect(host.reflectJobs).toEqual([]);

    host.tasks.set(submitted.id, {
      ...host.taskFor(submitted.id),
      state: "paused",
      metadata: {
        ...host.taskFor(submitted.id).metadata,
        pause: { reason: "needs_principal", pausedBy: CANDIDATE_USER_ID },
      },
    });
    await maybeEnqueueRoundReflect(host.database, async (job) => { host.enqueueReflect(job); }, check);

    expect(host.reflectJobs).toEqual([{
      ...check,
      generation: "task-1.0_task-2.0",
    }]);
  });

  test("concurrent opens that both miss the pre-read create one task and one opening outreach", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Opening.", reasoning: "r" },
      { verb: "pause", reason: "needs_principal", payload: { question: "?" } },
    ]);
    let reads = 0;
    let releasePreRead!: () => void;
    const bothRead = new Promise<void>((resolve) => { releasePreRead = resolve; });
    const database = {
      ...host.database,
      getNegotiationTaskForOpportunity: async () => {
        reads += 1;
        if (reads === 2) releasePreRead();
        await bothRead;
        return null;
      },
    };
    const graph = new Negotiations({ database, author }).createGraph();
    const input = { opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 };

    await Promise.all([graph.invoke(input), graph.invoke(input)]);

    expect(host.tasks.size).toBe(1);
    expect(author.calls.filter((call) => call.isOpening)).toHaveLength(1);
    const [task] = [...host.tasks.values()];
    expect(host.messages.get(task!.id)).toHaveLength(2);
  });

  test("open → turns → pause(needs_principal) → resume with brief → pause(ready_for_verdict) → verdict pending", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Hi Bob, I'm reaching out on Alice's behalf about a co-founder match.", reasoning: "Opening the negotiation." },
      { verb: "pause", reason: "needs_principal", payload: { question: "What equity split are you open to?" } },
      { verb: "counter", message: "Bob's agent: 15-20% equity works.", reasoning: "Principal answered." },
      { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "Both sides converged on terms." } },
    ]);
    const graph = new Negotiations({
      database: host.database,
      author,
      reflectEnqueue: async (job) => { host.enqueueReflect(job); },
    }).createGraph();
    host.kickoffStartedAt = new Date();

    // open: self-play authors the opening turn (alice), loops straight into
    // the reply seat (bob), which immediately pauses per the script —
    // exactly one call, two persisted turns (outreach + redacted pause marker).
    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "Alice wants a technical co-founder.", round: 1 });
    expect(opened.status).toBe("paused");
    expect(opened.turns).toHaveLength(2);
    expect(opened.turns[0]).toMatchObject({ verb: "outreach" });
    expect(opened.pause).toEqual({ reason: "needs_principal" });
    const negotiationId = opened.negotiationId;
    expect(host.opportunityStatusUpdates.at(0)).toEqual({ id: OPPORTUNITY_ID, status: "negotiating" });
    // The real payload lives only on the task, scoped to whoever paused (bob).
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({
      reason: "needs_principal",
      pausedBy: CANDIDATE_USER_ID,
      payload: { question: "What equity split are you open to?" },
    });
    expect(host.taskFor(negotiationId).state).toBe("paused");
    // The initiating round waits for its size stamp, while Bob's passive seat
    // is already durably bound and wakes immediately.
    expect(host.reflectJobs).toEqual([{
      userId: CANDIDATE_USER_ID,
      intentId: "intent-bob-1",
      round: 0,
      generation: "task-1.0",
    }]);
    // Kickoff's own post-settle stamp, replayed here by hand.
    await host.database.stampIntentNegotiationRoundSize(INTENT_ID, 1, 1);
    await maybeEnqueueRoundReflect(host.database, async (job) => { host.enqueueReflect(job); }, {
      userId: SOURCE_USER_ID,
      intentId: INTENT_ID,
      round: 1,
    });

    // resume with brief: IS-A answered the equity question (read from the task directly,
    // the same privileged path IS-A will use — never from the graph's own public result).
    // Bob's own seat resumes (retry-same-speaker-after-pause), then self-play
    // continues straight to alice's next (scripted) pause.
    const resumed = await graph.invoke({ negotiationId, brief: "Alice wants a technical co-founder; she is open to 15-20% equity.", byUserId: SOURCE_USER_ID });
    expect(resumed.status).toBe("paused");
    expect(resumed.pause).toEqual({ reason: "ready_for_verdict" });
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({
      reason: "ready_for_verdict",
      pausedBy: SOURCE_USER_ID,
      payload: { recommendation: "pending" },
    });
    // The reopened pause is a new durable generation for both bound seats.
    expect(host.reflectJobs).toEqual(expect.arrayContaining([
      { userId: SOURCE_USER_ID, intentId: INTENT_ID, round: 1, generation: "task-1.0" },
      { userId: SOURCE_USER_ID, intentId: INTENT_ID, round: 1, generation: "task-1.1" },
      { userId: CANDIDATE_USER_ID, intentId: "intent-bob-1", round: 0, generation: "task-1.1" },
    ]));

    // verdict: IS-A promotes to pending — the only terminal write
    const resolved = await graph.invoke({ negotiationId, verdict: "pending", reasoning: "Both sides converged on terms.", byUserId: SOURCE_USER_ID });
    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict).toBe("pending");
    expect(resolved.reasoning).toBe("Both sides converged on terms.");
    expect(host.taskFor(negotiationId).state).toBe("completed");
    expect(host.outcomeArtifacts.get(negotiationId)).toMatchObject({
      reasoning: "Both sides converged on terms.",
      resolvedByUserId: SOURCE_USER_ID,
    });
    expect(host.opportunityStatusUpdates.at(-1)).toEqual({ id: OPPORTUNITY_ID, status: "pending" });

    // The single shared author authored every turn, both seats — there is no
    // more per-seat external/internal split.
    expect(author.calls).toHaveLength(4);
    expect(author.calls[0].isOpening).toBe(true);
    expect(author.calls.slice(1).every((call) => call.isOpening === false)).toBe(true);
  });

  test("verdict reject writes the opportunity as rejected, not pending", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Opening.", reasoning: "r" },
      { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Not a fit." } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused");
    expect(opened.pause).toEqual({ reason: "ready_for_verdict" });
    expect(host.taskFor(opened.negotiationId).metadata.pause).toMatchObject({
      reason: "ready_for_verdict",
      payload: { recommendation: "reject" },
    });

    const resolved = await graph.invoke({ negotiationId: opened.negotiationId, verdict: "reject", reasoning: "Not a fit.", byUserId: SOURCE_USER_ID });
    expect(resolved.status).toBe("resolved");
    expect(resolved.verdict).toBe("reject");
    expect(host.opportunityStatusUpdates.at(-1)).toEqual({ id: OPPORTUNITY_ID, status: "rejected" });
  });

  test("rejects a verdict from someone who is not a negotiation seat", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Opening.", reasoning: "r" },
      { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Not a fit." } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();
    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });

    const result = await graph.invoke({
      negotiationId: opened.negotiationId,
      verdict: "reject",
      reasoning: "This must stay private.",
      byUserId: "intruder",
    });

    expect(result).toMatchObject({ status: "error", error: "Only a negotiation seat may resolve it" });
    expect(host.outcomeArtifacts.get(opened.negotiationId)).toBeUndefined();
    expect(host.taskFor(opened.negotiationId).state).toBe("paused");
  });

  test("a system pause (stale-negotiation timeout) does not invoke the author", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Opening.", reasoning: "r" },
      { verb: "pause", reason: "needs_principal", payload: { question: "?" } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused");
    const callsBeforeTimeout = author.calls.length;

    // `{ negotiationId, pause: 'counterparty_silent' }` goes straight to apply
    // in initNode — it never reaches turnNode/the author, regardless of the
    // negotiation's current state.
    const timedOut = await graph.invoke({ negotiationId: opened.negotiationId, pause: "counterparty_silent" });

    expect(timedOut.status).toBe("paused");
    expect(timedOut.pause).toMatchObject({ reason: "counterparty_silent" });
    expect(author.calls).toHaveLength(callsBeforeTimeout);
  });
});

describe("NegotiationGraph — external turn submission (respond_to_negotiation shape)", () => {
  test("an externally submitted turn goes through the same apply guards as an internally authored one", async () => {
    const host = new FakeNegotiationHost();
    // Empty script: the opening turn falls back to outreach, then the reply
    // seat immediately falls back to pause(needs_principal) — self-play stops
    // after exactly one real turn, handing control to explicit test invokes.
    const author = new ScriptedTurnAuthor(host, []);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused");
    expect(opened.turns).toHaveLength(2); // fallback outreach + bob's fallback pause
    expect(opened.pause).toEqual({ reason: "needs_principal" });
    const negotiationId = opened.negotiationId;

    // Bob's own seat resumes (retry-same-speaker-after-pause) — outreach is
    // no longer legal, history is non-empty.
    const rejectedReopen = await graph.invoke({
      negotiationId,
      turn: { verb: "outreach", message: "Trying to reopen.", reasoning: "r" },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(rejectedReopen.status).toBe("error");

    // Same guard the internal author is bound by: a turn attributed to the wrong seat is rejected.
    const wrongSeat = await graph.invoke({
      negotiationId,
      turn: { verb: "question", message: "Impersonating alice.", reasoning: "r" },
      byUserId: SOURCE_USER_ID, // it's actually bob's turn to resume
    });
    expect(wrongSeat.status).toBe("error");

    // Bob's real resume: a continuing verb, submitted externally. Self-play
    // then loops straight to alice's next (unscripted, so fallback-pause) turn.
    const applied = await graph.invoke({
      negotiationId,
      turn: { verb: "question", message: "What timeline is Alice working with?", reasoning: "Need to know before committing." },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(applied.status).toBe("paused");
    expect(applied.turns[2]).toMatchObject({ verb: "question" });
    expect(applied.pause).toEqual({ reason: "needs_principal" });
    expect(host.taskFor(negotiationId).metadata.pause?.pausedBy).toBe(SOURCE_USER_ID);
  });

  test("an externally submitted turn is re-validated at the graph's own boundary, not trusted verbatim", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, []);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused"); // fallback outreach, then bob's fallback pause
    const negotiationId = opened.negotiationId;
    const messagesBefore = host.messages.get(negotiationId)!.length;

    // A malformed turn (unknown verb) reaches invoke() with the static
    // NegotiationTurn type satisfied by an `as never` cast — exactly what an
    // external caller that skipped its own validation could send. The graph
    // must reject it itself, not trust the type and persist garbage.
    const malformed = await graph.invoke({
      negotiationId,
      turn: { verb: "bogus_verb", message: "x", reasoning: "r" } as never,
      byUserId: CANDIDATE_USER_ID,
    });
    expect(malformed.status).toBe("error");
    expect(host.messages.get(negotiationId)).toHaveLength(messagesBefore); // nothing new persisted
  });

  test("an unparseable historical message does not shift a later turn's speaker attribution", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Hi Bob.", reasoning: "r" },
      { verb: "pause", reason: "needs_principal", payload: { question: "?" } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused"); // outreach, then bob's scripted needs_principal
    const negotiationId = opened.negotiationId;

    // A message that fails NegotiationTurnSchema — simulating drift/corruption,
    // not something either apply guard would ever itself produce — inserted
    // after the real history so far. nextSpeaker's own unparseable-tail
    // handling alternates by raw sender regardless of parseability, so the
    // sender here must be alice's (the seat that did NOT just pause) for the
    // resolved next speaker to still be bob — isolating the zip bug this
    // test targets from that separate (and correct) behavior.
    const list = host.messages.get(negotiationId)!;
    list.push({ id: "garbage-1", senderId: `agent:${SOURCE_USER_ID}`, parts: [{ kind: "data", data: { not: "a turn" } }], createdAt: new Date() });

    // Bob's real resume, submitted externally — a continuing verb loops
    // straight back into turnNode for alice's next (scripted-fallback) move,
    // which is what actually exercises the buggy zip.
    await graph.invoke({
      negotiationId,
      turn: { verb: "counter", message: "Interested — terms?", reasoning: "r" },
      byUserId: CANDIDATE_USER_ID,
    });

    // author.calls[0] is alice's opening; calls[1] is bob's pause (both
    // consumed inside open()); calls[2] is alice's turn authored after the
    // garbage-message resume above. `nextSpeaker` must still resolve alice
    // even with an unparseable message in the middle of the history.
    expect(author.calls[2]).toMatchObject({ userId: SOURCE_USER_ID, isOpening: false });
  });

  test("refuses to open when a premise-matched counterparty has no owning intent", async () => {
    // The real shape a premise match produces: the counterparty actor's own
    // `intent` field names the intent it matched AGAINST (the source's), not
    // one it owns — so both actors can carry the exact same intent value.
    // The source intent cannot be reused as Bob's private signal context.
    const host = new FakeNegotiationHost();
    host.opportunity.actors = [
      { userId: SOURCE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID, role: "peer" },
      { userId: CANDIDATE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID, role: "agent" },
    ];
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Hi Bob.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened).toMatchObject({ status: "error", error: "Counterparty actor intent is not owned by that seat" });
    expect(host.tasks.size).toBe(0);
  });

  test("an introducer actor is never picked as a negotiation seat", async () => {
    const host = new FakeNegotiationHost();
    host.opportunity.actors = [
      { userId: SOURCE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID, role: "peer" },
      { userId: CANDIDATE_USER_ID, intent: "intent-bob-1", networkId: NETWORK_ID, role: "peer" },
      { userId: "carol-introducer", intent: INTENT_ID, networkId: NETWORK_ID, role: "introducer", approved: true },
    ];
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Hi Bob.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    expect(opened.status).toBe("paused"); // outreach, then bob's fallback pause
    const task = host.taskFor(opened.negotiationId);
    expect(task.metadata.sourceUserId).toBe(SOURCE_USER_ID);
    expect(task.metadata.candidateUserId).toBe(CANDIDATE_USER_ID);
  });

  test("an introduction its introducer has not approved is refused at the OPEN", async () => {
    // The gate cannot live only where discovery decides whom to WAKE: a
    // kickoff woken by one plain match re-reads the whole match list, and
    // without a check here the unapproved introduction is opened too — flipped
    // to `negotiating` with A2A outreach sent on the introducer's behalf.
    const host = new FakeNegotiationHost();
    host.opportunity.actors = [
      { userId: SOURCE_USER_ID, intent: INTENT_ID, networkId: NETWORK_ID, role: "peer" },
      { userId: CANDIDATE_USER_ID, intent: "intent-bob-1", networkId: NETWORK_ID, role: "peer" },
      { userId: "carol-introducer", intent: INTENT_ID, networkId: NETWORK_ID, role: "introducer" },
    ];
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Hi Bob.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });

    expect(opened.status).toBe("error");
    expect(opened.error).toContain("introducer approval");
    expect([...host.tasks.values()]).toHaveLength(0);
    expect(host.opportunityStatusUpdates).toEqual([]);
    expect(author.calls).toHaveLength(0);
  });

  test("re-kicking an existing task whose history is entirely pre-rewrite legacy messages does not error forever", async () => {
    // A pre-rewrite task with only old {action} shaped message parts: nothing
    // parses as a NegotiationTurn, so turnsFromMessages returns []. turnNode
    // and applyNode must still agree this is NOT the opening turn (raw
    // messages exist) — otherwise turnNode authors 'outreach' and applyNode's
    // own outreach-only-first guard rejects it, forever.
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "First real turn.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    const negotiationId = opened.negotiationId;

    // Replace the real history with a legacy-shaped message — simulating a
    // task that predates this rewrite entirely.
    host.messages.set(negotiationId, [
      { id: "legacy-1", senderId: `agent:${SOURCE_USER_ID}`, parts: [{ kind: "data", data: { action: "accept" } }], createdAt: new Date() },
    ]);

    const rekicked = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 2 });
    expect(rekicked.status).not.toBe("error");
    expect(rekicked.negotiationId).toBe(negotiationId);
  });

  test("resuming an opportunity that already has a negotiation is idempotent, not a second open", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const first = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    // A second `{ opportunityId, brief }` invoke (e.g. discovery re-running) finds the existing task and
    // updates its brief instead of creating a second negotiation for the same opportunity.
    const second = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "updated brief", round: 2 });

    expect(second.negotiationId).toBe(first.negotiationId);
    expect(host.taskFor(first.negotiationId).briefs[SOURCE_USER_ID]).toBe("updated brief");
    expect([...host.tasks.values()]).toHaveLength(1);
    // The second kickoff's round must land on the task, not the round it opened with —
    // checkAllPaused's round-scoped count and the eventual pause both key off this.
    expect(host.taskFor(first.negotiationId).metadata.seats[INTENT_ID]!.round).toBe(2);
  });

  test("a turn rejected for the wrong seat does not resume a paused negotiation", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Hi Bob.", reasoning: "r" },
      { verb: "pause", reason: "needs_principal", payload: { question: "What equity split?" } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    const negotiationId = opened.negotiationId;
    expect(opened.status).toBe("paused");
    expect(opened.pause).toEqual({ reason: "needs_principal" });
    expect(host.taskFor(negotiationId).state).toBe("paused");
    expect(host.taskFor(negotiationId).metadata.pause?.pausedBy).toBe(CANDIDATE_USER_ID);

    // Bob's own principal pause — only bob's seat may resume it. Alice submitting
    // next is the wrong seat and must be rejected without touching the pause.
    const rejected = await graph.invoke({
      negotiationId,
      turn: { verb: "counter", message: "Trying to jump back in.", reasoning: "r" },
      byUserId: SOURCE_USER_ID,
    });
    expect(rejected.status).toBe("error");

    // A rejection must never have flipped the negotiation to "working" — that would
    // strand it with no pause reported and no turn applied.
    expect(host.taskFor(negotiationId).state).toBe("paused");
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({ reason: "needs_principal", pausedBy: CANDIDATE_USER_ID });
  });

  test("resuming a paused negotiation clears metadata.pause, not just the state", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [
      { verb: "outreach", message: "Hi Bob.", reasoning: "r" },
      { verb: "pause", reason: "needs_principal", payload: { question: "What equity split?" } },
    ]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    const negotiationId = opened.negotiationId;
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({ reason: "needs_principal", pausedBy: CANDIDATE_USER_ID });

    // Bob's own seat resumes, answering the question. Self-play then loops to
    // alice's next (unscripted, so fallback-pause) turn.
    const resumed = await graph.invoke({
      negotiationId,
      turn: { verb: "counter", message: "20% split.", reasoning: "r" },
      byUserId: CANDIDATE_USER_ID,
    });
    expect(resumed.status).toBe("paused"); // alice's fallback pause, a NEW one
    // The bob pause that was just resumed must be fully replaced, not merely
    // shadowed — a reader that doesn't gate on state must never see it again.
    expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({ reason: "needs_principal", pausedBy: SOURCE_USER_ID });
  });

  describe("the turn cap counts substantive turns only", () => {
    /** Each entry's sender is explicit — nextSpeaker's resolution off the LAST entry must be unambiguous. */
    function seedMessages(host: FakeNegotiationHost, negotiationId: string, shape: Array<{ sender: string; kind: "turn" | "pause" }>) {
      const list = shape.map(({ sender, kind }, i) => ({
        id: `seed-${i}`,
        senderId: `agent:${sender}`,
        parts: [{
          kind: "data",
          data: kind === "turn"
            ? { verb: "counter", message: `turn ${i}`, reasoning: "r" }
            : { verb: "pause", reason: "counterparty_silent" },
        }],
        createdAt: new Date(),
      }));
      host.messages.set(negotiationId, list);
    }

    test("pause markers mixed into history do not trip the cap early", async () => {
      const host = new FakeNegotiationHost();
      const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
      const graph = new Negotiations({ database: host.database, author }).createGraph();
      const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
      const negotiationId = opened.negotiationId;

      // 2 substantive turns + 4 pause markers = 6 raw messages (the old,
      // buggy threshold), but only 2 real turns — nowhere near
      // NEGOTIATION_MAX_TURNS_AMBIENT (6). Last entry is bob's pause, so
      // nextSpeaker (retry-same-speaker-after-pause) expects bob next.
      seedMessages(host, negotiationId, [
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "pause" },
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "pause" },
        { sender: SOURCE_USER_ID, kind: "pause" },
        { sender: CANDIDATE_USER_ID, kind: "pause" },
      ]);

      const result = await graph.invoke({
        negotiationId,
        turn: { verb: "counter", message: "still well under the cap", reasoning: "r" },
        byUserId: CANDIDATE_USER_ID,
      });
      expect(result.status).not.toBe("error");
    });

    test("an externally submitted turn that hits the cap is rejected, not silently swapped for a pause", async () => {
      const host = new FakeNegotiationHost();
      const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
      const graph = new Negotiations({ database: host.database, author }).createGraph();
      const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
      const negotiationId = opened.negotiationId;

      // 5 substantive turns already on record, alternating, ending on alice —
      // bob is next. The 6th (bob's) trips the cap.
      seedMessages(host, negotiationId, [
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "turn" },
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "turn" },
        { sender: SOURCE_USER_ID, kind: "turn" },
      ]);

      const submitted = { verb: "counter" as const, message: "the real content the caller sent", reasoning: "r" };
      const result = await graph.invoke({ negotiationId, turn: submitted, byUserId: CANDIDATE_USER_ID });
      expect(result.status).toBe("error");
      // Nothing was persisted — the caller's real turn was never silently
      // swapped for a fabricated pause and reported as success.
      expect(host.messages.get(negotiationId)).toHaveLength(5);
    });

    test("a self-play-authored turn that hits the cap auto-pauses with the honest 'turn_cap' reason", async () => {
      const host = new FakeNegotiationHost();
      // Created directly, not via open() — open()'s own self-play would
      // consume this script and reach its own (irrelevant) pause before this
      // test's controlled 5-turn history is ever seeded.
      const task = await host.createNegotiationTask({
        conversationId: "conversation-manual-cap",
        brief: "brief",
        metadata: {
          type: "negotiation",
          opportunityId: OPPORTUNITY_ID,
          sourceUserId: SOURCE_USER_ID,
          candidateUserId: CANDIDATE_USER_ID,
          initiatorUserId: SOURCE_USER_ID,
          networkId: NETWORK_ID,
          seats: { [INTENT_ID]: { userId: SOURCE_USER_ID, round: 1 } },
        },
      });
      const negotiationId = task.id;
      const author = new ScriptedTurnAuthor(host, [{ verb: "counter", message: "one more thing", reasoning: "r" }]);
      const graph = new Negotiations({ database: host.database, author }).createGraph();

      // 5 turns ending on bob (candidate) — alice is next, authored internally
      // (script[0]) since there is no more per-seat external/internal split.
      seedMessages(host, negotiationId, [
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "turn" },
        { sender: SOURCE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "turn" },
        { sender: CANDIDATE_USER_ID, kind: "turn" },
      ]);

      // A system resume (no byUserId) re-enters turn authoring internally —
      // the internal author has no caller to reject to, so it auto-pauses.
      const result = await graph.invoke({ negotiationId, brief: "still brief", byUserId: SOURCE_USER_ID });
      expect(result.status).toBe("paused");
      expect(result.pause).toEqual({ reason: "turn_cap" });
      expect(host.taskFor(negotiationId).metadata.pause).toMatchObject({ reason: "turn_cap" });
    });
  });

  test("a concurrent duplicate submission is fenced, not silently double-applied", async () => {
    const host = new FakeNegotiationHost();
    const author = new ScriptedTurnAuthor(host, [{ verb: "outreach", message: "Opening.", reasoning: "r" }]);
    const graph = new Negotiations({ database: host.database, author }).createGraph();

    const opened = await graph.invoke({ opportunityId: OPPORTUNITY_ID, intentId: INTENT_ID, brief: "brief", round: 1 });
    const negotiationId = opened.negotiationId;
    expect(opened.status).toBe("paused"); // outreach, then bob's fallback pause

    // Two processes race to resume bob's own pause from the same read (a pause never
    // loops back into self-play, so the winner's own result stays predictable). Both compute
    // the same expectedMessageCount; only the first insert may win.
    const [first, second] = await Promise.all([
      graph.invoke({
        negotiationId,
        turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "pending", reasoning: "First." } },
        byUserId: CANDIDATE_USER_ID,
      }),
      graph.invoke({
        negotiationId,
        turn: { verb: "pause", reason: "ready_for_verdict", payload: { recommendation: "reject", reasoning: "Second." } },
        byUserId: CANDIDATE_USER_ID,
      }),
    ]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual(["error", "paused"]);
    // Exactly one of the two races landed — not two, not a fabricated composite.
    const persisted = await host.database.getNegotiationMessages(negotiationId);
    expect(persisted).toHaveLength(3); // outreach, bob's needs_principal, plus exactly one of the two races
  });

  test("a system pause on a negotiation with no turns at all is not blocked by the outreach guard", async () => {
    // Covers a first-turn authoring failure: init created the task, but nothing was ever
    // persisted before a timeout fired on it. The outreach-only-first rule must not trap
    // this negotiation with no way to recover.
    const host = new FakeNegotiationHost();
    const task = await host.createNegotiationTask({
      conversationId: "conversation-manual-1",
      brief: "brief",
      metadata: {
        type: "negotiation",
        opportunityId: OPPORTUNITY_ID,
        sourceUserId: SOURCE_USER_ID,
        candidateUserId: CANDIDATE_USER_ID,
        initiatorUserId: SOURCE_USER_ID,
        networkId: NETWORK_ID,
        seats: { [INTENT_ID]: { userId: SOURCE_USER_ID, round: 1 } },
      },
    });
    const graph = new Negotiations({ database: host.database, author: new ScriptedTurnAuthor(host, []) }).createGraph();

    const timedOut = await graph.invoke({ negotiationId: task.id, pause: "counterparty_silent" });
    expect(timedOut.status).toBe("paused");
    expect(timedOut.pause).toEqual({ reason: "counterparty_silent" });
  });
});
