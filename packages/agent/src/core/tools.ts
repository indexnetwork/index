import type { Agent } from "./agent.ts";
import type { ToolDefinition } from "./model.ts";

/** What a tool receives besides its own arguments. `agent` is the agent
 * running it, so a tool can reach the agent's own capabilities without a
 * circular construction. */
export interface ToolContext {
  agent: Agent;
  signal?: AbortSignal;
}

/**
 * One capability the agent can invoke. `parameters` is a JSON Schema for
 * the arguments; the model is handed it verbatim, so describe the fields
 * well — it's the only thing telling the model how to call this.
 *
 * A tool with `suspends` doesn't run at all. The loop stops when the model
 * calls it and hands the arguments back to the host, which supplies the
 * result later by resuming the run. That's how `askUserTool()` works, and
 * anything else that needs a human or another system to answer can work
 * the same way.
 */
export interface Tool<I = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run?: (input: I, context: ToolContext) => unknown | Promise<unknown>;
  suspends?: boolean;
}

export function toolDefinition(tool: Tool<never>): ToolDefinition {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}

/**
 * Asking the party this agent acts for. The loop suspends when this is
 * called: `run()` returns `end: "needs-input"` with the question, and the
 * host resumes by passing the answer to the next `run()`.
 *
 * Nothing is held open in the meantime, so the user can answer in ten
 * seconds or in two days, in this process or another one.
 */
export function askUserTool(): Tool<{ question: string; options?: string[] }> {
  return {
    name: "ask_user",
    description:
      "Ask the party you represent a question, when their answer would materially change what you do — a limit you don't know, a preference between options, or approval for something you can't decide alone. They may not answer immediately. Ask one question at a time, and only when you cannot proceed sensibly without it.",
    parameters: {
      type: "object",
      properties: {
        question: {
          type: "string",
          description: "The question, in plain language, as you'd put it to them directly.",
        },
        options: {
          type: "array",
          items: { type: "string" },
          description: "Suggested answers, if this is a choice rather than an open question.",
        },
      },
      required: ["question"],
    },
    suspends: true,
  };
}

/** The tools an agent has when you don't give it any: ask the party it
 * acts for. Index Network operations are injected by the host, which owns
 * that transport and its auth. */
export function defaultTools(): Tool<never>[] {
  return [askUserTool() as Tool<never>];
}
