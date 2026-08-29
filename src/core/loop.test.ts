import { afterEach, describe, expect, test } from "bun:test";
import { Agent } from "./agent.ts";
import type { ModelMessage, ToolCall } from "./model.ts";
import { MemoryMessageStore } from "./sessions.ts";
import { askUserTool, type Tool } from "./tools.ts";

const originalFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = originalFetch;
});

/**
 * Intercepts only OpenRouter chat calls and replays scripted assistant
 * messages. Everything else — the A2A traffic between agents on real local
 * ports — is passed through to the original fetch.
 */
function mockModel(replies: Partial<ModelMessage>[]) {
  const requests: { model: string; messages: ModelMessage[]; tools?: unknown[] }[] = [];
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

/** A fixed clock, so the system message is the same on every run. The
 * agent is told the date so it can resolve "next Tuesday"; a test that
 * asserts the prompt shouldn't drift with the calendar. */
const TODAY = new Date("2026-08-28T09:00:00Z");
const TODAY_LINE =
  'Today is Friday, 28 August 2026. When you agree a date, record the actual date rather than a relative one like "next Tuesday", so the terms still mean the same thing when someone reads them later.';
const TOOL_DISCIPLINE_LINE =
  "Only call a tool from the list you were actually given this turn — what's offered can change as your situation does, so a capability you used before, or one that would make sense here, may not be available right now. If what you need isn't in that list, say so or ask, rather than calling a name you expect to exist.";

function agent(
  tools: Tool<never>[],
  systemPrompt = "You act for Alice.",
  options: { history?: MemoryMessageStore } = {},
) {
  return new Agent({
    identity: { name: "Alice's Agent", id: "did:example:alice" },
    systemPrompt,
    apiKey: "test-key",
    now: () => TODAY,
    tools,
    ...options,
  });
}

const echo: Tool<{ value: string }> = {
  name: "echo",
  description: "Echoes its input back.",
  parameters: {
    type: "object",
    properties: { value: { type: "string" } },
    required: ["value"],
  },
  run: ({ value }) => ({ echoed: value }),
};

describe("run()", () => {
  test("returns the model's text when it calls no tools", async () => {
    const requests = mockModel([{ role: "assistant", content: "Nothing to do." }]);

    const result = await agent([echo]).run("Say hello");

    expect(result.output).toBe("Nothing to do.");
    expect(result.end).toBe("done");
    expect(result.steps).toEqual([{ kind: "message", content: "Nothing to do." }]);
    expect(requests).toHaveLength(1);
  });

  test("sends the system prompt first and the task as the user message", async () => {
    const requests = mockModel([{ role: "assistant", content: "ok" }]);

    await agent([echo], "You act for Alice.").run("Sell the bike");

    expect(requests[0]?.messages).toEqual([
      {
        role: "system",
        content: `You act for Alice.\n\nYou are Alice's Agent, acting on behalf of did:example:alice.\n\n${TODAY_LINE}\n\n${TOOL_DISCIPLINE_LINE}`,
      },
      { role: "user", content: "Sell the bike" },
    ]);
  });

  test("states the intent in the system message when scoped", async () => {
    const requests = mockModel([{ role: "assistant", content: "ok" }]);

    await agent([echo]).for("Find a used road bike under $450").run("go");

    const system = String(requests[0]?.messages[0]?.content);
    expect(system).toContain("You act for Alice.");
    expect(system).toContain("acting on behalf of did:example:alice");
    expect(system).toContain("Current intent: Find a used road bike under $450");
  });

  test("advertises its tools to the model as JSON Schema", async () => {
    const requests = mockModel([{ role: "assistant", content: "ok" }]);

    await agent([echo]).run("anything");

    expect(requests[0]?.tools).toEqual([
      {
        type: "function",
        function: {
          name: "echo",
          description: "Echoes its input back.",
          parameters: {
            type: "object",
            properties: { value: { type: "string" } },
            required: ["value"],
          },
        },
      },
    ]);
  });

  test("runs a tool call and feeds the result back before finishing", async () => {
    const requests = mockModel([
      { role: "assistant", content: null, tool_calls: [call("echo", { value: "hi" })] },
      { role: "assistant", content: "It said hi." },
    ]);

    const result = await agent([echo]).run("Echo hi");

    expect(result.output).toBe("It said hi.");
    expect(result.steps).toEqual([
      { kind: "tool", name: "echo", input: { value: "hi" }, output: { echoed: "hi" } },
      { kind: "message", content: "It said hi." },
    ]);

    // The second call carries the assistant's tool call and the result.
    expect(requests[1]?.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "call_echo",
      content: JSON.stringify({ echoed: "hi" }),
    });
  });

  test("runs every tool call in one assistant message", async () => {
    mockModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          call("echo", { value: "one" }, "a"),
          call("echo", { value: "two" }, "b"),
        ],
      },
      { role: "assistant", content: "done" },
    ]);

    const result = await agent([echo]).run("Echo twice");

    expect(result.steps.filter((step) => step.kind === "tool")).toHaveLength(2);
  });

  test("feeds a thrown tool error back instead of ending the run", async () => {
    const boom: Tool = {
      name: "boom",
      description: "Always fails.",
      parameters: { type: "object", properties: {} },
      run: () => {
        throw new Error("the network is down");
      },
    };

    const requests = mockModel([
      { role: "assistant", content: null, tool_calls: [call("boom", {})] },
      { role: "assistant", content: "I'll try something else." },
    ]);

    const result = await agent([boom as Tool<never>]).run("Do it");

    expect(result.end).toBe("done");
    expect(result.output).toBe("I'll try something else.");
    expect(result.steps[0]).toEqual({
      kind: "tool",
      name: "boom",
      input: {},
      error: "the network is down",
    });
    expect(requests[1]?.messages.at(-1)?.content).toBe("Error: the network is down");
  });

  test("tells the model when it calls a tool that doesn't exist", async () => {
    const requests = mockModel([
      { role: "assistant", content: null, tool_calls: [call("nope", {})] },
      { role: "assistant", content: "Understood." },
    ]);

    await agent([echo]).run("Do it");

    expect(String(requests[1]?.messages.at(-1)?.content)).toContain('No tool named "nope"');
    expect(String(requests[1]?.messages.at(-1)?.content)).toContain("Available: echo");
  });

  test("reports malformed tool arguments rather than throwing", async () => {
    mockModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [{ id: "x", type: "function", function: { name: "echo", arguments: "{oops" } }],
      },
      { role: "assistant", content: "ok" },
    ]);

    const result = await agent([echo]).run("Do it");

    expect(result.steps[0]).toMatchObject({ kind: "tool", name: "echo" });
    expect(String((result.steps[0] as { error?: string }).error)).toContain("not valid JSON");
  });

  test("stops at maxSteps while the model is still calling tools", async () => {
    mockModel([{ role: "assistant", content: null, tool_calls: [call("echo", { value: "x" })] }]);

    const result = await agent([echo]).run("Loop forever", { maxSteps: 3 });

    expect(result.end).toBe("max-steps");
    expect(result.steps.filter((step) => step.kind === "tool")).toHaveLength(3);
  });

  test("reports steps as they happen", async () => {
    mockModel([
      { role: "assistant", content: null, tool_calls: [call("echo", { value: "hi" })] },
      { role: "assistant", content: "done" },
    ]);

    const seen: string[] = [];
    await agent([echo]).run("Echo hi", {
      onStep: (step) => seen.push(step.kind === "tool" ? `tool:${step.name}` : "message"),
    });

    expect(seen).toEqual(["tool:echo", "message"]);
  });
});

