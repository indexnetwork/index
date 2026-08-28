import { describe, expect, test } from "bun:test";

import { ModelClient } from "./model.ts";

/** Stands in for OpenRouter: replies from a script, one entry per request,
 * and records how many times it was called. */
function openRouter(replies: (() => Promise<Response> | Response)[]) {
  let calls = 0;
  const server = Bun.serve({
    port: 0,
    fetch: async () => {
      const reply = replies[Math.min(calls++, replies.length - 1)]!;
      return await reply();
    },
  });
  return { url: server.url.toString(), stop: () => server.stop(true), calls: () => calls };
}

/** A ModelClient pointed at a local stand-in rather than OpenRouter. */
function clientAgainst(url: string, options: { timeout?: number; attempts?: number } = {}) {
  const client = new ModelClient({ apiKey: "test-key", ...options });
  const original = globalThis.fetch;
  globalThis.fetch = ((input: string | URL | Request, init?: RequestInit) => {
    const target = input instanceof Request ? input.url : String(input);
    return original(target.startsWith("https://openrouter.ai") ? url : target, init);
  }) as typeof fetch;
  return { client, restore: () => (globalThis.fetch = original) };
}

const answer = () =>
  Response.json({ choices: [{ message: { role: "assistant", content: "hello" } }] });

describe("ModelClient timeouts and retries", () => {
  test("returns the reply when the first attempt works", async () => {
    const server = openRouter([answer]);
    const { client, restore } = clientAgainst(server.url);

    try {
      expect((await client.complete([])).content).toBe("hello");
      expect(server.calls()).toBe(1);
    } finally {
      restore();
      server.stop();
    }
  });

  // The reason this exists: a request that never comes back used to hang
  // the agent until someone pressed ^C.
  test("gives up on a hung request and tries again", async () => {
    const server = openRouter([
      () => new Promise<Response>(() => {}), // never resolves
      answer,
    ]);
    const { client, restore } = clientAgainst(server.url, { timeout: 150, attempts: 2 });

    try {
      expect((await client.complete([])).content).toBe("hello");
      expect(server.calls()).toBe(2);
    } finally {
      restore();
      server.stop();
    }
  });

  test("retries a rate limit and a 5xx", async () => {
    const server = openRouter([
      () => new Response("slow down", { status: 429, headers: { "retry-after": "0" } }),
      () => new Response("boom", { status: 503 }),
      answer,
    ]);
    const { client, restore } = clientAgainst(server.url, { attempts: 3 });

    try {
      expect((await client.complete([])).content).toBe("hello");
      expect(server.calls()).toBe(3);
    } finally {
      restore();
      server.stop();
    }
  });

  // A bad key fails the same way however many times it is sent.
  test("does not retry a request that cannot succeed", async () => {
    const server = openRouter([() => new Response("bad key", { status: 401 })]);
    const { client, restore } = clientAgainst(server.url, { attempts: 3 });

    try {
      expect(client.complete([])).rejects.toThrow(/401/);
      await Bun.sleep(50);
      expect(server.calls()).toBe(1);
    } finally {
      restore();
      server.stop();
    }
  });

  test("reports the last failure once the attempts are spent", async () => {
    const server = openRouter([() => new Response("boom", { status: 503 })]);
    const { client, restore } = clientAgainst(server.url, { attempts: 2 });

    try {
      expect(client.complete([])).rejects.toThrow(/after 2 attempts/);
    } finally {
      restore();
      server.stop();
    }
  });

  // An interrupted run is a decision, not a failure — retrying would
  // ignore the user.
  test("an interrupted call is not retried", async () => {
    const server = openRouter([() => new Promise<Response>(() => {})]);
    const { client, restore } = clientAgainst(server.url, { timeout: 5_000, attempts: 3 });
    const controller = new AbortController();

    try {
      const pending = client.complete([], [], controller.signal);
      setTimeout(() => controller.abort(), 50);
      expect(pending).rejects.toThrow();
      await Bun.sleep(200);
      expect(server.calls()).toBe(1);
    } finally {
      restore();
      server.stop();
    }
  });
});
