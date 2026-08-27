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

  test("defaults to openai/gpt-4o-mini when no model is given", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key" });

    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("openai/gpt-4o-mini");
  });

  test("uses the given model", async () => {
    const fetchMock = mockFetchOnce("reply");
    const negotiator = new Negotiator({ apiKey: "test-key", model: "openai/gpt-4o" });

    await negotiator.respond(state);

    expect(fetchMock.body.model).toBe("openai/gpt-4o");
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
