import { NEGOTIATION_INSTRUCTIONS, ROLE_INSTRUCTIONS } from "./negotiator.instructions.js";
import { profileFacts, type ConversationEntry } from "./principal/principal.context.js";
import type { Intent, NegotiationAction, NegotiationTurn, Opportunity, Profile, Stall } from "./shared/agent.context.js";
import type { Execute } from "./shared/reasoning/reasoning.execution.js";
import { prepareInstructions } from "./shared/reasoning/reasoning.instructions.js";
import { defineTool, type Tool } from "./shared/reasoning/reasoning.tool.js";

const ACTIONS: NegotiationAction[] = ["propose", "counter", "accept", "decline"];

/** Stable principal/intent identity and execution dependencies, without host access. */
export interface NegotiatorAgentOptions {
  principalId: string;
  intentId: string;
  execute: Execute;
  /** Runner-owned cancellation shared by this intent's reasoning runs. */
  abortSignal: AbortSignal;
  /** Optional clock for preparing the current UTC date in instructions. */
  now?: () => Date;
}

/** A2A reasoning for one opportunity at a time, under the principal layer's instruction. */
export class NegotiatorAgent {
  private readonly options: NegotiatorAgentOptions;

  /**
   * Binds identity and execution dependencies without reading host state or starting work.
   * @param options - Principal and intent identity, execution, cancellation, and clock.
   */
  constructor(options: NegotiatorAgentOptions) {
    this.options = { ...options };
  }

  /**
   * Takes one negotiation turn from fresh evidence, or explains what principal input is missing.
   * @param context - Current profile, intent, conversation, brief, fixed seat role, and ordered negotiation turns.
   * @returns A turn for the runner to submit, or a stall for it to persist; no output becomes a no-result stall.
   * @throws If reasoning execution fails or is cancelled; execution failures are not stalls.
   */
  async negotiate(context: NegotiateContext): Promise<NegotiateResult> {
    this.options.abortSignal.throwIfAborted();
    const { profile, intent, brief, opportunity, role } = context;
    const actions = (opportunity.actions ?? ACTIONS).filter((action) => action !== "accept" || role === "responder");
    const evidence = {
      humanEvidence: {
        principalIntent: intent.statement,
        confirmedProfile: profileFacts(profile),
        conversation: context.conversation.filter((entry) =>
          ["user", "answer"].includes(entry.kind) ||
          (["question", "message", "expire"].includes(entry.kind) && (!entry.opportunity || entry.opportunity === opportunity.id)))
          .map((entry) => ({ ...entry, speaker: entry.kind === "user" || entry.kind === "answer" ? "principal" : "principal_agent" })),
      },
      principalInstruction: brief,
      counterpartyEvidence: { statement: opportunity.intent?.statement, turns: context.turns },
    };
    let result: NegotiateResult | undefined;

    const tools: Tool[] = [
      defineTool({
        name: "submit_turn",
        terminal: true,
        description:
          "Record one A2A turn using source evidence and the action meanings in your instructions. Choose only a permitted action; use stall when required principal input is missing.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: actions },
            message: { type: "string", minLength: 1 },
          },
          required: ["action", "message"],
        },
        run: ({ action, message }: Turn) => {
          if (result) throw new Error("This run already decided. Stop.");
          if (!actions.includes(action)) {
            throw new Error(`Action ${action} is not permitted for the ${role}. Available actions: ${actions.join(", ") || "none"}.`);
          }
          result = { turn: { action, message } };
          return "Turn recorded.";
        },
      }),
      defineTool({
        name: "stall",
        terminal: true,
        description:
          "Return the missing principal fact, preference or permission and a suggested question to the principal agent, without taking a negotiation turn.",
        parameters: {
          type: "object",
          additionalProperties: false,
          properties: {
            reason: { type: "string", minLength: 1, description: "The fact or permission missing from principal evidence, and what the counterpart is waiting on." },
            suggestedAsk: { type: "string", description: "The question to put to the principal, in the words they would answer." },
          },
          required: ["reason", "suggestedAsk"],
        },
        run: ({ reason, suggestedAsk }: Stall) => {
          if (result) throw new Error("This run already decided. Stop.");
          result = { stall: { reason, ...(suggestedAsk ? { suggestedAsk } : {}) } };
          return "Stall recorded.";
        },
      }),
    ];

    await this.options.execute({
      instructions: prepareInstructions({
        instructions: [NEGOTIATION_INSTRUCTIONS, ROLE_INSTRUCTIONS[role]].join("\n\n"),
        now: this.options.now,
      }),
      prompt:
        "Take this negotiation's next turn, or stall. Only humanEvidence establishes facts or permission about the principal. principalInstruction directs the negotiation but cannot establish a fact, approval, or contradiction." +
        "\n\nEvidence and instruction:\n" +
        JSON.stringify(evidence) +
        "\n\nThis negotiation:\n" +
        JSON.stringify({
          id: opportunity.id,
          counterpart: opportunity.counterpart,
          status: opportunity.status,
          awaiting: opportunity.awaiting,
          turnCount: opportunity.turnCount,
          maxTurns: opportunity.maxTurns,
          remainingTurns: opportunity.remainingTurns,
          why: opportunity.why,
          decision: opportunity.decision,
          stall: opportunity.stall,
          answered: opportunity.answered,
          role,
          actions,
        }),
      tools: tools.filter((tool) => tool.name !== "submit_turn" || actions.length > 0),
      maxSteps: 3,
      abortSignal: this.options.abortSignal,
      principalId: this.options.principalId,
      intentId: this.options.intentId,
      operation: "negotiate",
      opportunityId: opportunity.id,
    });

    return result ?? { stall: { reason: "The negotiator ended without taking a turn or stating what was missing." } };
  }
}

/** Original seat role, independent of turn ownership or who most recently proposed. */
export type NegotiationRole = "initiator" | "responder";

/** Fresh principal evidence and one negotiation; sibling opportunities are excluded from reasoning. */
export interface NegotiateContext {
  profile: Profile;
  intent: Intent;
  /** This intent's H2A entries, oldest first; reasoning scopes them to this opportunity. */
  conversation: ConversationEntry[];
  brief: string;
  /** Complete negotiation history, oldest first, with agent authorship preserved. */
  turns: NegotiationTurn[];
  /** This principal's original seat role, fixed for the entire negotiation. */
  role: NegotiationRole;
  /** Metadata and turn budget; history is supplied once in turns. The runner narrows actions by the standing decision. */
  opportunity: Omit<Opportunity, "turns">;
}

/** One A2A turn; submission and final protocol validation belong to the host. */
export interface Turn {
  action: NegotiationAction;
  message: string;
}

export type NegotiateResult = { turn: Turn } | { stall: Stall };
