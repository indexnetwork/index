import type { Agent } from "./agent.ts";
import { digest } from "./digest.ts";
import type { ToolDefinition } from "./model.ts";
import type { NegotiationEvent, NegotiationSession } from "./types.ts";

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

/** The names of the tools `negotiationTools()` returns, for anything that
 * needs to tell them apart from host-injected ones. */
export const NEGOTIATION_TOOLS: ReadonlySet<string> = new Set(["negotiate", "answer"]);

/**
 * Negotiating with other agents, the way a subagent works: each
 * negotiation runs in its own context and reports back once.
 *
 * Reading every turn of every exchange would bury the agent in payloads it
 * can't act on, and cost a model call per turn. So `negotiate` runs each
 * negotiation to an event — settled, waiting on the party, out of turns —
 * and returns one digest. The negotiator may take `ask` under that pump;
 * it is intercepted before the wire and the negotiation parks with its
 * question. `answer` is how the party's reply gets back in, and it holds
 * for the rest of the negotiation.
 */
const DIGEST_SETTLEMENT_NOTE =
  " Each Settled line names the outcome: `agreed` means both sides closed on the same deal; `conflict` or `unconfirmed` means nothing is agreed yet, whatever your own action was — say that plainly, or open a new negotiation to settle it. `unanswered` is different: you closed and the counterparty is still talking, so the Task is still open — a new negotiation with them is refused as a rival of itself; give this id to answer with how to respond to their last move instead.";

/** Turns a rejection from a promise in a `Promise.all` batch into the same
 * `failed` shape a negotiation itself would report, so one host-store
 * write failing (`sessions.save`, `lastPeerDecision`) can't sink the whole
 * batch the way an unhandled rejection would. */
function asFailed<A extends string>(id: string, cause: unknown): NegotiationEvent<A> {
  return {
    kind: "failed",
    id,
    error: cause instanceof Error ? cause.message : String(cause),
    turns: 0,
  };
}

export function negotiationTools(): Tool<never>[] {
  const negotiate: Tool<{ targets: { url: string; objective: string }[] }> = {
    name: "negotiate",
    description:
      "Open negotiations with one or more agents at their A2A endpoints and run each one on its own until it settles, needs something only the party you represent can tell you, or runs out of turns. Returns one digest with a line per negotiation; you only hear about what needs you. For lines under 'Waiting on you', ask your party once with ask_user, then call answer with every id the answer applies to — do that before you report back, and never re-open a counterparty to get around a question you have not answered. Each line names the URL it came from; use it to say which result belongs to which target." +
      DIGEST_SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        targets: {
          type: "array",
          items: {
            type: "object",
            properties: {
              url: { type: "string", description: "The counterparty agent's A2A base URL." },
              objective: {
                type: "string",
                description: "What to achieve with this counterparty specifically.",
              },
            },
            required: ["url", "objective"],
          },
        },
      },
      required: ["targets"],
    },
    run: async ({ targets }, context) =>
      digest(
        await Promise.all(
          targets.map((target) =>
            context.agent
              .runNegotiation(target.url, { objective: target.objective }, context)
              // The Task id isn't known until the negotiation opens, so a
              // rejection this early has nothing better to key on than
              // the target it was for.
              .catch((cause) => asFailed(target.url, cause)),
          ),
        ),
      ),
  };

  const answer: Tool<{ ids: string[]; guidance: string }> = {
    name: "answer",
    description:
      "Give negotiations what your party said, and move them on. Pass every id the answer applies to; the guidance holds for the rest of each negotiation. A negotiation you opened runs on with it — one waiting on your party, or one you closed that they answered with a counter. One they opened just holds it: the counterparty has the initiative, so nothing is sent until their next message. Returns the same digest as negotiate. A negotiation that has already ended is not touched — open a new one if the terms need to change." +
      DIGEST_SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Negotiation ids from a digest or your instructions." },
        guidance: {
          type: "string",
          description: "What your party said, as it applies to these negotiations, e.g. 'Bob's ceiling is $460 and he can collect Sunday'.",
        },
      },
      required: ["ids", "guidance"],
    },
    run: async ({ ids, guidance }, context) =>
      digest(
        await Promise.all(
          // De-duplicated, so an id repeated in the call doesn't pump the
          // same session twice concurrently.
          [...new Set(ids)].map((id) =>
            context.agent.answer(id, guidance, context).catch((cause) => asFailed(id, cause)),
          ),
        ),
      ),
  };

  return [negotiate as Tool<never>, answer as Tool<never>];
}

/** The tools an agent has when you don't give it any: ask the party it
 * acts for, and negotiate. Index Network operations are injected by the
 * host, which owns that transport and its auth. */
export function defaultTools(): Tool<never>[] {
  return [askUserTool() as Tool<never>, ...negotiationTools()];
}
