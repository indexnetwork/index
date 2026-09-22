import type { Execute } from "../shared/reasoning/reasoning.execution.js";
import { prepareInstructions } from "../shared/reasoning/reasoning.instructions.js";

import { openQuestions, principalConversation, profileFacts, type BriefContext, type WakeAction, type WakeContext, type WakeResult } from "./principal.context.js";
import { createDiscoveryTool, type PrincipalOperations } from "./principal.discovery.js";
import { BRIEF_INSTRUCTIONS, WAKE_INSTRUCTIONS, WAKE_STEPS } from "./principal.instructions.js";
import { createBriefTool, createWakeTools } from "./principal.tools.js";

/** Stable identity and dependencies for one intent, not cached domain snapshots. */
export interface PrincipalAgentOptions {
  principalId: string;
  intentId: string;
  execute: Execute;
  operations: PrincipalOperations;
  /** Runner-owned cancellation shared by this intent's reasoning runs. */
  abortSignal: AbortSignal;
  /** Optional clock for preparing the current UTC date in instructions. */
  now?: () => Date;
}

/** H2A reasoning for one principal and intent, with fresh context on each invocation. */
export class PrincipalAgent {
  private readonly options: PrincipalAgentOptions;

  /**
   * Binds identity and dependencies without reading host state or starting reasoning.
   * @param options - Principal and intent identity, execution, supplied operations, cancellation, and clock.
   */
  constructor(options: PrincipalAgentOptions) {
    this.options = { ...options };
  }

  /**
   * Reasons over fresh intent context and reports instructions as they are recorded.
   * @param context - Current profile, intent, conversation, opportunities, and publication callbacks.
   * @returns Collected actions; an empty list means there is nothing to say or change.
   * @throws If execution fails, is cancelled, or instruction publication fails during the run.
   */
  async wake(context: WakeContext): Promise<WakeResult> {
    const { profile, intent, opportunities } = context;
    const actions: WakeAction[] = [];
    const open = openQuestions(context.conversation);
    let progressFailure: { cause: unknown } | undefined;
    const wakeTools = createWakeTools({ opportunities, openQuestions: open, actions, onBrief: context.onBrief });
    const discoveryTool = createDiscoveryTool({
      intentId: this.options.intentId,
      operations: this.options.operations,
      onOpened: context.onOpened,
      onProgress: async (text) => {
        try {
          await context.onProgress?.(text);
        } catch (cause) {
          progressFailure ??= { cause };
        }
      },
    });
    const tools = [...wakeTools.tools, discoveryTool];

    await this.options.execute({
      instructions: prepareInstructions({ instructions: WAKE_INSTRUCTIONS, now: this.options.now }),
      prompt: "First inspect every pending H2A question in the conversation. If the intent or an explicit human answer already covers one, call expire_question before any other action. Then reply to any unaddressed principal input using note_principal, and act only on what actually needs to change.\n" + JSON.stringify({
        principalIntent: intent.statement,
        profile: profileFacts(profile),
        conversation: principalConversation(context.conversation),
        opportunities,
        openQuestionIds: [...open.keys()],
      }),
      tools,
      maxSteps: WAKE_STEPS,
      abortSignal: this.options.abortSignal,
      principalId: this.options.principalId,
      intentId: this.options.intentId,
      operation: "wake",
    });

    const publicationFailure = wakeTools.publicationFailure();
    if (publicationFailure) throw publicationFailure.cause;
    if (progressFailure) throw progressFailure.cause;
    return { actions };
  }

  /**
   * Supplies one opportunity's missing brief or decision without running an intent wake.
   * @param context - Fresh profile, intent, conversation, and the single opportunity to brief.
   * @returns Brief/decision actions, or an empty list when both already stand or execution records nothing.
   * @throws If reasoning execution fails or is cancelled.
   */
  async brief(context: BriefContext): Promise<WakeAction[]> {
    const { profile, intent, opportunity } = context;
    if (opportunity.brief && opportunity.decision) return [];

    const actions: WakeAction[] = [];
    await this.options.execute({
      instructions: prepareInstructions({ instructions: BRIEF_INSTRUCTIONS, now: this.options.now }),
      prompt: "Brief this one opportunity now.\n" + JSON.stringify({
        principalIntent: intent.statement,
        profile: profileFacts(profile),
        conversation: principalConversation(context.conversation),
        opportunity,
      }),
      tools: [createBriefTool(opportunity, actions)],
      maxSteps: 1,
      abortSignal: this.options.abortSignal,
      principalId: this.options.principalId,
      intentId: this.options.intentId,
      operation: "brief",
      opportunityId: opportunity.id,
    });
    return actions;
  }
}
