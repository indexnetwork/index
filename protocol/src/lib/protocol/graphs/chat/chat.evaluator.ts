/**
 * Chat Agent Evaluator - User Need Fulfillment Testing
 *
 * Tests the chat agent against real user needs and journeys,
 * not just tool coverage. Generates diverse user scenarios
 * and evaluates whether the agent fulfills the underlying need.
 */

import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

// ═══════════════════════════════════════════════════════════════════════════════
// USER NEEDS TAXONOMY
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Core user needs that Index Network serves.
 * These are jobs-to-be-done, not features.
 */
export const USER_NEEDS = {
  // === IDENTITY ===
  ESTABLISH_PRESENCE: {
    id: "establish_presence",
    description: "User wants to exist in the system with a profile",
    examples: [
      "I just signed up, help me get started",
      "Here's my LinkedIn, set me up",
      "I need to create my profile",
    ],
    successSignals: ["profile exists", "user confirmed their info"],
    failureSignals: ["asked for info that was provided", "no profile action taken"],
  },

  UPDATE_IDENTITY: {
    id: "update_identity",
    description: "User wants to change how they're represented",
    examples: [
      "I changed jobs, update my profile",
      "Add Python to my skills",
      "I'm not interested in crypto anymore",
    ],
    successSignals: ["profile updated", "change confirmed"],
    failureSignals: ["wrong field updated", "update not acknowledged"],
  },

  // === INTENT EXPRESSION ===
  EXPRESS_WANT: {
    id: "express_want",
    description: "User has something they're looking for",
    examples: [
      "I'm hiring ML engineers",
      "Looking for a technical co-founder",
      "I want to learn about Web3",
      "Need someone to review my startup idea",
    ],
    successSignals: ["intent created", "want acknowledged and captured"],
    failureSignals: ["no intent created", "wrong intent captured", "too many questions before action"],
  },

  EXPRESS_OFFER: {
    id: "express_offer",
    description: "User has something to offer others",
    examples: [
      "I can mentor early-stage founders",
      "Available for freelance React work",
      "I invest in AI startups",
    ],
    successSignals: ["intent/offer captured", "availability noted"],
    failureSignals: ["treated as a want instead of offer", "not captured"],
  },

  REFINE_INTENT: {
    id: "refine_intent",
    description: "User wants to clarify or modify an existing intent",
    examples: [
      "Actually, I meant senior ML engineers",
      "Change my hiring intent to focus on backend",
      "That's not quite what I meant",
    ],
    successSignals: ["intent updated", "refinement applied"],
    failureSignals: ["new intent created instead", "wrong intent modified"],
  },

  WITHDRAW_INTENT: {
    id: "withdraw_intent",
    description: "User no longer has a need",
    examples: [
      "I found a co-founder, remove that intent",
      "Delete my hiring post",
      "I'm no longer looking for investors",
    ],
    successSignals: ["intent removed", "withdrawal confirmed"],
    failureSignals: ["wrong intent deleted", "intent still active"],
  },

  // === DISCOVERY ===
  FIND_PEOPLE: {
    id: "find_people",
    description: "User wants to discover relevant connections",
    examples: [
      "Who else is looking for co-founders?",
      "Find me ML engineers",
      "Are there any investors interested in healthtech?",
    ],
    successSignals: ["search performed", "results presented or explained why none"],
    failureSignals: ["no search done", "generic advice instead of results"],
  },

  EXPLORE_SERENDIPITY: {
    id: "explore_serendipity",
    description: "User wants to see what's out there without specific goal",
    examples: [
      "What's happening in the network?",
      "Show me interesting opportunities",
      "Who might I want to connect with?",
    ],
    successSignals: ["relevant suggestions provided", "exploration facilitated"],
    failureSignals: ["forced to specify before exploring", "no suggestions"],
  },

  // === COMMUNITY ===
  JOIN_COMMUNITY: {
    id: "join_community",
    description: "User wants to be part of a group",
    examples: [
      "How do I join the AI founders group?",
      "I want to be in the startup community",
    ],
    successSignals: ["membership explained or facilitated", "community found"],
    failureSignals: ["community not found", "no guidance provided"],
  },

  UNDERSTAND_COMMUNITY: {
    id: "understand_community",
    description: "User wants to know about their communities",
    examples: [
      "What communities am I in?",
      "Show me my groups",
      "Who else is in the AI index?",
    ],
    successSignals: ["memberships listed", "community info provided"],
    failureSignals: ["wrong communities shown", "no info provided"],
  },

  MANAGE_COMMUNITY: {
    id: "manage_community",
    description: "Owner wants to manage their index",
    examples: [
      "Show me everyone in my community",
      "What intents are in my index?",
      "Change my community's description",
    ],
    successSignals: ["owner operations successful", "management action taken"],
    failureSignals: ["permission denied unexpectedly", "wrong community modified"],
  },

  // === META ===
  UNDERSTAND_SYSTEM: {
    id: "understand_system",
    description: "User wants to know how things work",
    examples: [
      "What can you help me with?",
      "How does this work?",
      "What are intents?",
    ],
    successSignals: ["clear explanation", "actionable guidance"],
    failureSignals: ["confusing jargon", "no explanation"],
  },

  RECOVER_FROM_ERROR: {
    id: "recover_from_error",
    description: "Something went wrong and user needs help",
    examples: [
      "That's not what I wanted",
      "Undo that",
      "You made a mistake",
    ],
    successSignals: ["error acknowledged", "recovery attempted", "alternative offered"],
    failureSignals: ["error ignored", "same mistake repeated"],
  },

  RESUME_CONTEXT: {
    id: "resume_context",
    description: "User returns after time away",
    examples: [
      "What were we doing?",
      "Remind me of my intents",
      "I'm back, what's new?",
    ],
    successSignals: ["context restored", "state summarized"],
    failureSignals: ["no context awareness", "starts fresh ignoring history"],
  },
} as const;

