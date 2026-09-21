import { evaluateNegotiation } from "./negotiator.evaluator.js";
import { NEGOTIATION_INSTRUCTIONS, ROLE_INSTRUCTIONS } from "./negotiator.instructions.js";
import type { ConversationEntry } from "./principal/principal.context.js";
import type { Intent, NegotiationAction, Opportunity, Profile, Stall } from "./shared/agent.context.js";
import type { Execute } from "./shared/reasoning/reasoning.execution.js";
import { prepareInstructions } from "./shared/reasoning/reasoning.instructions.js";
import { defineTool, type Tool } from "./shared/reasoning/reasoning.tool.js";
import type { TypeSafeClient } from "./shared/typesafe.client.js";

const ACTIONS: NegotiationAction[] = ["propose", "counter", "accept", "decline"];

/** Stable principal/intent identity and execution dependencies, without host access. */
export interface NegotiatorAgentOptions {
  principalId: string;
  intentId: string;
  execute: Execute;
  /** Evaluates negotiation evidence before the reasoning run. */
  decisions: Pick<TypeSafeClient, "evaluate">;
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
   * @param options - Principal and intent identity, execution, decision evaluation, cancellation, and clock.
   */
  constructor(options: NegotiatorAgentOptions) {
    this.options = { ...options };
  }

  /**
   * Takes one negotiation turn from fresh evidence, or explains what principal input is missing.
   * @param context - Current profile, intent, conversation, brief, fixed seat role, and ordered negotiation turns.
   * @returns A turn for the runner to submit, or a stall for it to persist; no output becomes a no-result stall.
   * @throws If evaluation or execution fails, is cancelled, or requires a turn the standing instruction forbids.
   */
  async negotiate(context: NegotiateContext): Promise<NegotiateResult> {
    const { profile, intent, brief, opportunity, role } = context;
    const evaluation = await evaluateNegotiation(this.options.decisions, context, this.options.abortSignal);
    const actions = (opportunity.actions ?? ACTIONS).filter((action) =>
      (action !== "accept" || role === "responder") &&
      evaluation.decision !== "stall" && (evaluation.decision !== "decline" || action === "decline"));
    if (evaluation.decision === "decline" && !actions.length) {
      throw new Error("The evidence requires declining, but the standing instruction does not permit a decline.");
    }
    let result: NegotiateResult | undefined;

    const tools: Tool[] = [
      defineTool({
        name: "submit_turn",
        description:
          "Write one turn using an action permitted by the evidence evaluation and protocol. Propose puts the reason on the table or renews it with an answer, counter asks the one thing the offer leaves unsaid, accept records only that the responder sees enough potential fit for the principals to connect, and decline ends it. A required decline must name the explicit mismatch. An accept message must not say the principal accepted the proposal or any project terms within it. One turn only.",
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
        description:
          "End this run without a turn because the source evidence lacks a principal fact, preference or permission required for the next useful turn. Use this rather than exceeding the principal's authority, inventing an answer, or deferring a material question to a later conversation; do not use it for logistics this stage genuinely leaves open.",
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
          if (evaluation.decision === "decline") throw new Error("The evidence requires declining this mismatch, not asking for missing principal input.");
          result = { stall: { reason, ...(suggestedAsk ? { suggestedAsk } : {}) } };
          return "Stall recorded.";
        },
      }),
    ];

    await this.options.execute({
      instructions: prepareInstructions({
        instructions: [NEGOTIATION_INSTRUCTIONS, ROLE_INSTRUCTIONS[role]].join("\n\n"),
        profile,
        intent,
        now: this.options.now,
      }),
      prompt:
        "Take this negotiation's next turn, or stall.\nYour brief:\n" +
        brief +
        "\n\nEvidence evaluation and its source context (the decision is enforced by the available tools; use the source evidence to explain the specific fact, boundary, or mismatch):\n" +
        JSON.stringify(evaluation) +
        "\n\nThis negotiation:\n" +
        JSON.stringify({ ...opportunity, role, actions }),
      tools: tools.filter((tool) => tool.name === "submit_turn" ? actions.length > 0 : evaluation.decision !== "decline"),
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

/** Fresh principal evidence and one negotiation; sibling opportunities are excluded from evaluation. */
export interface NegotiateContext {
  profile: Profile;
  intent: Intent;
  /** This intent's H2A entries, oldest first; evaluation scopes them to this opportunity. */
  conversation: ConversationEntry[];
  brief: string;
  /** Complete negotiation history, oldest first, with agent authorship preserved. */
  turns: (Turn & { speaker: "our_agent" | "counterparty_agent" })[];
  /** This principal's original seat role, fixed for the entire negotiation. */
  role: NegotiationRole;
  /** The runner intersects protocol actions with the standing decision before invoking reasoning. */
  opportunity: Opportunity;
}

/** One A2A turn; submission and final protocol validation belong to the host. */
export interface Turn {
  action: NegotiationAction;
  message: string;
}

export type NegotiateResult = { turn: Turn } | { stall: Stall };
