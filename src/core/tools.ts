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

/** What a result carrying `asking` instead of a settled turn means — read
 * before treating the tool's return value as something that actually went
 * out. Shared between `negotiate_open` and `negotiate_turn`. */
const ASKING_NOTE =
  " If the result carries `asking` instead, nothing was sent this turn — the negotiation would have committed to something you have not been told, so it is parked the same way a 'Waiting on you' line from negotiate_many is. Ask your party once with ask_user, then call negotiate_resume with this id and their answer — do not call negotiate_open or negotiate_turn again for it, that would either refuse (a rival) or send without the answer.";

/** The digest tools (`negotiate_many`/`negotiate_resume`) return prose, not
 * an object with `settlement` — this is `SETTLEMENT_NOTE`'s equivalent for
 * reading a `Settled` line in that text. */
const DIGEST_SETTLEMENT_NOTE =
  " Each Settled line names the outcome: `agreed` means both sides closed on the same deal; `conflict` or `unconfirmed` means nothing is agreed yet, whatever your own action was — say that plainly, or open a new negotiation to settle it.";

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

export function negotiationTools(options: NegotiationToolOptions = {}): Tool<never>[] {
  const open: Tool<{ url: string; objective: string }> = {
    name: "negotiate_open",
    description:
      "Open a negotiation with another agent at its A2A endpoint and take the first turn. Returns what you said, what they said back, and an id for continuing. Use negotiate_turn to carry on. Only for a counterparty you have no unfinished negotiation with: if you already have one, continue it with negotiate_turn, or answer it with negotiate_resume when it is waiting on your party." +
      SETTLEMENT_NOTE +
      ASKING_NOTE,
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
      "Take one more turn in a negotiation you already opened and that is still open. Use `guidance` to fold in anything you have learned since the last turn — an answer from the party you represent, a limit, a change of position. Once an exchange has ended, it is finished: do not take another turn in it to revisit the price or the terms, because that erases what was settled. Open a new negotiation instead." +
      SETTLEMENT_NOTE +
      ASKING_NOTE,
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

  const many: Tool<{ targets: { url: string; objective: string }[] }> = {
    name: "negotiate_many",
    description:
      "Open negotiations with several agents at once and run each one on its own until it settles, needs something only the party you represent can tell you, or runs out of turns. Returns one digest with a line per negotiation. Prefer this over negotiate_open whenever there is more than one counterparty: you only hear about what needs you. For lines under 'Waiting on you', ask your party once with ask_user, then call negotiate_resume with every id the answer applies to — do that before you report back, and never re-open a counterparty to get around a question you have not answered. Each line names the URL it came from; use it to say which result belongs to which target." +
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
              .runNegotiation(
                target.url,
                { objective: target.objective, discover: options.discover },
                context,
              )
              // The Task id isn't known until the negotiation opens, so a
              // rejection this early has nothing better to key on than
              // the target it was for.
              .catch((cause) => asFailed(target.url, cause)),
          ),
        ),
      ),
  };

  const resume: Tool<{ ids: string[]; guidance: string }> = {
    name: "negotiate_resume",
    description:
      "Give parked negotiations the answer they were waiting for and run them on. Pass every id the answer applies to; the guidance holds for the rest of each negotiation. Returns the same digest as negotiate_many. A negotiation that has already ended is not resumed — open a new one if the terms need to change." +
      DIGEST_SETTLEMENT_NOTE,
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Negotiation ids from the digest." },
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
            context.agent.resumeNegotiation(id, guidance, context).catch((cause) => asFailed(id, cause)),
          ),
        ),
      ),
  };

  const answerInbound: Tool<{ ids: string[]; guidance: string }> = {
    name: "answer_inbound",
    description:
      "Give your party's guidance to a negotiation someone else opened with you and that is waiting on you — see 'They are waiting on your party too' in your instructions. This does not take a turn: the counterparty holds the initiative, so nothing is sent. The guidance is just ready the next time they continue it. Pass every id the answer applies to.",
    parameters: {
      type: "object",
      properties: {
        ids: { type: "array", items: { type: "string" }, description: "Negotiation ids from your instructions." },
        guidance: {
          type: "string",
          description: "What your party said, as it applies to these negotiations, e.g. 'the ceiling is $460, and Sunday works'.",
        },
      },
      required: ["ids", "guidance"],
    },
    run: ({ ids, guidance }, context) =>
      [...new Set(ids)]
        .map((id) => {
          try {
            context.agent.answerInbound(id, guidance, context);
            return `${id}: recorded.`;
          } catch (cause) {
            return `${id}: ${cause instanceof Error ? cause.message : String(cause)}`;
          }
        })
        .join("\n"),
  };

  return [
    open as Tool<never>,
    turn as Tool<never>,
    many as Tool<never>,
    resume as Tool<never>,
    answerInbound as Tool<never>,
  ];
}

/** The tools an agent has when you don't give it any: ask the party it
 * acts for, and negotiate. Index Network operations are injected by the
 * host, which owns that transport and its auth. */
export function defaultTools(): Tool<never>[] {
  return [askUserTool() as Tool<never>, ...negotiationTools()];
}