describe("continuing a conversation", () => {
  test("replays prior messages and replaces the stored system prompt", async () => {
    mockModel([{ role: "assistant", content: "first" }]);
    const first = await agent([echo], "Old instructions.").run("one");

    const requests = mockModel([{ role: "assistant", content: "second" }]);
    await agent([echo], "New instructions.").run("two", { messages: first.messages });

    expect(requests[0]?.messages).toEqual([
      {
        role: "system",
        content: `New instructions.\n\nYou are Alice's Agent, acting on behalf of did:example:alice.\n\n${TODAY_LINE}\n\n${TOOL_DISCIPLINE_LINE}`,
      },
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ]);
  });

  test("falls back to the history store when messages is omitted", async () => {
    const history = new MemoryMessageStore();
    mockModel([{ role: "assistant", content: "first" }]);
    await agent([echo], "You act for Alice.", { history }).run("one");

    const requests = mockModel([{ role: "assistant", content: "second" }]);
    // A fresh Agent, over the same store, with no `messages` passed at all.
    await agent([echo], "You act for Alice.", { history }).run("two");

    expect(requests[0]?.messages).toEqual([
      {
        role: "system",
        content: `You act for Alice.\n\nYou are Alice's Agent, acting on behalf of did:example:alice.\n\n${TODAY_LINE}\n\n${TOOL_DISCIPLINE_LINE}`,
      },
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ]);
  });

  test("an explicit messages argument wins over the history store", async () => {
    const history = new MemoryMessageStore();
    history.save([
      { role: "system", content: "stale" },
      { role: "user", content: "stale turn" },
    ]);

    mockModel([{ role: "assistant", content: "first" }]);
    const first = await agent([echo], "Old instructions.", {}).run("one");

    const requests = mockModel([{ role: "assistant", content: "second" }]);
    await agent([echo], "New instructions.", { history }).run("two", {
      messages: first.messages,
    });

    expect(requests[0]?.messages).not.toContainEqual({ role: "user", content: "stale turn" });
    expect(requests[0]?.messages).toEqual([
      {
        role: "system",
        content: `New instructions.\n\nYou are Alice's Agent, acting on behalf of did:example:alice.\n\n${TODAY_LINE}\n\n${TOOL_DISCIPLINE_LINE}`,
      },
      { role: "user", content: "one" },
      { role: "assistant", content: "first" },
      { role: "user", content: "two" },
    ]);
  });
});