export type UserNeedId = keyof typeof USER_NEEDS;

// ═══════════════════════════════════════════════════════════════════════════════
// USER PERSONAS
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * User personas with different communication styles and contexts.
 */
export const USER_PERSONAS = {
  NEW_USER: {
    id: "new_user",
    description: "Just signed up, doesn't know the system",
    traits: ["unfamiliar with terminology", "exploratory", "needs guidance"],
    communicationStyle: "asks basic questions, uncertain language",
  },

  BUSY_FOUNDER: {
    id: "busy_founder",
    description: "Time-constrained, wants quick results",
    traits: ["terse messages", "action-oriented", "impatient with questions"],
    communicationStyle: "short messages, expects fast action",
  },

  DETAIL_ORIENTED: {
    id: "detail_oriented",
    description: "Wants to understand everything precisely",
    traits: ["asks follow-up questions", "wants confirmation", "precise language"],
    communicationStyle: "longer messages, specific requirements",
  },

  VAGUE_USER: {
    id: "vague_user",
    description: "Knows what they want but can't articulate it well",
    traits: ["imprecise language", "uses 'stuff' and 'things'", "needs help clarifying"],
    communicationStyle: "ambiguous messages, expects agent to understand",
  },

  POWER_USER: {
    id: "power_user",
    description: "Knows the system well, uses it efficiently",
    traits: ["uses correct terminology", "multi-step requests", "expects efficiency"],
    communicationStyle: "direct commands, references past context",
  },

  FRUSTRATED_USER: {
    id: "frustrated_user",
    description: "Something went wrong, trying again",
    traits: ["impatient", "references past failures", "skeptical"],
    communicationStyle: "expresses frustration, wants resolution",
  },

  NON_NATIVE_SPEAKER: {
    id: "non_native_speaker",
    description: "English is not first language",
    traits: ["simpler vocabulary", "occasional grammar issues", "may misuse terms"],
    communicationStyle: "simpler sentence structures",
  },

  MOBILE_USER: {
    id: "mobile_user",
    description: "Using on phone, typing is harder",
    traits: ["very short messages", "typos", "abbreviations"],
    communicationStyle: "minimal typing, expects smart interpretation",
  },
} as const;

