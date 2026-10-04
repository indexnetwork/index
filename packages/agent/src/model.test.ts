import { expect, test } from "bun:test";

import { ModelClient } from "./model.ts";

test("completion asks for low reasoning and a token cap", async () => {
  const bodies: Array<Record<string, unknown>> = [];
  const original = globalThis.fetch;
  globalThis.fetch = (async (_input: Parameters<typeof original>[0], init?: RequestInit) => {
    bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>);
    const signature = [{ type: "reasoning.encrypted", data: "sig" }];
    return new Response(JSON.stringify({
      choices: [{
        message: {
          role: "assistant",
          content: null,
          tool_calls: [{ id: "call-1", type: "function", function: { name: "note", arguments: "{}" } }],
          reasoning_details: signature,
        },
      }],
    }), { status: 200, headers: { "Content-Type": "application/json" } });
  }) as typeof fetch;

  try {
    const client = new ModelClient({ apiKey: "test-key", models: ["google/gemini-3.7-flash"] });
    const message = await client.complete(
      [{ role: "user", content: "hi" }],
      [{ type: "function", function: { name: "note", description: "Write a note", parameters: {} } }],
    );
    expect(bodies).toHaveLength(1);
    expect(bodies[0]).toMatchObject({
      max_tokens: 2048,
      reasoning: { effort: "low", exclude: true },
      models: ["google/gemini-3.7-flash"],
    });
    expect(message.reasoning_details).toEqual([{ type: "reasoning.encrypted", data: "sig" }]);
    expect(message.tool_calls?.[0]?.id).toBe("call-1");
  } finally {
    globalThis.fetch = original;
  }
});
