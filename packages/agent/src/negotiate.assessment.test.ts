import { describe, expect, test } from "bun:test";
import { MockLanguageModelV4 } from "ai/test";

import { negotiate } from "./negotiate.ts";
import type { AssessmentSelection, NegotiateInput } from "./types.ts";

type Call = { toolName: string; input: Record<string, unknown> };

/** A model that answers each step with the next scripted tool call and records what it saw. */
function scripted(calls: Call[], seen: { prompts: string[]; toolNames: string[][]; parameters: unknown[] }) {
  let step = 0;
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      seen.prompts.push(JSON.stringify(options.prompt));
      const tools = (options.tools ?? []) as { name: string; inputSchema?: unknown }[];
      seen.toolNames.push(tools.map((tool) => tool.name));
      seen.parameters.push(tools.find((tool) => tool.name === "submit_turn")?.inputSchema);
      const call = calls[Math.min(step++, calls.length - 1)]!;
      return {
        finishReason: { unified: "tool-calls" as const, raw: "tool-calls" },
        usage: {
          inputTokens: { total: 1, noCache: 1, cacheRead: 0, cacheWrite: 0 },
          outputTokens: { total: 1, text: 1, reasoning: 0 },
        },
        content: [{ type: "tool-call" as const, toolCallId: `call-${step}`, toolName: call.toolName, input: JSON.stringify(call.input) }],
        warnings: [],
      };
    },
  });
}

function baseInput(model: NegotiateInput["model"], extra?: Partial<NegotiateInput>): NegotiateInput {
  return {
    user: { id: "u", name: "Seren", profileConfirmed: true },
    intent: { id: "i", statement: "Meet robotics researchers." },
    brief: "Find out whether the counterpart works on robotics.",
    opportunity: { id: "opp-1", counterpart: "C", status: "negotiating", awaiting: "you", turnCount: 0, turns: [], maxTurns: 12, remainingTurns: 12, actions: ["propose", "counter", "accept", "decline"], intent: { statement: "Meet builders." } } as NegotiateInput["opportunity"],
    model,
    ...extra,
  };
}

const MENU = ["act-propose", "act-decline"];
const guidance = (onSelection?: (s: AssessmentSelection) => void, preferred: string | null = "act-propose") => ({
  text: "PRIVATE MORALMOD ASSESSMENT — test context block.",
  orderedActionIds: MENU,
  preferredActionId: preferred,
  ...(onSelection ? { onSelection } : {}),
});

describe("negotiate without assessment", () => {
  test("prompt and tools carry no assessment artifacts", async () => {
    const seen = { prompts: [] as string[], toolNames: [] as string[][], parameters: [] as unknown[] };
    const model = scripted([{ toolName: "submit_turn", input: { action: "propose", message: "Hello" } }], seen);
    const result = await negotiate(baseInput(model));
    expect(result).toEqual({ turn: { action: "propose", message: "Hello" } });
    expect(seen.prompts.join()).not.toContain("MORALMOD");
    expect(JSON.stringify(seen.parameters)).not.toContain("assessment_choice");
  });
});

describe("negotiate with assessment", () => {
  test("an exact top tie stalls without a model call", async () => {
    const selections: AssessmentSelection[] = [];
    const model = new MockLanguageModelV4({ doGenerate: async () => { throw new Error("model must not be called"); } });
    const result = await negotiate(baseInput(model, { assessment: guidance((s) => selections.push(s), null) }));
    expect("stall" in result).toBe(true);
    expect(selections).toEqual([{ selectedActionId: null, divergence: "tie", reason: "Exact top tie under selected template." }]);
  });

  test("an aligned turn passes, strips assessment fields, and fires onSelection", async () => {
    const selections: AssessmentSelection[] = [];
    const seen = { prompts: [] as string[], toolNames: [] as string[][], parameters: [] as unknown[] };
    const model = scripted([{ toolName: "submit_turn", input: { action: "propose", message: "Hello", assessment_choice: "act-propose", assessment_divergence: "none", assessment_reason: null } }], seen);
    const result = await negotiate(baseInput(model, { assessment: guidance((s) => selections.push(s)) }));
    expect(result).toEqual({ turn: { action: "propose", message: "Hello" } });
    expect(selections).toEqual([{ selectedActionId: "act-propose", divergence: "none", reason: null }]);
    expect(seen.prompts[0]).toContain("PRIVATE MORALMOD ASSESSMENT");
    expect(JSON.stringify(seen.parameters[0])).toContain("assessment_choice");
  });

  test("divergence none with a non-preferred choice is rejected, and the model can correct", async () => {
    const selections: AssessmentSelection[] = [];
    const model = scripted([
      { toolName: "submit_turn", input: { action: "propose", message: "Hello", assessment_choice: "act-decline", assessment_divergence: "none", assessment_reason: null } },
      { toolName: "submit_turn", input: { action: "propose", message: "Hello", assessment_choice: "act-propose", assessment_divergence: "none", assessment_reason: null } },
    ], { prompts: [], toolNames: [], parameters: [] });
    const result = await negotiate(baseInput(model, { assessment: guidance((s) => selections.push(s)) }));
    expect(result).toEqual({ turn: { action: "propose", message: "Hello" } });
    expect(selections).toEqual([{ selectedActionId: "act-propose", divergence: "none", reason: null }]);
  });

  test("a divergence without a reason is rejected, and a reasoned constraint passes", async () => {
    const selections: AssessmentSelection[] = [];
    const model = scripted([
      { toolName: "submit_turn", input: { action: "decline", message: "Passing.", assessment_choice: "act-decline", assessment_divergence: "constraint", assessment_reason: null } },
      { toolName: "submit_turn", input: { action: "decline", message: "Passing.", assessment_choice: "act-decline", assessment_divergence: "constraint", assessment_reason: "The intent requires Berlin presence." } },
    ], { prompts: [], toolNames: [], parameters: [] });
    const result = await negotiate(baseInput(model, { assessment: guidance((s) => selections.push(s)) }));
    expect(result).toEqual({ turn: { action: "decline", message: "Passing." } });
    expect(selections).toEqual([{ selectedActionId: "act-decline", divergence: "constraint", reason: "The intent requires Berlin presence." }]);
  });

  test("a stall reports clarification with the preferred action", async () => {
    const selections: AssessmentSelection[] = [];
    const model = scripted([{ toolName: "stall", input: { reason: "The brief does not state the stage.", suggestedAsk: "What stage are you at?" } }], { prompts: [], toolNames: [], parameters: [] });
    const result = await negotiate(baseInput(model, { assessment: guidance((s) => selections.push(s)) }));
    expect("stall" in result).toBe(true);
    expect(selections).toEqual([{ selectedActionId: "act-propose", divergence: "clarification", reason: "The brief does not state the stage." }]);
  });
});
