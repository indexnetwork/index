import { expect, test } from "bun:test";

import type { Model, ModelMessage } from "./model.ts";
import { triageStall } from "./triage.ts";

const stall = { reason: "They asked what stage the company is at.", suggestedAsk: "What stage is your company at?" };

/** @param reply - What the one model call returns, or throws. @returns A model that answers once. */
function model(reply: ModelMessage | Error): Model {
  return {
    complete: async () => {
      if (reply instanceof Error) throw reply;
      return reply;
    },
  };
}

function classify(territory: string): ModelMessage {
  return {
    role: "assistant",
    content: null,
    tool_calls: [{ id: "1", type: "function", function: { name: "classify_stall", arguments: JSON.stringify({ reasoning: "Because.", territory }) } }],
  };
}

for (const territory of ["principal", "counterpart", "deferrable"] as const) {
  test(`reads ${territory} from classify_stall`, async () => {
    expect(await triageStall({ model: model(classify(territory)), stall, counterpartMessage: "What stage are you at?" })).toBe(territory);
  });
}

test("a model error reads as principal", async () => {
  expect(await triageStall({ model: model(new Error("OpenRouter request failed (500)")), stall, counterpartMessage: null })).toBe("principal");
});

test("no tool call reads as principal", async () => {
  expect(await triageStall({ model: model({ role: "assistant", content: "It is the counterpart's." }), stall, counterpartMessage: null })).toBe("principal");
});

test("an invalid territory reads as principal", async () => {
  expect(await triageStall({ model: model(classify("UNDETERMINED")), stall, counterpartMessage: null })).toBe("principal");
});