export type UserPersonaId = keyof typeof USER_PERSONAS;

// ═══════════════════════════════════════════════════════════════════════════════
// USER JOURNEY TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Common user journeys that combine multiple needs.
 */
export const USER_JOURNEYS = {
  ONBOARDING_FLOW: {
    id: "onboarding_flow",
    description: "New user sets up and starts using the system",
    needs: ["ESTABLISH_PRESENCE", "EXPRESS_WANT", "FIND_PEOPLE"],
    typicalTurns: 6,
  },

  ACTIVE_SEARCH: {
    id: "active_search",
    description: "User with profile actively looking for connections",
    needs: ["FIND_PEOPLE", "REFINE_INTENT", "FIND_PEOPLE"],
    typicalTurns: 5,
  },

  INTENT_LIFECYCLE: {
    id: "intent_lifecycle",
    description: "User creates, modifies, and eventually removes an intent",
    needs: ["EXPRESS_WANT", "REFINE_INTENT", "WITHDRAW_INTENT"],
    typicalTurns: 6,
  },

  COMMUNITY_EXPLORATION: {
    id: "community_exploration",
    description: "User explores and engages with communities",
    needs: ["UNDERSTAND_COMMUNITY", "FIND_PEOPLE", "JOIN_COMMUNITY"],
    typicalTurns: 5,
  },

  ERROR_RECOVERY: {
    id: "error_recovery",
    description: "User encounters issues and needs to recover",
    needs: ["EXPRESS_WANT", "RECOVER_FROM_ERROR", "EXPRESS_WANT"],
    typicalTurns: 5,
  },

  RETURNING_USER: {
    id: "returning_user",
    description: "User comes back after being away",
    needs: ["RESUME_CONTEXT", "UPDATE_IDENTITY", "FIND_PEOPLE"],
    typicalTurns: 5,
  },
} as const;

export type UserJourneyId = keyof typeof USER_JOURNEYS;

// ═══════════════════════════════════════════════════════════════════════════════
// SCENARIO GENERATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Generated test scenario combining need, persona, and context.
 */
export interface GeneratedScenario {
  id: string;
  need: (typeof USER_NEEDS)[UserNeedId];
  persona: (typeof USER_PERSONAS)[UserPersonaId];
  context: {
    hasProfile: boolean;
    hasIntents: boolean;
    intentsCount?: number;
    isIndexOwner: boolean;
    previousInteractions?: string;
  };
  generatedMessage: string;
  evaluationCriteria: {
    needFulfilled: string;
    successSignals: string[];
    failureSignals: string[];
    qualityFactors: string[];
  };
}

/**
 * Generates test scenarios by combining needs, personas, and contexts.
 */
