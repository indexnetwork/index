import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";
import { protocolLogger } from "../support/protocol.logger";
import { Timed } from "../../performance";
import type {
  NegotiationAgentInput,
  NegotiationAgentOutput,
  NegotiationDecision,
  NegotiationMessage,
  NegotiationTurn,
} from "../../../types/negotiation.types";

const logger = protocolLogger("NegotiationAgent");

const model = new ChatOpenAI({
  model: 'google/gemini-2.5-flash',
  configuration: {
    baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    apiKey: process.env.OPENROUTER_API_KEY
  }
});

/**
 * System prompt for the negotiation agent.
 * Based on the Index Negotiation Agent specification.
 */
const systemPrompt = `
You represent a human principal in agent-to-agent negotiation.

Your role is to evaluate whether a conversation between your principal and a counterparty is rational and worthwhile.

You do not close deals.
You do not make commitments.
You do not imply alignment, probability, or outcomes.

Your objective is to:
• Detect structural fit (strike zone)
• Assess asymmetric upside
• Propose an exploratory conversation only when justified

## Behavioral Rules

### No Overreach
- Do not claim beliefs, ambition, or commitment unless explicitly stated in principal's profile/intents
- Do not imply funding probability, hiring likelihood, or partnership intent
- Avoid hype and absolutes
- Avoid future guarantees

### Think in Asymmetry
Internally evaluate:
- If this works, could upside be nonlinear?
- Is evaluation cost low relative to potential upside?
- Is timing active?

Only propose a conversation if upside plausibly justifies time.

### Strike Zone First
Before escalation, confirm that the opportunity fits both parties' mandate or scope.
If unclear, probe with one conditional sentence.

### Escalation Discipline
Do not immediately propose scheduling.
Escalate only after signal of interest (specific question, request for detail, or mandate confirmation).

## Tone
Be:
- Direct
- Calm
- Economical
- Optimistic but grounded

Avoid jargon.
Avoid abstract frameworks.
Avoid negotiation meta-language.

## Message Structure

When generating a turn message, use concise lines:
1. Context (what this is about)
2. Upside framing (potential value for both parties)
3. Conditional invitation (if appropriate for the turn)

Example format:
"Early infrastructure for agent coordination.
High upside if distribution compounds.
If this fits your mandate, we can schedule a short evaluation."

## When Not to Escalate

If strike zone mismatch, vague signals, or no timing alignment:
- Politely disengage
- Do not chase

## Decision Guidelines

- 'continue': The negotiation should proceed with the next turn
- 'extend': Need more information; request to extend max turns (provide extendReason)
- 'accept': Strike zone confirmed, asymmetric upside identified, propose conversation to principals
- 'decline': Clear mismatch in mandate, scope, or timing
- 'defer': Timing mismatch but potential future value; flag for later

## Optimization Goal

Maximize:
• High-signal conversations
• Time efficiency
• Optionality creation

Not:
• Persuasion
• Excitement
• Closure
`;

const NegotiationMessageSchema = z.object({
  context: z.string().describe('Brief context about what this negotiation is about'),
  upside: z.string().nullable().describe('Potential value/upside framing for both parties, or null if not applicable'),
  invitation: z.string().nullable().describe('Conditional invitation if appropriate, or null if not applicable'),
});

const responseFormat = z.object({
  message: NegotiationMessageSchema.nullable().describe('The turn message to send, or null if declining/deferring silently'),
  decision: z.enum(['continue', 'extend', 'accept', 'decline', 'defer']).describe('Decision for this turn'),
  reasoning: z.string().describe('Internal reasoning for this decision (not shown to counterparty)'),
  extendReason: z.string().nullable().describe('Why extension is needed (required if decision is extend), or null'),
});

type ResponseType = z.infer<typeof responseFormat>;

/**
 * NegotiationAgent represents a user's principal in agent-to-agent negotiations.
 * 
 * It evaluates counterparty profiles and intents to determine if a conversation
 * is worth escalating to the human principals.
 */
export class NegotiationAgent {
  private model: ReturnType<typeof model.withStructuredOutput>;

  constructor() {
    this.model = model.withStructuredOutput(responseFormat, {
      name: "negotiation_agent"
    });
  }

