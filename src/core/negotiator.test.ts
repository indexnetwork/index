import { afterEach, describe, expect, test } from "bun:test";
import { Negotiator } from "./negotiator.ts";
import type { NegotiationState } from "./types.ts";

const originalFetch = globalThis.fetch;
const originalApiKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalApiKey === undefined) {
    delete process.env.OPENROUTER_API_KEY;
  } else {
    process.env.OPENROUTER_API_KEY = originalApiKey;
  }
});

function mockFetchOnce(content: string) {
  let capturedUrl: string | undefined;
  let capturedInit: RequestInit | undefined;

  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    capturedUrl = url;
    capturedInit = init;
    return new Response(
      JSON.stringify({ choices: [{ message: { content } }] }),
      { status: 200 },
    );
  }) as unknown as typeof fetch;

  return {
    get url() {
      return capturedUrl;
    },
    get init() {
      return capturedInit;
    },
    get body() {
      return JSON.parse(String(capturedInit?.body));
    },
  };
}

const state: NegotiationState = {
  party: { name: "Seller", objective: "Sell for as much as possible" },
  history: [
    { role: "incoming", content: "I'll offer $300." },
    { role: "outgoing", content: "I can do $450." },
    { role: "incoming", content: "How about $350?" },
  ],
};

describe("Negotiator", () => {
  test("throws when no API key is available", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => new Negotiator()).toThrow(/API key/);
  });

  test("does not throw when an API key is provided explicitly", () => {
    delete process.env.OPENROUTER_API_KEY;
    expect(() => new Negotiator({ apiKey: "explicit-key" })).not.toThrow();
  });

  test("posts to the OpenRouter chat completions endpoint with auth header", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    expect(fetchMock.url).toBe(
      "https://openrouter.ai/api/v1/chat/completions",
    );
    expect(fetchMock.init?.method).toBe("POST");
    expect((fetchMock.init?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-key",
    );
  });

  test("defaults to google/gemini-3.7-flash when no model is given", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("google/gemini-3.7-flash");
  });

  test("uses the given model", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key", model: "google/gemini-3.5-flash" });

    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("google/gemini-3.5-flash");
  });

  test("builds a system prompt naming the party and its objective", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    const systemMessage = fetchMock.body.messages[0];
    expect(systemMessage.role).toBe("system");
    expect(systemMessage.content).toContain(state.party.name);
    expect(systemMessage.content).toContain(state.party.objective);
  });

  test("maps incoming history to user messages and outgoing to assistant messages, in order", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    const [, ...historyMessages] = fetchMock.body.messages;
    expect(historyMessages).toEqual([
      { role: "user", content: "I'll offer $300." },
      { role: "assistant", content: "I can do $450." },
      { role: "user", content: "How about $350?" },
    ]);
  });

  test("returns the model's reply content", async () => {
    mockFetchOnce("Let's settle at $400.");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    const reply = await negotiator.respond(state);

    expect(reply).toBe("Let's settle at $400.");
  });

  test("throws when the request fails", async () => {
    globalThis.fetch = (async () =>
      new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(negotiator.respond(state)).rejects.toThrow(/429/);
  });

  test("throws when the response has no content", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ choices: [] }), { status: 200 })) as unknown as typeof fetch;
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(negotiator.respond(state)).rejects.toThrow(/no content/);
  });
});

describe("Negotiator.decide", () => {
  test("requests JSON output and returns the parsed action/message", async () => {
    const fetchMock = mockFetchOnce(
      JSON.stringify({ action: "counter", message: "Let's settle at $400." }),
    );
    const negotiator = new Negotiator({ apiKey: "test-key" });

    const decision = await negotiator.decide(state, {
      allowedActions: ["counter", "accept", "reject"],
    });

    expect(fetchMock.body.response_format).toEqual({ type: "json_object" });
    expect(decision).toEqual({ action: "counter", message: "Let's settle at $400." });
  });

  test("lists the allowed actions in the system prompt", async () => {
    const fetchMock = mockFetchOnce(
      JSON.stringify({ action: "accept", message: "Deal." }),
    );
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.decide(state, { allowedActions: ["accept", "reject"] });

    const systemMessage = fetchMock.body.messages[0];
    expect(systemMessage.content).toContain("accept, reject");
  });

  test("includes descriptions for actions passed as { action, description }", async () => {
    const fetchMock = mockFetchOnce(
      JSON.stringify({ action: "escalate", message: "Handing this off." }),
    );
    const negotiator = new Negotiator({ apiKey: "test-key" });

    const decision = await negotiator.decide(state, {
      allowedActions: [
        { action: "escalate", description: "Hand off to a human for review" },
        "counter",
      ],
    });

    const systemMessage = fetchMock.body.messages[0];
    expect(systemMessage.content).toContain(
      "escalate (Hand off to a human for review), counter",
    );
    expect(decision).toEqual({ action: "escalate", message: "Handing this off." });
  });

  test("throws when the model chooses an action outside allowedActions", async () => {
    mockFetchOnce(JSON.stringify({ action: "accept", message: "Deal." }));
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(
      negotiator.decide(state, { allowedActions: ["counter", "reject"] }),
    ).rejects.toThrow(/disallowed action/);
  });

  test("throws when the model does not return valid JSON", async () => {
    mockFetchOnce("not json");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(
      negotiator.decide(state, { allowedActions: ["counter"] }),
    ).rejects.toThrow(/did not return valid JSON/);
  });

  test("throws when the JSON is missing action or message", async () => {
    mockFetchOnce(JSON.stringify({ action: "counter" }));
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(
      negotiator.decide(state, { allowedActions: ["counter"] }),
    ).rejects.toThrow(/malformed decision/);
  });
});