describe("asking the user", () => {
  const ask = (question: string, id = "ask_1") => ({
    id,
    type: "function" as const,
    function: { name: "ask_user", arguments: JSON.stringify({ question }) },
  });

  test("suspends instead of running the tool, and holds nothing open", async () => {
    mockModel([{ role: "assistant", content: null, tool_calls: [ask("What's your budget?")] }]);

    const result = await agent([echo, askUserTool() as Tool<never>]).run("Buy a bike");

    expect(result.end).toBe("needs-input");
    expect(result.pending).toEqual({ question: "What's your budget?" });
    expect(result.steps).toEqual([{ kind: "ask", question: "What's your budget?" }]);
  });

  test("carries the options through when the agent offers a choice", async () => {
    mockModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          {
            id: "a",
            type: "function",
            function: {
              name: "ask_user",
              arguments: JSON.stringify({ question: "Which?", options: ["road", "commuter"] }),
            },
          },
        ],
      },
    ]);

    const result = await agent([askUserTool() as Tool<never>]).run("Pick one");

    expect(result.pending).toEqual({ question: "Which?", options: ["road", "commuter"] });
  });

  test("resumes from the answer, recording it as the tool's result", async () => {
    mockModel([{ role: "assistant", content: null, tool_calls: [ask("What's your budget?")] }]);
    const suspended = await agent([askUserTool() as Tool<never>]).run("Buy a bike");

    const requests = mockModel([{ role: "assistant", content: "Understood, $450." }]);
    const resumed = await agent([askUserTool() as Tool<never>]).run("$450 max", {
      messages: suspended.messages,
    });

    expect(resumed.end).toBe("done");
    expect(resumed.output).toBe("Understood, $450.");

    // The answer goes back as the tool result, not as a new user message.
    expect(requests[0]?.messages.at(-1)).toEqual({
      role: "tool",
      tool_call_id: "ask_1",
      content: "$450 max",
    });
    expect(requests[0]?.messages.filter((m) => m.role === "user")).toHaveLength(1);
  });

  test("runs the other tools in the same turn before suspending", async () => {
    const requests = mockModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [
          { id: "e", type: "function", function: { name: "echo", arguments: '{"value":"hi"}' } },
          ask("And your budget?", "q"),
        ],
      },
    ]);

    const result = await agent([echo, askUserTool() as Tool<never>]).run("Do both");

    expect(result.end).toBe("needs-input");
    expect(result.steps.map((s) => s.kind)).toEqual(["tool", "ask"]);
    // echo answered; the question left open for the host.
    expect(requests[0]).toBeDefined();
    const tools = result.messages.filter((m) => m.role === "tool");
    expect(tools).toHaveLength(1);
    expect(tools[0]?.tool_call_id).toBe("e");
  });

  test("tells the model to ask a second question only after the first is answered", async () => {
    mockModel([
      {
        role: "assistant",
        content: null,
        tool_calls: [ask("First?", "q1"), ask("Second?", "q2")],
      },
    ]);

    const result = await agent([askUserTool() as Tool<never>]).run("Ask two things");

    expect(result.pending?.question).toBe("First?");
    const second = result.messages.find((m) => m.role === "tool" && m.tool_call_id === "q2");
    expect(String(second?.content)).toContain("Only one question at a time");
  });
});
