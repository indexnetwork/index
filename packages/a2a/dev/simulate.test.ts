import { describe, expect, test } from "bun:test";
import { runNegotiation, type Participant } from "./simulate.ts";
import { Negotiator } from "../src/core/negotiator.ts";
import type { NegotiationState } from "../src/core/types.ts";

/** A Negotiator whose respond() is scripted instead of hitting OpenRouter. */
function scriptedNegotiator(replies: string[]) {
  const negotiator = new Negotiator({ apiKey: "test-key" });
  const calls: NegotiationState[] = [];
  let call = 0;
  (negotiator as unknown as { respond: Negotiator["respond"] }).respond = async (
    state: NegotiationState,
  ) => {
    calls.push(state);
    const reply = replies[call] ?? replies.at(-1) ?? "";
    call++;
    return reply;
  };
  return { negotiator, calls };
}

function participant(name: string, replies: string[]) {
  const scripted = scriptedNegotiator(replies);
  const participant: Participant = {
    party: { name, objective: `${name}'s objective` },
    negotiator: scripted.negotiator,
  };
  return { participant, calls: scripted.calls };
}

describe("runNegotiation", () => {
  test("alternates speakers starting with participant 0", async () => {
    const a = participant("A", ["a1", "a2"]);
    const b = participant("B", ["b1", "b2"]);

    const transcript = await runNegotiation([a.participant, b.participant], {
      maxTurns: 4,
    });

    expect(transcript.map((e) => e.speaker)).toEqual([0, 1, 0, 1]);
    expect(transcript.map((e) => e.content)).toEqual(["a1", "b1", "a2", "b2"]);
  });

  test("builds each speaker's history as incoming/outgoing relative to themselves", async () => {
    const a = participant("A", ["a1", "a2"]);
    const b = participant("B", ["b1", "b2"]);

    await runNegotiation([a.participant, b.participant], { maxTurns: 4 });

    expect(a.calls[0]?.history).toEqual([]);
    expect(b.calls[0]?.history).toEqual([
      { role: "incoming", content: "a1" },
    ]);
    expect(a.calls[1]?.history).toEqual([
      { role: "outgoing", content: "a1" },
      { role: "incoming", content: "b1" },
    ]);
    expect(b.calls[1]?.history).toEqual([
      { role: "incoming", content: "a1" },
      { role: "outgoing", content: "b1" },
      { role: "incoming", content: "a2" },
    ]);
  });

  test("stops as soon as stopWhen matches, without running further turns", async () => {
    const a = participant("A", ["could you do Tuesday?"]);
    const b = participant("B", ["deal!"]);

    const transcript = await runNegotiation([a.participant, b.participant], {
      maxTurns: 10,
      stopWhen: (entry) => /deal/i.test(entry.content),
    });

    expect(transcript).toHaveLength(2);
  });

  test("calls onMessage as each message arrives, before stopWhen would stop it", async () => {
    const a = participant("A", ["a1"]);
    const b = participant("B", ["b1"]);
    const seen: string[] = [];

    await runNegotiation([a.participant, b.participant], {
      maxTurns: 2,
      onMessage: (entry) => seen.push(entry.content),
    });

    expect(seen).toEqual(["a1", "b1"]);
  });

  test("defaults to a maxTurns of 10 when no stop condition is met", async () => {
    const a = participant("A", ["x"]);
    const b = participant("B", ["y"]);

    const transcript = await runNegotiation([a.participant, b.participant]);

    expect(transcript).toHaveLength(10);
  });
});
