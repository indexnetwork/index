import type { Agent } from "./agent.ts";
import type { ToolDefinition } from "./model.ts";
import type { NegotiationSession } from "./types.ts";

/** What a tool receives besides its own arguments. `agent` is the agent
 * running it, so a tool can reach the agent's own capabilities without a
 * circular construction; `negotiations` holds the exchanges open in this
 * run, keyed by id. */
export interface ToolContext {
  agent: Agent;
  negotiations: Map<string, NegotiationSession>;
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

export interface NegotiationToolOptions {
  /** Skip fetching the counterparty's AgentCard when opening. */
  discover?: boolean;
}

/**
 * Negotiating with another agent, one turn per tool call.
 *
 * Splitting open/continue is what lets the agent stop mid-negotiation — to
 * ask the user something, to check Index Network, to reconsider — and pick
 * the same exchange back up afterwards. A single run-to-completion call
 * would give it no gap to think in.
 *
 * Both tools return a `settlement` once either side closes. It is the only
 * thing that says whether anything was agreed — your own `accept` does
 * not, because the counterparty decides their turn independently and can
 * close differently in the same round trip.
 */
const SETTLEMENT_NOTE =
  " The result carries a `settlement` once either side closes. Read it before telling anyone what happened: `agreed` means both sides closed on the same deal; `conflict` or `unconfirmed` means nothing is agreed yet — whatever your own action was — so say that plainly, or take another turn to settle it.";

export function negotiationTools(options: NegotiationToolOptions = {}): Tool<never>[] {
  const open: Tool<{ url: string; objective: string }> = {
    name: "negotiate_open",
    description:
      "Open a negotiation with another agent at its A2A endpoint and take the first turn. Returns what you said, what they said back, and an id for continuing. Use negotiate_turn to carry on." +
      SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The counterparty agent's A2A base URL." },
        objective: {
          type: "string",
          description:
            "What to achieve in this negotiation specifically, e.g. 'buy the bike for under $400'. Read alongside your standing instructions and current intent.",
        },
      },
      required: ["url", "objective"],
    },
    run: ({ url, objective }, context) =>
      context.agent.openNegotiation(url, { objective, discover: options.discover }, context),
  };

  const turn: Tool<{ id: string; guidance?: string }> = {
    name: "negotiate_turn",
    description:
      "Take one more turn in a negotiation you already opened. Use `guidance` to fold in anything you have learned since the last turn — an answer from the party you represent, a limit, a change of position." +
      SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        id: { type: "string", description: "The negotiation id from negotiate_open." },
        guidance: {
          type: "string",
          description:
            "Extra direction for this turn only, e.g. 'they asked about delivery — Alice can do next Tuesday'.",
        },
      },
      required: ["id"],
    },
    run: ({ id, guidance }, context) => context.agent.continueNegotiation(id, { guidance }, context),
  };

  return [open as Tool<never>, turn as Tool<never>];
}

/** The tools an agent has when you don't give it any: ask the party it
 * acts for, and negotiate. Index Network operations are injected by the
 * host, which owns that transport and its auth. */
export function defaultTools(): Tool<never>[] {
  return [askUserTool() as Tool<never>, ...negotiationTools()];
}
