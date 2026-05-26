import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { tool } from "@langchain/core/tools";
import { z } from "zod";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { Timed } from "../shared/observability/performance.js";
import { createModel } from "../shared/agent/model.config.js";

const logger = protocolLogger("IntentReconciler");

const model = createModel("intentReconciler");

const CreateActionTypeSchema = z.union([z.literal("create"), z.literal("CREATE")]);
const UpdateActionTypeSchema = z.union([z.literal("update"), z.literal("UPDATE")]);
const ExpireActionTypeSchema = z.union([z.literal("expire"), z.literal("EXPIRE")]);

// ──────────────────────────────────────────────────────────────
// 1. SYSTEM PROMPT
// ──────────────────────────────────────────────────────────────


const systemPrompt = `
You are an expert Intent Manager. Your goal is to reconcile NEWLY INFERRED intents with the user's ACTIVE intents.

You have access to:
1. Inferred Intents: Goals or Tombstones extracted from recent user activity.
2. Active Intents: What the user is currently working on.

YOUR TASK:
Compare the Inferred Intents against the Active Intents and decide on the necessary ACTIONS (Create, Update, Expire).

MATCHING LOGIC:
- You must determine if an Inferred Intent refers to the same underlying goal as an Active Intent.
- You must detect if an Inferred Intent CONTRADICTS an Active Intent (Change of Mind).

SEMANTIC GOVERNANCE RULES (Donnellan's Distinction):
- **REFERENTIAL Intents** (Anchor != NULL): These point to specific entities (e.g., "Google").
  - Matching logic: Match if the Anchor is the SAME.
  - If Anchor is different (e.g. "Join Google" vs "Join Meta"), they are DIFFERENT intents.
- **ATTRIBUTIVE Intents** (Anchor == NULL): These describe a class of things.
  - Matching logic: Match if the description is semantically similar content.
  - E.g. "Join a startup" and "Work for a small tech company" are the SAME.

ACTIONS:
- CREATE: If an Inferred Goal does NOT match any Active Intent, CREATE it.
- UPDATE: If an Inferred Goal matches an Active Intent but offers a better/different description, UPDATE it. When the match is an exact duplicate (same goal, no change needed), still output an UPDATE action with that Active Intent's id and the same payload—this allows the caller to link the intent to an index (e.g. add it to a community).
  CRITICAL UPDATE MERGE RULES:
  * When UPDATING an intent, you MUST PRESERVE all existing details from the Active Intent.
  * Only MODIFY or ADD the specific aspects mentioned in the Inferred Intent.
  * NEVER remove existing details unless explicitly contradicted.
  * Examples:
    - Active: "Create a text-based RPG game"
    - Inferred: "Create an RPG game with LLM-enhanced narration"
    - CORRECT UPDATE: "Create a text-based RPG game with LLM-enhanced narration" (preserved "text-based")
    - WRONG UPDATE: "Create an RPG game with LLM-enhanced narration" (lost "text-based")
  * Think of updates as REFINEMENTS or ADDITIONS, not REPLACEMENTS.
  * If the Inferred Intent is a complete restatement, it's fine to use it directly.
  * If the Inferred Intent adds/modifies specific aspects, merge it with existing details.

  COMPOUND INTENT SANITY CHECK (CRITICAL):
  * NEVER produce a compound intent — an intent with multiple distinct goals joined by "and", "as well as", commas, or similar.
  * If merging would create a compound (e.g., "Find an artist for X, and collaborate on Y"), the intents are NOT the same — CREATE the new one instead.
  * Valid UPDATE: adding detail to ONE goal (e.g., "Find a developer" → "Find a senior React developer in Berlin")
  * Invalid UPDATE (compound): joining TWO goals (e.g., "Find an artist" + "Collaborate on art direction" → "Find an artist and collaborate on art direction")
  * When in doubt, CREATE a new intent rather than risk a compound.
- EXPIRE: If an Inferred Tombstone matches an Active Intent (semantically), EXPIRE it.
- CONFLICT RESOLUTION: If a NEW Goal contradicts an Active Intent, EXPIRE the old and CREATE the new.
- DEDUPLICATION: Use Donnellan's Distinction above to merge duplicates. For duplicates, output UPDATE (not an empty list) so the intent can be linked to an index.

Output a list of specific actions to apply.
IMPORTANT: The type field MUST be exactly one of: "create", "update", "expire" (lowercase).
`;

// ──────────────────────────────────────────────────────────────
// 2. RESPONSE SCHEMA (Zod)
// ──────────────────────────────────────────────────────────────

