import { describe, expect, test } from "bun:test";

import { createAssessmentClient } from "./consult.ts";

type Step = { status: number; body: unknown };

/** A fetch stub that answers each call with the next scripted step and records requests. */
function scriptedFetch(steps: Step[], calls: { method: string; url: string }[]) {
  let at = 0;
  return (async (url: Parameters<typeof fetch>[0], init?: RequestInit) => {
    calls.push({ method: init?.method ?? "GET", url: String(url) });
    const step = steps[Math.min(at++, steps.length - 1)]!;
    return new Response(JSON.stringify(step.body), { status: step.status, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const RESULT = { run_id: "run-1", assessment: { ordered_action_ids: [], participant_map: {}, settings: { n_samples: 2 }, actions: [] } };

const immediate = (ms: number, signal?: AbortSignal) => {
  signal?.throwIfAborted();
  return Promise.resolve();
};

describe("assessment client", () => {
  test("starts a run and returns the ready result", async () => {
    const calls: { method: string; url: string }[] = [];
    const client = createAssessmentClient({
      baseUrl: "https://assess.example", token: "t",
      fetch: scriptedFetch([
        { status: 202, body: { run_id: "run-1" } },
        { status: 200, body: { status: "running" } },
        { status: 200, body: { status: "ready", result: RESULT } },
      ], calls),
      sleep: immediate,
    });
    const result = await client.consult({ opportunityId: "opp", turnIndex: 2, ownerUserId: "u", packet: {} }, { deadlineMs: 10_000 });
    expect(result).toEqual(RESULT);
    expect(calls[0]).toEqual({ method: "POST", url: "https://assess.example/runs" });
    expect(calls[1]!.url).toBe("https://assess.example/runs/run-1");
  });

  test("an unavailable run is null", async () => {
    const client = createAssessmentClient({
      baseUrl: "https://assess.example", token: "t",
      fetch: scriptedFetch([{ status: 202, body: { run_id: "run-1" } }, { status: 200, body: { status: "unavailable" } }], []),
      sleep: immediate,
    });
    expect(await client.consult({ opportunityId: "opp", turnIndex: 0, ownerUserId: "u", packet: {} }, { deadlineMs: 10_000 })).toBeNull();
  });

  test("the deadline ends polling with null", async () => {
    let now = 0;
    const client = createAssessmentClient({
      baseUrl: "https://assess.example", token: "t",
      fetch: scriptedFetch([{ status: 202, body: { run_id: "run-1" } }, { status: 200, body: { status: "running" } }], []),
      sleep: (ms) => { now += ms; return Promise.resolve(); },
      now: () => now,
    });
    expect(await client.consult({ opportunityId: "opp", turnIndex: 0, ownerUserId: "u", packet: {} }, { deadlineMs: 5_000 })).toBeNull();
  });

  test("an abort stops the consult", async () => {
    const controller = new AbortController();
    const client = createAssessmentClient({
      baseUrl: "https://assess.example", token: "t",
      fetch: scriptedFetch([{ status: 202, body: { run_id: "run-1" } }, { status: 200, body: { status: "running" } }], []),
      sleep: async (ms, signal) => { controller.abort(); signal?.throwIfAborted(); },
    });
    await expect(client.consult({ opportunityId: "opp", turnIndex: 0, ownerUserId: "u", packet: {} }, { deadlineMs: 10_000, signal: controller.signal }))
      .rejects.toThrow();
  });

  test("identical in-flight consults share one run", async () => {
    const calls: { method: string; url: string }[] = [];
    const client = createAssessmentClient({
      baseUrl: "https://assess.example", token: "t",
      fetch: scriptedFetch([
        { status: 202, body: { run_id: "run-1" } },
        { status: 200, body: { status: "ready", result: RESULT } },
      ], calls),
      sleep: immediate,
    });
    const request = { opportunityId: "opp", turnIndex: 1, ownerUserId: "u", packet: {} };
    const [first, second] = await Promise.all([
      client.consult(request, { deadlineMs: 10_000 }),
      client.consult(request, { deadlineMs: 10_000 }),
    ]);
    expect(first).toEqual(RESULT);
    expect(second).toEqual(RESULT);
    expect(calls.filter((call) => call.method === "POST").length).toBe(1);
  });
});
