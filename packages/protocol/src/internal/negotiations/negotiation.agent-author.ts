/**
 * Decides a negotiation seat's turn with `@indexnetwork/agent`.
 *
 * A turn is a decision made under instructions with a fixed set of moves
 * available — which is what that package's loop is: a system prompt, a set of
 * tools, and a loop that runs until the work is done. The moves are injected
 * as tools, so the model picks one by *calling* it and the arguments are the
 * turn. Nothing is parsed back out of prose, and a reply that calls nothing is
 * a failed turn rather than a turn nobody can act on.
 *
 * Inputs are structural on purpose: this module sits in the `negotiations`
 * capability, and the caller lives in `agents`. It reads nothing and persists
 * nothing — the caller has already resolved the seat's intent, its brief and
 * the thread, and the negotiation graph owns every write.
 */
import { Agent, type MessageStore, type ModelMessage, type ModelPort, type Tool } from "@indexnetwork/agent";

import { createModelPort } from "../shared/agent/model.adapter.js";
import type { ModelConfig } from "../shared/agent/model.config.js";

import type { NegotiationAuthoredTurn } from "./negotiation.turn.js";

/** One turn as the caller already has it: who said it and what they said. */
export interface AgentAuthorThreadEntry {
  speaker: "self" | "counterparty";
  verb: string;
  message?: string;
}

export interface AgentAuthorInput {
  /** The seat's own signal, in the principal's words. */
  intentPayload: string;
  /** The seat's compact derived stance. */
  brief: string;
  /** Whether this seat opened the table. */
  openedByThisSeat: boolean;
  /** The negotiation's current state, for context only. */
  state: string;
  thread: AgentAuthorThreadEntry[];
  /**
   * The opening turn must be `outreach` and every later turn must not be, so
   * the two get different tool sets rather than a rule in the prompt that the
   * model may or may not honour.
   */
  isOpening: boolean;
  /** How the seat is named to its own model. */
  agentName?: string;
  /** Identifies the seat; the agent tells its model who it acts for. */
  userId: string;
}

export interface AgentAuthorOptions {
  /** Where the seat's model calls go. Defaults to this package's `negotiator` seat. */
  modelClient?: ModelPort;
  modelConfig?: ModelConfig;
}

/** A transcript store that keeps nothing: the negotiation thread is the record. */
const statelessHistory: MessageStore = {
  list: (): ModelMessage[] => [],
  save: (): void => {},
};

/**
 * How a turn's `message` must read.
 *
 * Every clause here is a failure someone shipped: agents that wrote emails
 * to each other, and agents that left `[Your Name]` in a message a real
 * counterparty then read.
 */
const MESSAGE_FORMAT_LAW = `Write it as a direct, plain-prose chat message — never a letter or email. No "Subject:" line, no salutation ("Dear", "Hi [name]"), no sign-off or signature block. Never write a placeholder like "[Your Name]" or "[Your Client's Name]": you are not producing a template for a human to fill in. If you do not have a name to use, speak in first person as the agent ("I'm reaching out on behalf of my principal") without naming yourself or your principal.`;

const REASONING = {
  type: "string",
  description: "Why this move, in one or two sentences. Private to your side — the other party never sees it.",
} as const;

const MESSAGE = {
  type: "string",
  description: "What the other party will read. This is the only part of your turn they see.",
} as const;

/** A tool whose arguments are the turn. */
function move<I>(
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: string[],
  toTurn: (input: I) => NegotiationAuthoredTurn,
  capture: (turn: NegotiationAuthoredTurn) => void,
): Tool<never> {
  return {
    name,
    description,
    parameters: { type: "object", properties, required, additionalProperties: false },
    run: ((input: I) => {
      capture(toTurn(input));
      return "Recorded. Your turn is complete.";
    }) as Tool<never>["run"],
  };
}

