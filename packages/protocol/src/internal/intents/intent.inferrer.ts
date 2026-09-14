import { HumanMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";

const logger = protocolLogger("ExplicitIntentInferrer");

// ──────────────────────────────────────────────────────────────
// 0. INFERRER OPTIONS
// ──────────────────────────────────────────────────────────────

/**
 * Options to control inferrer behavior.
 * Used to implement safety controls for read/write separation.
 */
export interface InferrerOptions {
  /**
   * Conversation history for anaphoric resolution.
   * Used to resolve references like "that intent", "this goal", etc.
   * Optional - if not provided, inference uses only current content.
   */
  conversationContext?: BaseMessage[];
}

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────

const systemPrompt = `
  You are an expert Intent Analyst. Your goal is to infer the user's current intentions based on their profile and new content.

  You have access to:
  1. User Memory Profile (Identity, Narrative, Attributes) - The long-term context.
  2. New Content - What they just said/did.
  3. Conversation History (when available) - Recent messages for resolving references.
  4. Operation Context - What type of operation is being performed.

  YOUR TASK:
  Analyze the "New Content" in the context of the "Profile", "Conversation History", and "Operation Context".
  Extract a list of **Inferred Intents**.

  INTENT TYPES:
  - 'goal': The user wants to start, continue, or achieve something. (e.g., "I want to learn Rust", "Looking for a co-founder")
  - 'tombstone': The user explicitly states they have COMPLETED, stopped, or abandoned a goal. (e.g., "I finished the course", "I'm done with crypto", "Delete my running goal")

  CRITICAL RULES:
  - Only analyze the "New Content" section if it exists.
  - If New Content says "Return empty intents list", you MUST return an empty intents array.
  - If New Content says "No content to analyze", return an empty intents array.
  - Be precise and self-contained in descriptions (e.g., "Learn Rust programming" instead of "Learn it").
  - Do NOT try to manage existing IDs or check for duplicates.
  - IGNORE purely phatic communication (e.g., "Hello", "Hi", "Good morning") - return empty intents.
  - For UPDATE operations: Extract what the user wants to CHANGE.
  - For queries/questions: You should not see these - return empty intents.

  CONTENT GROUNDING (CRITICAL):
  - When New Content is present, EVERY inferred intent MUST be directly related to the New Content.
  - The User Profile is ENRICHMENT CONTEXT ONLY — use it to add specificity or domain detail to content-derived intents.
  - Do NOT generate intents from the profile that are unrelated to the New Content.
  - If the New Content is a short phrase (e.g., "artist", "photographer"), treat it as the user's stated goal — infer what they want regarding that topic.
  - Example: New Content = "artist", Profile = "Building a decentralized protocol" → Intent: "Find or connect with artists" (NOT "Secure partnerships for decentralized protocol")
  - Example: New Content = "looking for a photographer", Profile = "AI startup founder" → Intent: "Find a photographer" (NOT "Recruit AI engineers")

  CONCEPT EXTRACTION (CRITICAL FOR MATCHING):
  - Intents must be SELF-CONTAINED and understandable to strangers with no prior context.
  - When a document describes a project, the project's NAME is irrelevant - only WHAT IT DOES and WHAT TECH IT USES matters.
  - STRIP OUT completely (do not include in any form):
    * ANY project/company/product names from the source document - these mean nothing to outsiders
    * URLs and links (https://..., http://...) - NEVER include URLs in intent descriptions
    * Phrases that reference URLs: "More details at", "See ... for more", "Project details:", "mentioned in", "from the document", "as discussed"
    * File names ("Claude.md", "README", "the PDF")
  - Describe the WORK and TECHNOLOGIES, never the project name.
  - Examples:
    * Source mentions "FooBar Project" using React/Node → Intent: "Seeking React/Node.js developers for real-time web apps" (NO "FooBar")
    * Source mentions "Index Network" with LangGraph → Intent: "Seeking LangGraph/PostgreSQL developers for AI agent systems" (NO "Index Network")
    * Source mentions "Acme Corp" doing ML → Intent: "Seeking ML engineers for computer vision pipelines" (NO "Acme")

  ANAPHORIC RESOLUTION (UPDATE operations):
  - When conversation history is provided, use it to resolve references like "that intent", "this goal", "the project", etc.
  - Look for previously mentioned intents in the conversation history.
  - If the user says "make that intent X", find what "that intent" refers to in the history and include ALL its details.
  - PRESERVE all existing details from the referenced intent and only MODIFY the specified parts.
  - Example: If history mentions "text-based RPG game" and user says "make that intent have LLM narration",
    the output should be "Create a text-based RPG game with LLM-enhanced narration" (preserving "text-based").

`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const InferredIntentSchema = z.object({
  type: z.enum(['goal', 'tombstone']).describe("The type of intent inferred"),
  description: z.string().describe("Concise description of the intent"),
  reasoning: z.string().describe("Why this intent was inferred"),
  confidence: z.enum(['high', 'medium', 'low']).describe("Confidence level of the inference")
});

const responseFormat = z.object({
  intents: z.array(InferredIntentSchema).describe("List of inferred intents")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS
// ──────────────────────────────────────────────────────────────

export type InferredIntent = z.infer<typeof InferredIntentSchema>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class ExplicitIntentInferrer {
  private model: ReturnType<typeof createStructuredModel>;

  constructor() {
    this.model = createStructuredModel("intentInferrer", responseFormat, {
      name: "intent_inferrer"
    });
  }

  /**
   * Main entry point. Invokes the agent with input and returns structured output.
   * @param content - The raw string content to analyze.
   * @param profileContext - The formatted profile context string.
   * @param options - Conversation context for the explicit update.
   */
  @Timed()
  public async invoke(
    content: string | null,
    profileContext: string,
    options: InferrerOptions = {}
  ) {
    const {
      conversationContext = undefined
    } = options;

    logger.verbose("invoke: received input", {
      contentPreview: content?.substring(0, 50),
      hasConversationContext: !!conversationContext,
      conversationMessageCount: conversationContext?.length || 0,
    });

    if (!content) {
      logger.verbose("invoke: no content, returning empty");
      return { intents: [] };
    }

    // Build conversation history section for anaphoric resolution
    const formattedHistory = conversationContext && conversationContext.length > 0
      ? this.formatConversationHistory(conversationContext)
      : '';

    const conversationSection = formattedHistory
      ? `# Conversation History (for reference resolution)\n${formattedHistory}\n`
      : '';

    const contentSection = `## New Content\n\n${content}`;

    // No profile means no profile section at all. Callers that deliberately run
    // profile-blind must not see an empty heading the model could try to fill in.
    const profileSection = profileContext?.trim()
      ? `# User Memory Profile\n      ${profileContext}\n`
      : '';

    const prompt = `
      Context:
      ${profileSection}
      ${conversationSection}${contentSection}

      # Operation Context
      This analysis is for an update operation.
      Extract MODIFICATIONS to existing intents. Use conversation history to resolve references like "that intent".
    `;

    logger.debug("invoke: prompt details", {
      hasConversationHistory: !!conversationSection,
      conversationHistoryLength: formattedHistory.length,
      conversationHistoryPreview: formattedHistory.substring(0, 300),
      contentLength: content?.length ?? 0,
      promptLength: prompt.length,
      promptPreview: prompt.substring(0, 500),
    });

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await invokeWithAbortSignal(this.model, messages);
      const output = responseFormat.parse(result);

      logger.verbose('invoke: found intents', {
        count: output.intents.length,
      });
      return output;
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("invoke: error during invocation", {
        message: err.message,
        stack: err.stack,
      });
      return { intents: [] };
    }
  }

  /**
   * Formats conversation history for inclusion in the prompt.
   * Converts BaseMessage[] to readable string format.
   */
  private formatConversationHistory(messages: BaseMessage[]): string {
    const formatted = messages.map((msg, index) => {
      const role = msg._getType() === 'human' ? 'User' : 'Assistant';
      const content = typeof msg.content === 'string' ? msg.content : JSON.stringify(msg.content);
      // Truncate long messages for token efficiency
      const truncated = content.length > 200 ? content.substring(0, 200) + '...' : content;
      return `[${index + 1}] ${role}: ${truncated}`;
    }).join('\n');

    logger.debug("formatConversationHistory: full conversation history", {
      messageCount: messages.length,
      fullHistory: messages
        .map((msg, index) => {
          const role = msg._getType() === "human" ? "User" : "Assistant";
          const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          return `[${index + 1}] ${role}: ${content}`;
        })
        .join("\n"),
    });

    return formatted;
  }
}
