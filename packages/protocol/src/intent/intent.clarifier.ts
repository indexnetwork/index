import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { UnderspecificationTypeSchema, type UnderspecificationType } from "../shared/schemas/question.schema.js";

const logger = protocolLogger("IntentClarifier");

type ClarifierStructuredModel = ReturnType<typeof createStructuredModel>;

const clarificationSchema = z.discriminatedUnion("needsClarification", [
  z.object({
    needsClarification: z.literal(false),
    reason: z.string(),
    suggestedDescription: z.string().nullable(),
    clarificationMessage: z.string().nullable(),
    underspecificationType: z.null(),
  }),
  z.object({
    needsClarification: z.literal(true),
    reason: z.string(),
    suggestedDescription: z.string().trim().min(1),
    clarificationMessage: z.string().trim().min(1),
    underspecificationType: UnderspecificationTypeSchema,
  }),
]);
const suggestionSchema = z.object({
  suggestedDescription: z.string(),
});
const clarificationDraftSchema = z.object({
  suggestedDescription: z.string(),
  clarificationMessage: z.string(),
});

export type IntentClarifierOutput = z.infer<typeof clarificationSchema>;

const systemPrompt = `
You evaluate whether one focused clarification would materially improve an intent before discovery.

Set needsClarification=true only when the intent has a consequential unresolved Question Under Discussion (QUD): the answer would materially change which people or opportunities should surface. Do not ask for merely nice-to-have detail, procedural confirmation, or information already inferable from the user profile or active intents.

Classify the single highest-impact QUD repair in underspecificationType:
- missing_constituent: an absent core participant, entity, or outcome (who/what). Example: "I need help with something" does not identify what help or outcome is sought.
- missing_constraint: the core target exists, but an explicitly unresolved or discovery-blocking ranking boundary is missing (where/when/how/how much). Example: a concrete hiring target whose location, timing, or engagement boundary is explicitly undecided.
- open_alternative_set: an unresolved choice among materially different interpretations or scopes. Example: seeking either a technical co-founder or a sales channel partner, which would surface different people.

An intent does NOT need every possible constraint. A concrete target with enough boundaries to run a useful search is specific even if it omits optional preferences such as compensation, budget, exact seniority, or secondary skills. For example, "a senior ML engineer in Berlin for a full-time role building production LLM evaluation systems this quarter" requires no clarification; do not invent a missing budget or other unstated requirement.

Set needsClarification=false when the intent already fixes its core target and enough material ranking boundaries for actionable discovery, or when remaining omissions are optional. When false, underspecificationType MUST be null. When true, it MUST be exactly one category above.

Rules when needsClarification=true:
- Ask about the selected QUD category rather than proposing an arbitrary refinement.
- User Profile is the primary source for a grounded suggestedDescription; Active Intents are secondary.
- You MUST provide a concrete suggestedDescription and short clarificationMessage.
- Do not include JSON in clarificationMessage.
`;

const suggestionPrompt = `
You generate one concrete, specific intent rewrite.

Rules:
- Output only a concise intent sentence in suggestedDescription.
- Use profile as primary source of personalization.
- Use active intents as secondary context for consistency.
- Keep user intent meaning, but make it actionable and specific.
- Never return an empty suggestion.
`;

const clarificationDraftPrompt = `
You draft one concise clarification response for an underspecified intent.

Return both:
1) suggestedDescription: one concrete rewrite representing a plausible interpretation.
2) clarificationMessage: one direct question that resolves the supplied QUD category.

Question rules by category:
- missing_constituent: ask which participant, entity, or outcome the user means.
- missing_constraint: ask for the unresolved ranking boundary (where/when/how/how much).
- open_alternative_set: name the materially different alternatives and ask the user to choose; never collapse them into a generic yes/no confirmation.

The question may mention suggestedDescription when useful, but do not force every category into "Did you mean...?". Keep it short. No bullet lists. No JSON.
`;

export class IntentClarifier {
  private readonly model: ClarifierStructuredModel;
  private readonly suggestionModel: ClarifierStructuredModel;
  private readonly clarificationDraftModel: ClarifierStructuredModel;