function turnTools(
  isOpening: boolean,
  capture: (turn: NegotiationAuthoredTurn) => void,
): Tool<never>[] {
  // Only the opening turn may reach out, and it may do nothing else: a first
  // turn that paused or countered would have nothing to pause or counter.
  if (isOpening) {
    return [
      move<{ message: string; reasoning: string }>(
        "outreach",
        "Open the negotiation: introduce what you are looking for and why this counterparty.",
        { message: MESSAGE, reasoning: REASONING },
        ["message", "reasoning"],
        (input) => ({ verb: "outreach", message: input.message, reasoning: input.reasoning }),
        capture,
      ),
    ];
  }

  return [
    move<{ message: string; reasoning: string }>(
      "counter",
      "Push back, or put a proposal of your own. Use this whenever you can move the negotiation forward yourself.",
      { message: MESSAGE, reasoning: REASONING },
      ["message", "reasoning"],
      (input) => ({ verb: "counter", message: input.message, reasoning: input.reasoning }),
      capture,
    ),
    move<{ message: string; reasoning: string }>(
      "question",
      "Ask the other party something you need from them before you can proceed.",
      { message: MESSAGE, reasoning: REASONING },
      ["message", "reasoning"],
      (input) => ({ verb: "question", message: input.message, reasoning: input.reasoning }),
      capture,
    ),
    move<{ question: string }>(
      "ask_principal",
      "Stop and ask the party you represent something only they can answer — a limit you do not know, or approval you cannot give yourself. The negotiation pauses until they reply.",
      { question: { type: "string", description: "One question for your own party. The other party never sees it." } },
      ["question"],
      (input) => ({ verb: "pause", reason: "needs_principal", payload: { question: input.question } }),
      capture,
    ),
    move<{ recommendation: "pending" | "reject"; reasoning: string }>(
      "ready_for_verdict",
      "You believe this can be decided. Recommend it to your own party's agent — you do not conclude the negotiation yourself.",
      {
        recommendation: {
          type: "string",
          enum: ["pending", "reject"],
          description: "pending recommends going ahead; reject recommends walking away.",
        },
        reasoning: { type: "string", description: "Why, for your own party's agent to weigh." },
      },
      ["recommendation", "reasoning"],
      (input) => ({ verb: "pause", reason: "ready_for_verdict", payload: { recommendation: input.recommendation, reasoning: input.reasoning } }),
      capture,
    ),
  ];
}

function renderThread(thread: AgentAuthorThreadEntry[]): string {
  if (thread.length === 0) return "(nothing said yet)";
  return thread
    .map((entry) => {
      const who = entry.speaker === "self" ? "You" : "Them";
      return entry.message ? `${who} (${entry.verb}): ${entry.message}` : `${who}: (${entry.verb})`;
    })
    .join("\n");
}

/**
 * Runs one seat's turn.
 *
 * @param input - The seat's resolved intent, brief and thread.
 * @param options - Where model calls go.
 * @returns The move the seat made.
 * @throws When the model answered without calling a move.
 */
export async function authorTurnWithAgent(
  input: AgentAuthorInput,
  options: AgentAuthorOptions = {},
): Promise<NegotiationAuthoredTurn> {
  let captured: NegotiationAuthoredTurn | undefined;

  const agent = new Agent({
    identity: {
      name: input.agentName ?? "Negotiator",
      id: input.userId,
      description: "Negotiates on its party's behalf.",
    },
    systemPrompt: [
      `YOUR CLIENT'S ACTUAL INTENT:\n${input.intentPayload}`,
      `NEGOTIATION CONTEXT:\nThis table is ${input.state}; ${input.openedByThisSeat ? "your seat opened it" : "the counterparty opened it"}.`,
      `BRIEF (A COMPACT DERIVED STANCE):\n${input.brief}`,
      input.isOpening
        ? "This is the opening turn. Call `outreach` with what you are looking for."
        : "Take exactly one move this turn by calling one of the tools you were given.",
      MESSAGE_FORMAT_LAW,
    ].join("\n\n"),
    tools: turnTools(input.isOpening, (turn) => { captured ??= turn; }),
    modelClient: options.modelClient ?? createModelPort("negotiator", options.modelConfig),
    history: statelessHistory,
    // One decision, one step: a move records and returns, so a second step
    // could only second-guess a turn already made.
    maxSteps: 1,
  });

  const result = await agent.run(
    `THREAD SO FAR:\n${renderThread(input.thread)}\n\n${input.isOpening ? "Write your opening outreach." : "Choose your move."}`,
  );

  if (!captured) {
    throw new Error(
      `PersonalAgent produced no negotiation move (run ended "${result.end}"${result.output ? `, said: ${result.output.slice(0, 200)}` : ""})`,
    );
  }
  return captured;
}
