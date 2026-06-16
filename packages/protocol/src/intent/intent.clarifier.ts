import type { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";

import { createModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("IntentClarifier");

type ClarifierStructuredModel = ReturnType<ChatOpenAI["withStructuredOutput"]>;

const clarificationSchema = z.object({
  needsClarification: z.boolean(),
  reason: z.string(),
  suggestedDescription: z.string().nullable(),
  clarificationMessage: z.string().nullable(),
});
const suggestionSchema = z.object({
  suggestedDescription: z.string(),
});
const clarificationDraftSchema = z.object({
  suggestedDescription: z.string(),
  clarificationMessage: z.string(),
});

export type IntentClarifierOutput = z.infer<typeof clarificationSchema>;

const systemPrompt = `
You evaluate whether an intent is specific enough to persist without asking the user to confirm a refinement.

Only set needsClarification=true when the intent is truly vague — e.g. a single generic phrase with no role, domain, location, or other concrete criteria (like "find a job", "I need help", "looking for something").

Do NOT ask for clarification when the user has already given:
- A role or type (e.g. "UX designer", "technical co-founder", "engineer")
- A domain or industry (e.g. "in AI", "climate tech", "fintech")
- A location or format (e.g. "remote", "Berlin", "full-time")
- Any other concrete detail that makes the intent actionable

Default to needsClarification=false when in doubt. Only clarify when the intent is so broad that persisting it as-is would be unhelpful (e.g. literally "a job" or "something" with no other signal).

Rules when needsClarification=true:
- User Profile is the primary source for suggestedDescription; Active Intents are secondary.
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
You draft a concise clarification response for a vague intent.

Rules:
- Return both:
  1) suggestedDescription (specific rewritten intent)
  2) clarificationMessage (single short message to the user)
- clarificationMessage must include the suggestion naturally and ask for confirmation.
- Use this shape: ` + "`Did you mean: \"<suggestedDescription>\"?`" + ` followed by a brief confirmation instruction.
- Keep it short. No bullet lists. No JSON.
`;

export class IntentClarifier {
  private readonly model: ClarifierStructuredModel;
  private readonly suggestionModel: ClarifierStructuredModel;
  private readonly clarificationDraftModel: ClarifierStructuredModel;

  constructor() {
    const baseModel = createModel("intentClarifier");
    this.model = baseModel.withStructuredOutput(clarificationSchema, {
      name: "intent_clarifier",
    });
    this.suggestionModel = baseModel.withStructuredOutput(suggestionSchema, {
      name: "intent_clarifier_suggestion",
    });
    this.clarificationDraftModel = baseModel.withStructuredOutput(
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
        const draft = await this.generateClarificationDraft(description, profileContext, activeIntentsContext);
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
    activeIntentsContext: string
  ): Promise<{ suggestedDescription: string; clarificationMessage: string } | null> {
    try {
      const prompt = this.buildPrompt(description, profileContext, activeIntentsContext);
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
      const clarificationMessage = `Do you mean: ${suggestion}?`;
      return {
        suggestedDescription: suggestion,
        clarificationMessage,
      };
    }
  }
}