export class ScenarioGenerator {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.8, // Higher for creative generation
    });
  }

  /**
   * Generate a user message for a specific need + persona combination.
   */
  async generateMessage(
    need: (typeof USER_NEEDS)[UserNeedId],
    persona: (typeof USER_PERSONAS)[UserPersonaId],
    context: GeneratedScenario["context"]
  ): Promise<string> {
    const prompt = `Generate a realistic user message for this scenario:

USER NEED: ${need.description}
Example messages for this need: ${need.examples.join("; ")}

USER PERSONA: ${persona.description}
Traits: ${persona.traits.join(", ")}
Communication style: ${persona.communicationStyle}

CONTEXT:
- Has profile: ${context.hasProfile}
- Has intents: ${context.hasIntents}${context.intentsCount ? ` (${context.intentsCount} intents)` : ""}
- Is index owner: ${context.isIndexOwner}
${context.previousInteractions ? `- Previous context: ${context.previousInteractions}` : ""}

Generate ONE message this user would send. Be authentic to the persona.
Just the message, nothing else.`;

    const response = await this.model.invoke([new HumanMessage(prompt)]);
    return typeof response.content === "string" ? response.content.trim() : String(response.content).trim();
  }

  /**
   * Generate multiple diverse scenarios for a user need.
   */
  async generateScenariosForNeed(needId: UserNeedId, count: number = 5): Promise<GeneratedScenario[]> {
    const need = USER_NEEDS[needId];
    const personaIds = Object.keys(USER_PERSONAS) as UserPersonaId[];
    const scenarios: GeneratedScenario[] = [];

    for (let i = 0; i < count; i++) {
      // Vary persona
      const personaId = personaIds[i % personaIds.length];
      const persona = USER_PERSONAS[personaId];

      // Vary context
      const context: GeneratedScenario["context"] = {
        hasProfile: Math.random() > 0.3,
        hasIntents: Math.random() > 0.4,
        intentsCount: Math.random() > 0.5 ? Math.floor(Math.random() * 5) + 1 : undefined,
        isIndexOwner: Math.random() > 0.7,
      };

      const message = await this.generateMessage(need, persona, context);

      scenarios.push({
        id: `${needId}-${personaId}-${i}`,
        need,
        persona,
        context,
        generatedMessage: message,
        evaluationCriteria: {
          needFulfilled: need.description,
          successSignals: need.successSignals,
          failureSignals: need.failureSignals,
          qualityFactors: [
            "Response is natural, not robotic",
            "Agent understood the underlying need",
            "Appropriate tools were used",
            "No unnecessary questions",
            "No internal JSON leaked",
          ],
        },
      });
    }

    return scenarios;
  }

  /**
   * Generate a full journey scenario with multiple turns.
   */
  async generateJourneyScenario(journeyId: UserJourneyId, personaId: UserPersonaId): Promise<GeneratedScenario[]> {
    const journey = USER_JOURNEYS[journeyId];
    const persona = USER_PERSONAS[personaId];
    const scenarios: GeneratedScenario[] = [];

    let context: GeneratedScenario["context"] = {
      hasProfile: journeyId !== "ONBOARDING_FLOW",
      hasIntents: journeyId !== "ONBOARDING_FLOW",
      isIndexOwner: journeyId === "COMMUNITY_EXPLORATION",
    };

    for (const needId of journey.needs) {
      const need = USER_NEEDS[needId as UserNeedId];
      const message = await this.generateMessage(need, persona, context);

      scenarios.push({
        id: `${journeyId}-${needId}-${personaId}`,
        need,
        persona,
        context: { ...context },
        generatedMessage: message,
        evaluationCriteria: {
          needFulfilled: need.description,
          successSignals: need.successSignals,
          failureSignals: need.failureSignals,
          qualityFactors: [
            "Journey progresses naturally",
            "Context from previous turns is maintained",
            "Agent adapts to user's communication style",
          ],
        },
      });

      // Update context for next turn
      if (needId === "ESTABLISH_PRESENCE") context.hasProfile = true;
      if (needId === "EXPRESS_WANT" || needId === "EXPRESS_OFFER") {
        context.hasIntents = true;
        context.intentsCount = (context.intentsCount || 0) + 1;
      }
    }

    return scenarios;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEED FULFILLMENT EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Evaluation result for a single interaction.
 */
export interface NeedFulfillmentResult {
  scenario: GeneratedScenario;
  conversation: Array<{ role: "user" | "assistant"; content: string }>;
  evaluation: {
    needFulfilled: boolean;
    fulfillmentScore: number; // 0-1
    successSignalsMatched: string[];
    failureSignalsTriggered: string[];
    qualityScore: number; // 0-1
    qualityNotes: string[];
    overallVerdict: "success" | "partial" | "failure" | "blocked" | "misunderstood";
    reasoning: string;
  };
  metadata: {
    turnCount: number;
    toolsUsed: string[];
    duration: number;
  };
}

const EVALUATOR_SYSTEM_PROMPT = `You are evaluating whether an AI assistant fulfilled a user's underlying need.

You will be given:
1. The user's ACTUAL NEED (what they're trying to accomplish)
2. The conversation that occurred
3. Success signals (indicators the need was met)
4. Failure signals (indicators something went wrong)
5. Quality factors to consider

Your job is to evaluate:
1. Was the underlying need fulfilled? (not just "did tools run")
2. How well was it fulfilled? (quality of experience)
3. What went right or wrong?

Respond with JSON:
{
  "needFulfilled": true/false,
  "fulfillmentScore": 0.0-1.0,
  "successSignalsMatched": ["signal1", "signal2"],
  "failureSignalsTriggered": ["signal1"],
  "qualityScore": 0.0-1.0,
  "qualityNotes": ["note1", "note2"],
  "overallVerdict": "success" | "partial" | "failure" | "blocked" | "misunderstood",
  "reasoning": "Explanation of evaluation"
}

Verdicts:
- success: Need fully fulfilled with good experience
- partial: Need somewhat fulfilled but incomplete or poor experience
- failure: Need not fulfilled despite conversation completing
- blocked: Agent got stuck, looped, or couldn't proceed
- misunderstood: Agent addressed wrong need entirely`;

/**
 * Evaluates whether a conversation fulfilled the user's need.
 */
export class NeedFulfillmentEvaluator {
  private model: ChatOpenAI;

  constructor() {
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.2,
    });
  }

  async evaluate(
    scenario: GeneratedScenario,
    conversation: Array<{ role: "user" | "assistant"; content: string }>,
    toolsUsed: string[]
  ): Promise<NeedFulfillmentResult["evaluation"]> {
    const conversationText = conversation.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");

    const prompt = `Evaluate this conversation:

## User's Underlying Need
${scenario.need.description}

## User Persona
${scenario.persona.description}
Style: ${scenario.persona.communicationStyle}

## User Context
- Has profile: ${scenario.context.hasProfile}
- Has intents: ${scenario.context.hasIntents}
- Is index owner: ${scenario.context.isIndexOwner}

## Conversation
${conversationText}

## Tools Used
${toolsUsed.length > 0 ? toolsUsed.join(", ") : "None"}

## Success Signals (need met if these happen)
${scenario.evaluationCriteria.successSignals.map((s) => `- ${s}`).join("\n")}

## Failure Signals (problems if these happen)
${scenario.evaluationCriteria.failureSignals.map((s) => `- ${s}`).join("\n")}

## Quality Factors
${scenario.evaluationCriteria.qualityFactors.map((q) => `- ${q}`).join("\n")}

Evaluate whether the user's need was fulfilled.`;

    const response = await this.model.invoke([new SystemMessage(EVALUATOR_SYSTEM_PROMPT), new HumanMessage(prompt)]);

    const content = typeof response.content === "string" ? response.content : String(response.content);

    try {
      const jsonMatch = content.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("No JSON found");
      return JSON.parse(jsonMatch[0]);
    } catch {
      return {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_failed"],
        qualityScore: 0,
        qualityNotes: ["Failed to parse evaluation response"],
        overallVerdict: "failure" as const,
        reasoning: "Evaluation parsing failed",
      };
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// SIMULATED USER AGENT
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Simulates a user with a specific need and persona.
 */
export class SimulatedUser {
  private model: ChatOpenAI;
  private scenario: GeneratedScenario;
  private conversationHistory: Array<{ role: "user" | "assistant"; content: string }> = [];
  private turnCount = 0;
  private maxTurns: number;
  private lastAssistantMessage = "";
  private repetitionCount = 0;

  constructor(scenario: GeneratedScenario, maxTurns: number = 4) {
    this.scenario = scenario;
    this.maxTurns = maxTurns;
    this.model = new ChatOpenAI({
      model: "google/gemini-2.5-flash",
      configuration: {
        baseURL: process.env.OPENROUTER_BASE_URL || "https://openrouter.ai/api/v1",
        apiKey: process.env.OPENROUTER_API_KEY,
      },
      temperature: 0.3, // Lower for more predictable responses
    });
  }

  /**
   * Get the initial message to start the conversation.
   */
  getInitialMessage(): string {
    return this.scenario.generatedMessage;
  }

  /**
   * Respond to the assistant's message as the simulated user.
   */
  async respond(assistantMessage: string): Promise<{ message: string; shouldContinue: boolean; reason?: string }> {
    this.conversationHistory.push({ role: "assistant", content: assistantMessage });
    this.turnCount++;

    // Hard limit on turns
    if (this.turnCount >= this.maxTurns) {
      return { message: "", shouldContinue: false, reason: "max_turns_reached" };
    }

    // Detect repetition/loops
    if (assistantMessage.slice(0, 100) === this.lastAssistantMessage.slice(0, 100)) {
      this.repetitionCount++;
      if (this.repetitionCount >= 2) {
        return { message: "", shouldContinue: false, reason: "stuck_loop_detected" };
      }
    } else {
      this.repetitionCount = 0;
    }
    this.lastAssistantMessage = assistantMessage;

    // Quick heuristic: if assistant confirmed an action, likely done
    const doneIndicators = [
      "created", "updated", "deleted", "removed", "done", "complete",
      "here's your", "here are", "i've", "successfully"
    ];
    const lowerResponse = assistantMessage.toLowerCase();
    const likelyDone = doneIndicators.some(indicator => lowerResponse.includes(indicator));

    const prompt = `You are simulating a user. Be DECISIVE - don't keep the conversation going unnecessarily.

## Your Need
${this.scenario.need.description}

## Turn ${this.turnCount}/${this.maxTurns} (conversation will END at turn ${this.maxTurns})

## Last Assistant Response
${assistantMessage.slice(0, 500)}

## Quick Decision Rules
- If the assistant DID what you asked → shouldContinue: false, reason: "need_fulfilled"
- If the assistant is ASKING a question you can answer → answer briefly, shouldContinue: true
- If the assistant FAILED or misunderstood → shouldContinue: false, reason: "misunderstood"
- If you've gone back and forth 2+ times → shouldContinue: false
- When in doubt → shouldContinue: false

${likelyDone ? "NOTE: The assistant seems to have completed an action. Consider if your need is fulfilled." : ""}

Respond ONLY with JSON (no other text):
{"shouldContinue": boolean, "reason": "need_fulfilled"|"answering_question"|"misunderstood"|"giving_up", "message": "your response or empty"}`;

    try {
      const response = await this.model.invoke([new HumanMessage(prompt)]);
      const content = typeof response.content === "string" ? response.content : String(response.content);

      const jsonMatch = content.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        return { message: "", shouldContinue: false, reason: "parse_error" };
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Force termination on certain reasons
      if (["need_fulfilled", "misunderstood", "giving_up"].includes(parsed.reason)) {
        return { message: parsed.message || "", shouldContinue: false, reason: parsed.reason };
      }

      if (parsed.message) {
        this.conversationHistory.push({ role: "user", content: parsed.message });
      }

      return {
        message: parsed.message || "",
        shouldContinue: Boolean(parsed.shouldContinue),
        reason: parsed.reason,
      };
    } catch {
      return { message: "", shouldContinue: false, reason: "parse_error" };
    }
  }

  getConversationHistory() {
    return this.conversationHistory;
  }

  addUserMessage(message: string) {
    this.conversationHistory.push({ role: "user", content: message });
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
// TEST RUNNER
// ═══════════════════════════════════════════════════════════════════════════════

export interface ChatAgentInterface {
  chat(message: string): Promise<{ response: string; toolsUsed: string[] }>;
  reset(): void;
}

/**
 * Run a need fulfillment test with timeout protection.
 */
export async function runNeedFulfillmentTest(
  scenario: GeneratedScenario,
  chatAgent: ChatAgentInterface,
  options?: {
    verbose?: boolean;
    maxTurns?: number;
    timeoutMs?: number;
  }
): Promise<NeedFulfillmentResult> {
  const startTime = Date.now();
  const maxTurns = options?.maxTurns || 4; // Reduced default
  const timeoutMs = options?.timeoutMs || 120000; // 2 min timeout
  const simulatedUser = new SimulatedUser(scenario, maxTurns);
  const evaluator = new NeedFulfillmentEvaluator();
  const allToolsUsed: string[] = [];

  chatAgent.reset();

  // Initial message
  let currentMessage = simulatedUser.getInitialMessage();
  simulatedUser.addUserMessage(currentMessage);

  if (options?.verbose) {
    console.log(`\n=== Scenario: ${scenario.id} ===`);
    console.log(`Need: ${scenario.need.description}`);
    console.log(`Persona: ${scenario.persona.id}`);
  }

  let turnCount = 0;
  let timedOut = false;

  while (turnCount < maxTurns) {
    // Check timeout
    if (Date.now() - startTime > timeoutMs) {
      timedOut = true;
      if (options?.verbose) {
        console.log(`[TIMEOUT] Exceeded ${timeoutMs}ms`);
      }
      break;
    }

    turnCount++;

    if (options?.verbose) {
      console.log(`\n[Turn ${turnCount}/${maxTurns}] USER: ${currentMessage}`);
    }

    // Chat agent responds with timeout
    let agentResult: { response: string; toolsUsed: string[] };
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("Agent timeout")), 60000)
      );
      agentResult = await Promise.race([chatAgent.chat(currentMessage), timeoutPromise]);
    } catch (e) {
      if (options?.verbose) {
        console.log(`[ERROR] Agent call failed: ${e}`);
      }
      break;
    }

    allToolsUsed.push(...agentResult.toolsUsed);

    if (options?.verbose) {
      console.log(`[Turn ${turnCount}] ASSISTANT: ${agentResult.response.slice(0, 200)}...`);
      if (agentResult.toolsUsed.length) {
        console.log(`[Turn ${turnCount}] Tools: ${agentResult.toolsUsed.join(", ")}`);
      }
    }

    // Simulated user decides what to do
    let userResponse: { message: string; shouldContinue: boolean; reason?: string };
    try {
      const timeoutPromise = new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("User sim timeout")), 30000)
      );
      userResponse = await Promise.race([simulatedUser.respond(agentResult.response), timeoutPromise]);
    } catch {
      userResponse = { message: "", shouldContinue: false, reason: "timeout" };
    }

    if (options?.verbose && userResponse.reason) {
      console.log(`[Turn ${turnCount}] User decision: ${userResponse.reason}`);
    }

    if (!userResponse.shouldContinue) {
      break;
    }

    if (!userResponse.message) {
      break; // No message means we're done
    }

    currentMessage = userResponse.message;
  }

  // Evaluate the conversation
  const conversation = simulatedUser.getConversationHistory();

  let evaluation: NeedFulfillmentResult["evaluation"];
  if (timedOut || conversation.length === 0) {
    evaluation = {
      needFulfilled: false,
      fulfillmentScore: 0,
      successSignalsMatched: [],
      failureSignalsTriggered: ["timeout_or_empty"],
      qualityScore: 0,
      qualityNotes: [timedOut ? "Test timed out" : "No conversation"],
      overallVerdict: "blocked",
      reasoning: timedOut ? "Test exceeded time limit" : "No conversation occurred",
    };
  } else {
    try {
      evaluation = await evaluator.evaluate(scenario, conversation, [...new Set(allToolsUsed)]);
    } catch {
      evaluation = {
        needFulfilled: false,
        fulfillmentScore: 0,
        successSignalsMatched: [],
        failureSignalsTriggered: ["evaluation_failed"],
        qualityScore: 0,
        qualityNotes: ["Evaluation failed"],
        overallVerdict: "failure",
        reasoning: "Could not evaluate conversation",
      };
    }
  }

  if (options?.verbose) {
    console.log(`\n=== Result: ${evaluation.overallVerdict} (${evaluation.fulfillmentScore}) ===`);
    console.log(`Reasoning: ${evaluation.reasoning}`);
  }

  return {
    scenario,
    conversation,
    evaluation,
    metadata: {
      turnCount,
      toolsUsed: [...new Set(allToolsUsed)],
      duration: Date.now() - startTime,
    },
  };
}