const CreateIntentActionSchema = z.object({
  type: CreateActionTypeSchema,
  payload: z.string().describe("The new intent description"),
  score: z.number().nullable().describe("The felicity score (0-100)"),
  reasoning: z.string().nullable().describe("Reasoning for the creation (including felicity)"),
  // Semantic Governance Fields
  intentMode: z.enum(['REFERENTIAL', 'ATTRIBUTIVE']).nullable().describe("Donnellan's Distinction"),
  referentialAnchor: z.string().nullable().describe("Entity anchored to"),
  semanticEntropy: z.number().nullable().describe("Constraint Density Score (0-1)"),
});

const UpdateIntentActionSchema = z.object({
  type: UpdateActionTypeSchema,
  id: z.string().describe("The ID of the intent to update"),
  payload: z.string().describe("The updated intent description"),
  score: z.number().nullable().describe("The felicity score (0-100)"),
  reasoning: z.string().nullable().describe("Reasoning for the update"),
  intentMode: z.enum(['REFERENTIAL', 'ATTRIBUTIVE']).nullable(),
});

const ExpireIntentActionSchema = z.object({
  type: ExpireActionTypeSchema,
  id: z.string().describe("The ID of the intent to expire"),
  reason: z.string().describe("Why it is expired")
});

const responseFormat = z.object({
  actions: z.array(z.union([
    CreateIntentActionSchema,
    UpdateIntentActionSchema,
    ExpireIntentActionSchema
  ])).describe("List of actions to apply")
});

// ──────────────────────────────────────────────────────────────
// 3. TYPE DEFINITIONS (match invoke() return shape: normalized lowercase action types)
// ──────────────────────────────────────────────────────────────

export type NormalizedIntentAction =
  | Omit<z.infer<typeof CreateIntentActionSchema>, "type"> & { type: "create" }
  | Omit<z.infer<typeof UpdateIntentActionSchema>, "type"> & { type: "update" }
  | Omit<z.infer<typeof ExpireIntentActionSchema>, "type"> & { type: "expire" };

export type IntentReconcilerOutput = { actions: NormalizedIntentAction[] };

const normalizeActionType = (type: string): "create" | "update" | "expire" => {
  const normalized = type.toLowerCase();
  if (normalized === "create" || normalized === "update" || normalized === "expire") {
    return normalized;
  }
  logger.warn(`normalizeActionType: unexpected action type "${type}", defaulting to "create"`);
  return "create";
};

// ──────────────────────────────────────────────────────────────
// 4. CLASS DEFINITION
// ──────────────────────────────────────────────────────────────

export class IntentReconciler {
  private model: any;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "intent_reconciler"
    });
  }

  /**
   * Reconciles inferred intents with active intents.
   * @param inferredIntentsFormatted - Formatted string of inferred intents.
   * @param activeIntentsContext - Formatted string of active intents.
   */
  @Timed()
  public async invoke(inferredIntentsFormatted: string, activeIntentsContext: string) {
    logger.verbose(`[IntentReconciler.invoke] Reconciling intents...`);

    const prompt = `
      # Active Intents
      ${activeIntentsContext}

      # Inferred Intents (Candidates)
      ${inferredIntentsFormatted}

      Based on the Inferred Intents, determine the actions to modify the Active Intents state.
      IMPORTANT:
      - If you CREATE or UPDATE an intent, you MUST popuate the 'score' and 'reasoning' fields.
      - Extract the 'score', 'semanticEntropy', 'referentialAnchor' from the Inferred Intent's data.
      - Include the verification details in the 'reasoning'.
    `;

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const output = await this.model.invoke(messages);
      const normalizedActions = output.actions.map((action: z.infer<typeof responseFormat>["actions"][number]) => ({
        ...action,
        type: normalizeActionType(action.type),
      })) as NormalizedIntentAction[];

      logger.verbose(`[IntentReconciler.invoke] Decision: ${normalizedActions.length} actions.`);
      return { actions: normalizedActions };
    } catch (error) {
      logger.error("[IntentReconciler] Error during invocation", { error });
      return { actions: [] };
    }
  }

  /**
   * Factory method to expose the agent as a LangChain tool.
   */
  public static asTool() {
    return tool(
      async (args: { inferredIntents: string; activeIntents: string }) => {
        const agent = new IntentReconciler();
        return await agent.invoke(args.inferredIntents, args.activeIntents);
      },
      {
        name: 'intent_reconciler',
        description: 'Reconciles inferred intents with active intents to determine state changes.',
        schema: z.object({
          inferredIntents: z.string().describe('Formatted string of inferred intents'),
          activeIntents: z.string().describe('Formatted string of active intents')
        })
      }
    );
  }
}