  /**
   * Generate a negotiation turn or evaluate a response.
   */
  @Timed()
  public async invoke(input: NegotiationAgentInput): Promise<NegotiationAgentOutput> {
    logger.verbose("invoke: starting negotiation turn", {
      principalUserId: input.principal.userId,
      counterpartyUserId: input.counterparty.userId,
      currentTurn: input.negotiationState.currentTurn,
      action: input.action,
      existingTurns: input.negotiationState.turns.length,
    });

    const prompt = this.buildPrompt(input);

    const messages = [
      new SystemMessage(systemPrompt),
      new HumanMessage(prompt)
    ];

    try {
      const result = await this.model.invoke(messages);
      const output = responseFormat.parse(result);

      logger.verbose("invoke: negotiation turn complete", {
        decision: output.decision,
        hasMessage: !!output.message,
        reasoningPreview: output.reasoning.substring(0, 100),
      });

      return {
        message: output.message ? {
          context: output.message.context,
          upside: output.message.upside ?? undefined,
          invitation: output.message.invitation ?? undefined,
        } : undefined,
        decision: output.decision as NegotiationDecision,
        reasoning: output.reasoning,
        extendReason: output.extendReason ?? undefined,
      };
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      logger.error("invoke: error during negotiation", {
        message: err.message,
        stack: err.stack,
      });
      return {
        decision: 'decline',
        reasoning: `Error during negotiation: ${err.message}`,
      };
    }
  }

  /**
   * Build the prompt for the negotiation turn.
   */
  private buildPrompt(input: NegotiationAgentInput): string {
    const { principal, counterparty, negotiationState, action } = input;

    const principalProfile = this.formatProfile(principal.profile, principal.activeIntents);
    const counterpartyProfile = this.formatProfile(counterparty.profile, counterparty.activeIntents);
    const turnsHistory = this.formatTurnsHistory(negotiationState.turns, principal.userId);
    const triggerContext = this.formatTrigger(negotiationState.trigger);

    return `
# Your Principal
${principalProfile}

# Counterparty
${counterpartyProfile}

# Negotiation Context
${triggerContext}

# Conversation History
${turnsHistory || '(This is the opening turn)'}

# Current Turn
Turn ${negotiationState.currentTurn + 1}
Action: ${action === 'generate_turn' ? 'Generate your turn message and decision' : 'Evaluate the counterparty response'}

${action === 'generate_turn' && negotiationState.turns.length === 0 ? `
## Opening Turn Instructions
You are initiating this negotiation. Your principal was matched with the counterparty through semantic search.
Craft an opening message that:
1. Establishes context for why this connection was suggested
2. Identifies potential mutual value (if any)
3. Probes for strike zone fit without overreaching
` : ''}

${negotiationState.turns.length > 0 ? `
## Response Instructions
Analyze the counterparty's last message and decide how to proceed.
Consider: Is there a signal of interest? Is strike zone becoming clearer?
` : ''}

Analyze the situation and provide your turn output.
`;
  }

  /**
   * Format a profile for inclusion in the prompt.
   */
  private formatProfile(
    profile: NegotiationAgentInput['principal']['profile'],
    intents: NegotiationAgentInput['principal']['activeIntents']
  ): string {
    const parts = [
      profile.name ? `Name: ${profile.name}` : null,
      profile.bio ? `Bio: ${profile.bio}` : null,
      profile.location ? `Location: ${profile.location}` : null,
      profile.interests?.length ? `Interests: ${profile.interests.join(', ')}` : null,
      profile.skills?.length ? `Skills: ${profile.skills.join(', ')}` : null,
      profile.context ? `Context: ${profile.context}` : null,
    ].filter(Boolean);

    const intentsPart = intents.length > 0
      ? `\n\nActive Intents:\n${intents.map(i => `- ${i.payload}${i.summary ? ` (${i.summary})` : ''}`).join('\n')}`
      : '\n\n(No active intents)';

    return parts.join('\n') + intentsPart;
  }

  /**
   * Format negotiation turns history.
   */
  private formatTurnsHistory(turns: NegotiationTurn[], principalUserId: string): string {
    if (turns.length === 0) return '';

    return turns.map((turn, index) => {
      const role = turn.participantUserId === principalUserId ? 'You' : 'Counterparty';
      const message = turn.message;
      const content = [
        message.context,
        message.upside,
        message.invitation,
      ].filter(Boolean).join('\n');

      return `[Turn ${index + 1}] ${role}:\n${content}\n(Decision: ${turn.decision})`;
    }).join('\n\n');
  }

  /**
   * Format the negotiation trigger context.
   */
  private formatTrigger(trigger: NegotiationAgentInput['negotiationState']['trigger']): string {
    const parts = [
      `Source: ${trigger.source}`,
      trigger.query ? `Query: "${trigger.query}"` : null,
      trigger.intentId ? `Triggered by intent` : null,
      trigger.indexId ? `Within index context` : null,
    ].filter(Boolean);

    return parts.join('\n');
  }
}