  constructor() {
    this.model = createStructuredModel("intentClarifier", clarificationSchema, {
      name: "intent_clarifier",
    });
    this.suggestionModel = createStructuredModel("intentClarifier", suggestionSchema, {
      name: "intent_clarifier_suggestion",
    });
    this.clarificationDraftModel = createStructuredModel(
      "intentClarifier",
      clarificationDraftSchema,
      { name: "intent_clarifier_message" }
    );
  }

  /** Build the shared user prompt with intent, profile, and active-intent context. */
  private buildPrompt(
    description: string,
    profileContext: string,
    activeIntentsContext: string
  ): string {
    return `
# User Input Intent
${description}

# User Profile
${profileContext || "none"}

# Active Intents
${activeIntentsContext || "none"}
`;
  }

  @Timed()
  public async invoke(
    description: string,
    profileContext: string,
    activeIntentsContext: string
  ): Promise<IntentClarifierOutput> {
    try {
      const prompt = this.buildPrompt(description, profileContext, activeIntentsContext);

      const result = await invokeWithAbortSignal(this.model, [
        new SystemMessage(systemPrompt),
        new HumanMessage(prompt),
      ]);
      const parsed = clarificationSchema.parse(result);

      if (parsed.needsClarification) {
        // Always prefer a dedicated rewrite pass for vague inputs so we avoid generic follow-up text.
        const draft = await this.generateClarificationDraft(
          description,
          profileContext,
          activeIntentsContext,
          parsed.underspecificationType,
        );
        if (draft) {
          return {
            ...parsed,
            suggestedDescription: draft.suggestedDescription,
            clarificationMessage: draft.clarificationMessage,
          };
        }
      }

      return parsed;
    } catch (error) {
      logger.warn("invoke: clarification failed", { error });
      return {
        needsClarification: false,
        reason: "fallback_on_model_error",
        suggestedDescription: null,
        clarificationMessage: null,
        underspecificationType: null,
      };
    }
  }

  private async generateSuggestion(
    description: string,
    profileContext: string,
    activeIntentsContext: string
  ): Promise<string | null> {
    try {
      const prompt = this.buildPrompt(description, profileContext, activeIntentsContext);
      const output = await invokeWithAbortSignal(this.suggestionModel, [
        new SystemMessage(suggestionPrompt),
        new HumanMessage(prompt),
      ]);
      const parsed = suggestionSchema.parse(output);
      const suggestion = parsed.suggestedDescription.trim();
      return suggestion.length > 0 ? suggestion : null;
    } catch (error) {
      logger.warn("generateSuggestion: failed", { error });
      return null;
    }
  }

  private async generateClarificationDraft(
    description: string,
    profileContext: string,
    activeIntentsContext: string,
    underspecificationType: UnderspecificationType,
  ): Promise<{ suggestedDescription: string; clarificationMessage: string } | null> {
    try {
      const prompt = [
        this.buildPrompt(description, profileContext, activeIntentsContext),
        "# QUD Repair Category",
        underspecificationType,
      ].join("\n");
      const output = await invokeWithAbortSignal(this.clarificationDraftModel, [
        new SystemMessage(clarificationDraftPrompt),
        new HumanMessage(prompt),
      ]);
      const parsed = clarificationDraftSchema.parse(output);
      const suggestedDescription = parsed.suggestedDescription.trim();
      const clarificationMessage = parsed.clarificationMessage.trim();
      if (!suggestedDescription || !clarificationMessage) return null;
      return { suggestedDescription, clarificationMessage };
    } catch (error) {
      logger.warn("generateClarificationDraft: failed", { error });
      const suggestion = await this.generateSuggestion(description, profileContext, activeIntentsContext);
      if (!suggestion) return null;
      const clarificationMessage = (() => {
        switch (underspecificationType) {
          case "missing_constituent":
            return "Who or what should this intent focus on?";
          case "missing_constraint":
            return "Which location, timing, format, or range should constrain this intent?";
          case "open_alternative_set":
            return `Your intent names different alternatives — "${description}". Which one should take priority?`;
        }
      })();
      return {
        suggestedDescription: suggestion,
        clarificationMessage,
      };
    }
  }
}