/** A fetch that hangs until its signal aborts — the shape of a counterparty
 * that accepts a connection and then never answers. If no signal reaches
 * it, it hangs forever, which is exactly the bug these tests guard. */
function mockFetchThatHangs() {
  let sawSignal: AbortSignal | null | undefined;
  globalThis.fetch = ((_url: string, init?: RequestInit) => {
    sawSignal = init?.signal;
    return new Promise((_resolve, reject) => {
      const signal = init?.signal;
      // Real fetch rejects straight away on an already-aborted signal; it
      // does not wait for an "abort" event that has already been and gone.
      if (signal?.aborted) return reject(signal.reason);
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  }) as unknown as typeof fetch;
  return {
    get signal() {
      return sawSignal;
    },
  };
}

describe("Negotiator deadlines", () => {
  test("bounds a model call that never answers", async () => {
    mockFetchThatHangs();
    const negotiator = new Negotiator({ apiKey: "test-key", timeoutMs: 20 });

    await expect(negotiator.respond(state)).rejects.toThrow(
      /OpenRouter request timed out after 20ms/,
    );
  });

  test("a per-call timeoutMs overrides the client's default", async () => {
    mockFetchThatHangs();
    const negotiator = new Negotiator({ apiKey: "test-key", timeoutMs: 60_000 });

    await expect(negotiator.respond(state, { timeoutMs: 20 })).rejects.toThrow(
      /timed out after 20ms/,
    );
  });

  test("a caller's abort stops a call already in flight", async () => {
    mockFetchThatHangs();
    const negotiator = new Negotiator({ apiKey: "test-key" });
    const controller = new AbortController();

    const pending = negotiator.decide(state, {
      allowedActions: ["accept", "reject"],
      signal: controller.signal,
    });
    controller.abort(new Error("host interrupted"));

    await expect(pending).rejects.toThrow("host interrupted");
  });

  test("a caller's abort is reported as theirs, never as our timeout", async () => {
    mockFetchThatHangs();
    const negotiator = new Negotiator({ apiKey: "test-key", timeoutMs: 60_000 });
    const controller = new AbortController();
    controller.abort(new Error("host interrupted"));

    const failure = await negotiator.respond(state, { signal: controller.signal }).catch(
      (error: unknown) => error,
    );

    // Rethrown as-is: a host must be able to tell its own cancellation
    // apart from a fault of ours, and match on the reason it supplied.
    expect(failure).toBeInstanceOf(Error);
    expect((failure as Error).message).toBe("host interrupted");
    expect((failure as Error).message).not.toMatch(/timed out/);
  });

  test("timeoutMs: 0 disables the deadline but leaves the signal working", async () => {
    const fetchMock = mockFetchThatHangs();
    const negotiator = new Negotiator({ apiKey: "test-key", timeoutMs: 0 });
    const controller = new AbortController();

    const pending = negotiator.respond(state, { signal: controller.signal });
    controller.abort(new Error("only the caller can stop this"));

    await expect(pending).rejects.toThrow("only the caller can stop this");
    expect(fetchMock.signal).toBe(controller.signal);
  });

  test("attaches a deadline signal to fetch even when the caller passes none", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    expect(fetchMock.init?.signal).toBeInstanceOf(AbortSignal);
  });
});


describe("Negotiator clock", () => {
  // A relative date in `terms` decays: "next Tuesday" is unresolvable a
  // week later, and unresolvable to the *other* party immediately, since
  // their "next Tuesday" is anchored to when they read it. Asking the model
  // for absolute dates only works if it knows what today is — otherwise it
  // invents one, and a confident wrong date is worse than a vague one.
  const fixed = () => new Date("2026-08-28T12:00:00Z");

  test("tells the model today's date, with the weekday", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key", now: fixed });

    await negotiator.respond(state);

    expect(fetchMock.body.messages[0].content).toContain("2026-08-28 (Friday)");
  });

  test("tells the model the date on decide() too", async () => {
    const fetchMock = mockFetchOnce('{"action":"accept","message":"ok"}');
    const negotiator = new Negotiator({ apiKey: "test-key", now: fixed });

    await negotiator.decide(state, { allowedActions: ["accept", "reject"] });

    expect(fetchMock.body.messages[0].content).toContain("2026-08-28 (Friday)");
  });

  test("asks for absolute dates when terms are requested", async () => {
    const fetchMock = mockFetchOnce('{"action":"accept","message":"ok"}');
    const negotiator = new Negotiator({ apiKey: "test-key", now: fixed });

    await negotiator.decide(state, {
      allowedActions: ["accept"],
      terms: "amount (number, USD), collection (date)",
    });

    const prompt = fetchMock.body.messages[0].content;
    expect(prompt).toContain("YYYY-MM-DD");
    expect(prompt).toContain("next Tuesday"); // named as the thing not to do
  });

  test("reads the clock per call, so a long-running server doesn't freeze", async () => {
    const dates = ["2026-08-28T12:00:00Z", "2026-09-04T12:00:00Z"];
    let call = 0;
    const negotiator = new Negotiator({
      apiKey: "test-key",
      now: () => new Date(dates[call++]!),
    });

    const first = mockFetchOnce("reply");
    await negotiator.respond(state);
    expect(first.body.messages[0].content).toContain("2026-08-28");

    const second = mockFetchOnce("reply");
    await negotiator.respond(state);
    expect(second.body.messages[0].content).toContain("2026-09-04");
  });

  test("renders the date in UTC even when the host timezone says otherwise", async () => {
    // Pinning the zone here, rather than inheriting the machine's, is what
    // makes this fail on a local-time implementation *anywhere*. On a UTC
    // box — CI, most containers — the process's own clock makes local and
    // UTC the same function, so a fixture that inherits it proves nothing.
    // Each pair is an instant plus a zone in which it falls on a different
    // local day, straddling midnight in both directions. The instants must
    // differ: 23:30Z is tomorrow in Auckland but the same local day in Los
    // Angeles, so reusing one would leave the western direction vacuous.
    const originalTz = process.env.TZ;
    const rendered: string[] = [];
    try {
      for (const [tz, instant] of [
        ["Pacific/Auckland", "2026-08-28T23:30:00Z"], // local: the 29th
        ["America/Los_Angeles", "2026-08-28T00:30:00Z"], // local: the 27th
      ] as const) {
        process.env.TZ = tz;
        const fetchMock = mockFetchOnce("reply");
        const negotiator = new Negotiator({
          apiKey: "test-key",
          now: () => new Date(instant),
        });

        await negotiator.respond(state);

        const prompt = String(fetchMock.body.messages[0].content);
        rendered.push(prompt.match(/Today's date is (.+)\./)?.[1] ?? prompt);
      }
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }

    // Compared as one array rather than asserted inside the loop: an
    // assertion in the loop short-circuits on the first zone, so a pair
    // that stopped discriminating would be masked by the one that still
    // does, and the failure would print only half the story.
    expect(rendered).toEqual(["2026-08-28 (Friday)", "2026-08-28 (Friday)"]);
  });

  test("shifting the instant moves the model onto another day", async () => {
    // The only timezone control there is: `now` hands back an instant, so a
    // host whose party lives elsewhere shifts it.
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({
      apiKey: "test-key",
      now: () => new Date(Date.parse("2026-08-28T02:00:00Z") - 8 * 60 * 60 * 1000),
    });

    await negotiator.respond(state);

    expect(fetchMock.body.messages[0].content).toContain("2026-08-27 (Thursday)");
  });

  test("defaults to the real clock", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    const today = new Date().toISOString().slice(0, 10);
    expect(fetchMock.body.messages[0].content).toContain(today);
  });
});

describe("Negotiator model fallback", () => {
  test("sends the default fallback after the primary in OpenRouter's models list", async () => {
    const fetchMock = mockFetchOnce("ok");
    const negotiator = new Negotiator({ apiKey: "test-key" });
    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("google/gemini-3.7-flash");
    expect(fetchMock.body.models).toEqual(["google/gemini-3.7-flash", "openai/gpt-5.4-mini"]);
  });

  test("uses the given fallbacks, in order, and never repeats the primary", async () => {
    const fetchMock = mockFetchOnce("ok");
    const negotiator = new Negotiator({
      apiKey: "test-key",
      model: "openai/gpt-5.4-mini",
      fallbackModels: ["openai/gpt-5.4-mini", "z-ai/glm-5.3-flash", "deepseek/deepseek-v4-flash-0731"],
    });
    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("openai/gpt-5.4-mini");
    expect(fetchMock.body.models).toEqual([
      "openai/gpt-5.4-mini",
      "z-ai/glm-5.3-flash",
      "deepseek/deepseek-v4-flash-0731",
    ]);
  });

  test("an empty fallback list disables routing and omits `models`", async () => {
    const fetchMock = mockFetchOnce("ok");
    const negotiator = new Negotiator({ apiKey: "test-key", fallbackModels: [] });
    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("google/gemini-3.7-flash");
    expect(fetchMock.body.models).toBeUndefined();
  });

  test("reports the model that answered when it wasn't the primary", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ model: "openai/gpt-5.4-mini", choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const seen: string[] = [];
    const negotiator = new Negotiator({ apiKey: "test-key", onFallback: (model) => seen.push(model) });

    await negotiator.respond(state);

    expect(seen).toEqual(["openai/gpt-5.4-mini"]);
  });

  test("stays quiet when the primary answered", async () => {
    globalThis.fetch = (async () =>
      new Response(
        JSON.stringify({ model: "google/gemini-3.7-flash", choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const seen: string[] = [];
    const negotiator = new Negotiator({ apiKey: "test-key", onFallback: (model) => seen.push(model) });

    await negotiator.respond(state);

    expect(seen).toEqual([]);
  });
});

describe("Negotiator client-side fallback", () => {
  function mockFetchSequence(bodies: object[]) {
    const requests: { model: string; models?: string[] }[] = [];
    let call = 0;
    globalThis.fetch = (async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body));
      requests.push({ model: body.model, models: body.models });
      const response = bodies[call] ?? bodies.at(-1)!;
      call++;
      return new Response(JSON.stringify(response), { status: 200 });
    }) as unknown as typeof fetch;
    return requests;
  }

  test("an empty 200 is retried on the fallback chain, skipping the primary", async () => {
    const requests = mockFetchSequence([
      { model: "google/gemini-3.7-flash", choices: [{ message: { content: "" } }] },
      { model: "openai/gpt-5.4-mini", choices: [{ message: { content: "Hello from the fallback." } }] },
    ]);
    const seen: string[] = [];
    const negotiator = new Negotiator({ apiKey: "test-key", onFallback: (model) => seen.push(model) });

    const reply = await negotiator.respond(state);

    expect(reply).toBe("Hello from the fallback.");
    expect(requests).toEqual([
      { model: "google/gemini-3.7-flash", models: ["google/gemini-3.7-flash", "openai/gpt-5.4-mini"] },
      { model: "openai/gpt-5.4-mini", models: undefined },
    ]);
    expect(seen).toEqual(["openai/gpt-5.4-mini"]);
  });

  test("an empty 200 with no fallback configured is the error it always was", async () => {
    mockFetchSequence([{ choices: [{ message: { content: "" } }] }]);
    const negotiator = new Negotiator({ apiKey: "test-key", fallbackModels: [] });

    await expect(negotiator.respond(state)).rejects.toThrow("OpenRouter response had no content.");
  });

  test("the fallback gets one try, not a loop", async () => {
    const requests = mockFetchSequence([{ choices: [{ message: { content: "" } }] }]);
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(negotiator.respond(state)).rejects.toThrow("OpenRouter response had no content.");
    expect(requests).toHaveLength(2);
  });

  test("decide() retries a non-JSON body on the fallback chain", async () => {
    const requests = mockFetchSequence([
      { model: "google/gemini-3.7-flash", choices: [{ message: { content: '{"action": "refine", "message": "I can do 4 hours a' } }] },
      {
        model: "openai/gpt-5.4-mini",
        choices: [{ message: { content: '{"action": "refine", "message": "I can do 4 hours a week."}' } }],
      },
    ]);
    const negotiator = new Negotiator({ apiKey: "test-key" });

    const decision = await negotiator.decide(state, { allowedActions: ["refine", "accept"] });

    expect(decision).toEqual({ action: "refine", message: "I can do 4 hours a week." });
    expect(requests.map((request) => request.model)).toEqual([
      "google/gemini-3.7-flash",
      "openai/gpt-5.4-mini",
    ]);
  });

  test("decide() still reports non-JSON when the fallback returns it too", async () => {
    mockFetchSequence([{ choices: [{ message: { content: "not json" } }] }]);
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await expect(
      negotiator.decide(state, { allowedActions: ["refine", "accept"] }),
    ).rejects.toThrow("model did not return valid JSON: not json");
  });
});
