import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage, BaseMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { protocolLogger } from "../support/protocol.logger";
import { Timed } from "../../performance";

const logger = protocolLogger("ExplicitIntentInferrer");

/**
 * Config
 */
import { config } from "dotenv";
config({ path: '.env.development', override: true });


const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: { baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1', apiKey: process.env.OPENROUTER_API_KEY }
});

// ──────────────────────────────────────────────────────────────
// 0. INFERRER OPTIONS
// ──────────────────────────────────────────────────────────────

/**
 * Options to control inferrer behavior.
 * Used to implement safety controls for read/write separation.
 */
export interface InferrerOptions {
  /**
   * Whether to fallback to profile inference when content is empty.
   * Should be TRUE for create operations without explicit content.
   * Should be FALSE for query operations.
   * Default: true (for backward compatibility).
   */
  allowProfileFallback?: boolean;
  
  /**
   * The operation mode for context.
   * Helps inferrer understand the user's intent.
   */
  operationMode?: 'create' | 'update' | 'delete';
  
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
  - For CREATE operations: Extract what the user wants to ADD.
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
  
  WHEN TO FALLBACK TO PROFILE:
  - Only when explicitly instructed: "(No content provided. Please infer intents from Profile Narrative and Aspirations)"
  - This should ONLY happen for CREATE operations with no explicit user input
  - Never infer from profile for query operations
  - When content IS present: profile may inform HOW to describe the intent (e.g., adding domain context), but must NOT change WHAT the intent is about
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

type ResponseType = z.infer<typeof responseFormat>;
export type InferredIntent = z.infer<typeof InferredIntentSchema>;

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class ExplicitIntentInferrer {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "intent_inferrer"
    });
  }

  /**
   * Main entry point. Invokes the agent with input and returns structured output.
   * @param content - The raw string content to analyze.
   * @param profileContext - The formatted profile context string.
   * @param options - Options controlling inference behavior (fallback, operation mode, conversation context).
   */
  @Timed()
  public async invoke(
    content: string | null,
    profileContext: string,
    options: InferrerOptions = {}
  ) {
    const {
      allowProfileFallback = true,  // Default TRUE for backward compatibility
      operationMode = 'create',
      conversationContext = undefined
    } = options;
    
    logger.verbose("invoke: received input", {
      contentPreview: content?.substring(0, 50),
      allowProfileFallback,
      operationMode,
      hasConversationContext: !!conversationContext,
      conversationMessageCount: conversationContext?.length || 0,
    });

    // CRITICAL: Don't fallback to profile when explicitly disabled
    // This prevents auto-generation of intents from profile during query operations
    if (!content && !allowProfileFallback) {
      logger.verbose("invoke: no content and fallback disabled, returning empty");
      return { intents: [] };
    }

    // Build conversation history section for anaphoric resolution
    const formattedHistory = conversationContext && conversationContext.length > 0
      ? this.formatConversationHistory(conversationContext)
      : '';
      
    const conversationSection = formattedHistory
      ? `# Conversation History (for reference resolution)\n${formattedHistory}\n`
      : '';

    // Build content section based on fallback setting
    const contentSection = content
      ? `## New Content\n\n${content}`
      : allowProfileFallback
        ? '(No content provided. Please infer intents from Profile Narrative and Aspirations)'
        : '(No content to analyze. Return empty intents list.)';

    const prompt = `
      Context:
      # User Memory Profile
      ${profileContext}

      ${conversationSection}${contentSection}
      
      # Operation Context
      This analysis is for a ${operationMode} operation.
      ${operationMode === 'create' ? 'Extract NEW intents the user wants to add.' : ''}
      ${operationMode === 'update' ? 'Extract MODIFICATIONS to existing intents. Use conversation history to resolve references like "that intent".' : ''}
      ${operationMode === 'delete' ? 'This should not execute - delete operations skip inference.' : ''}
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
      const result = await this.model.invoke(messages);
      const output = responseFormat.parse(result);

      logger.verbose(`invoke: found ${output.intents.length} intents`, {
        operationMode,
        allowedFallback: allowProfileFallback,
        usedFallback: !content && allowProfileFallback,
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

  /**
   * Factory method to expose the agent as a LangChain tool.
   * Useful for composing agents into larger graphs.
   */
  public static asTool() {
    return tool(
      async (args: { content: string | null; profileContext: string }) => {
        const agent = new ExplicitIntentInferrer();
        return await agent.invoke(args.content, args.profileContext);
      },
      {
        name: 'explicit_intent_inferrer',
        description: 'Extracts explicit intents from user content and profile context.',
        schema: z.object({
          content: z.string().nullable().describe('The new content to analyze'),
          profileContext: z.string().describe('The user profile context')
        })
      }
    );
  }
}