/**
 * Run a batch of tests and aggregate results.
 */
export async function runTestSuite(
  scenarios: GeneratedScenario[],
  chatAgent: ChatAgentInterface,
  options?: { verbose?: boolean; parallel?: boolean; maxTurns?: number; timeoutMs?: number }
): Promise<{
  results: NeedFulfillmentResult[];
  summary: {
    total: number;
    success: number;
    partial: number;
    failure: number;
    blocked: number;
    misunderstood: number;
    avgFulfillmentScore: number;
    avgQualityScore: number;
    byNeed: Record<string, { total: number; successRate: number }>;
    byPersona: Record<string, { total: number; successRate: number }>;
  };
}> {
  const results: NeedFulfillmentResult[] = [];
  const testOptions = {
    verbose: options?.verbose,
    maxTurns: options?.maxTurns || 3,
    timeoutMs: options?.timeoutMs || 90000,
  };

  if (options?.parallel) {
    const promises = scenarios.map((s) => runNeedFulfillmentTest(s, chatAgent, testOptions));
    results.push(...(await Promise.all(promises)));
  } else {
    for (const scenario of scenarios) {
      results.push(await runNeedFulfillmentTest(scenario, chatAgent, testOptions));
    }
  }

  // Aggregate results
  const summary = {
    total: results.length,
    success: results.filter((r) => r.evaluation.overallVerdict === "success").length,
    partial: results.filter((r) => r.evaluation.overallVerdict === "partial").length,
    failure: results.filter((r) => r.evaluation.overallVerdict === "failure").length,
    blocked: results.filter((r) => r.evaluation.overallVerdict === "blocked").length,
    misunderstood: results.filter((r) => r.evaluation.overallVerdict === "misunderstood").length,
    avgFulfillmentScore: results.reduce((sum, r) => sum + r.evaluation.fulfillmentScore, 0) / results.length,
    avgQualityScore: results.reduce((sum, r) => sum + r.evaluation.qualityScore, 0) / results.length,
    byNeed: {} as Record<string, { total: number; successRate: number }>,
    byPersona: {} as Record<string, { total: number; successRate: number }>,
  };

  // Group by need
  for (const result of results) {
    const needId = result.scenario.need.id;
    if (!summary.byNeed[needId]) {
      summary.byNeed[needId] = { total: 0, successRate: 0 };
    }
    summary.byNeed[needId].total++;
    if (result.evaluation.overallVerdict === "success") {
      summary.byNeed[needId].successRate++;
    }
  }
  for (const needId of Object.keys(summary.byNeed)) {
    summary.byNeed[needId].successRate /= summary.byNeed[needId].total;
  }

  // Group by persona
  for (const result of results) {
    const personaId = result.scenario.persona.id;
    if (!summary.byPersona[personaId]) {
      summary.byPersona[personaId] = { total: 0, successRate: 0 };
    }
    summary.byPersona[personaId].total++;
    if (result.evaluation.overallVerdict === "success") {
      summary.byPersona[personaId].successRate++;
    }
  }
  for (const personaId of Object.keys(summary.byPersona)) {
    summary.byPersona[personaId].successRate /= summary.byPersona[personaId].total;
  }

  return { results, summary };
}
