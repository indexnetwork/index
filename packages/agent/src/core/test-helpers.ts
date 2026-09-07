// Fixtures shared by the test files. Not a `.test.ts`, so `bun test` doesn't
// collect it as a suite, and excluded from the build so no `.d.ts` is emitted.
import type { ModelMessage, ToolCall } from "./model.ts";

const originalFetch = globalThis.fetch;

/** Puts the real fetch back. Each file that uses `mockModel` registers
 * `afterEach(restoreFetch)` itself — a cached module would register it once,
 * for whichever file imported first. */
export function restoreFetch(): void {
  globalThis.fetch = originalFetch;
}

/**
 * Intercepts only OpenRouter chat calls and replays scripted assistant
 * messages, or whole responses when an entry is a function. Everything
 * else is passed through to the original fetch. Returns the request bodies
 * it saw.
 */
export function mockModel(
  replies: (Partial<ModelMessage> | ((init?: RequestInit) => Response | Promise<Response>))[],
) {
  const requests: { model: string; messages: ModelMessage[]; tools?: unknown[] }[] = [];
  let call = 0;

  globalThis.fetch = (async (input: unknown, init?: RequestInit) => {
    const url = typeof input === "string" ? input : String((input as Request).url ?? input);
    if (!url.startsWith("https://openrouter.ai")) {
      return (originalFetch as (i: unknown, x?: RequestInit) => Promise<Response>)(input, init);
    }

    requests.push(JSON.parse(String(init?.body)));
    const reply = replies[call] ?? replies.at(-1);
    call++;
    if (typeof reply === "function") return await reply(init);
    return new Response(JSON.stringify({ choices: [{ message: reply }] }), { status: 200 });
  }) as unknown as typeof fetch;

  return requests;
}

export function call(name: string, args: unknown, id = `call_${name}`): ToolCall {
  return { id, type: "function", function: { name, arguments: JSON.stringify(args) } };
}
