import { createModel } from "../shared/agent/model.config.js";
import {
  SystemNegotiationTurnSchema,
  FinalNegotiationTurnSchema,
  type NegotiationTurn,
  type UserNegotiationContext,
  type SeedAssessment,
} from "./negotiation.state.js";

const SYSTEM_PROMPT = `You are the Index Negotiator, an AI agent acting on behalf of {userName}. You represent their interests in a bilateral negotiation about a potential connection on a discovery network.

{discoveryContext}
{discoveryQueryContext}
Your user's role in this connection: {role}
Network context: {networkContext}

Your job: Evaluate whether this connection genuinely serves {userName}'s interests given their role. Argue their case honestly — acknowledge weaknesses, but advocate for genuine fit.

Rules:
- On the FIRST turn: Propose the connection case. Explain why it would benefit both parties. Set action to "propose".
- On SUBSEQUENT turns: Evaluate the other agent's arguments. Either:
  - "counter" if you have specific objections but see potential
  - "accept" if the match genuinely benefits {userName}
  - "reject" if the match does not serve {userName}'s needs
- Focus on concrete intent alignment, not vague overlap.
- Do NOT reference internal system details like scores, pre-screens, or evaluator outputs.
- suggestedRoles: "agent" = can help, "patient" = seeks help, "peer" = mutual benefit.
- assessment.clarificationQuestion: When (and ONLY when) you "reject" because a SPECIFIC piece of information is missing from {userName}'s intent or profile that — if provided — would let you reconsider, populate this field with a single, concrete question phrased directly to {userName} (e.g. "What stage is your company at?" or "Which sectors are you raising for?"). Leave null on accept/counter/propose, on rejections caused by hard mismatches (wrong role, wrong query subject, fundamentally different goals), and when no specific answer would change your mind.
{finalTurnInstruction}`;

export interface NegotiationAgentInput {
  ownUser: UserNegotiationContext;
  otherUser: UserNegotiationContext;
  indexContext: { networkId: string; prompt?: string };
  seedAssessment: SeedAssessment;
  history: NegotiationTurn[];
  isFinalTurn?: boolean;
  /** Whether ownUser is the party that initiated the discovery (searched/signalled). */
  isDiscoverer?: boolean;
  /** The explicit search query that triggered discovery (if any). Takes priority over background intents. */
  discoveryQuery?: string;
}

/**
 * Unified system negotiation agent that advocates for its user.
 * Adapts behavior based on turn position (first turn = propose, subsequent = respond).
 * @remarks Uses structured output constrained to NegotiationTurnSchema (without question action).
 */
export class IndexNegotiator {
  /**
   * Generate a negotiation turn.
   * @param input - User contexts, seed assessment, history, and final turn flag
   * @returns A structured NegotiationTurn
   */
  async invoke(input: NegotiationAgentInput): Promise<NegotiationTurn> {
    const schema = input.isFinalTurn ? FinalNegotiationTurnSchema : SystemNegotiationTurnSchema;
    const model = createModel("negotiator").withStructuredOutput(schema, { name: "index_negotiator" });

    const userName = input.ownUser.profile.name ?? "your user";
    const role = input.seedAssessment.valencyRole || "peer";
    const networkContext = input.indexContext.prompt || "General discovery";
    const finalTurnInstruction = input.isFinalTurn
      ? "\n\nIMPORTANT: This is your FINAL turn. You MUST choose either 'accept' or 'reject'. No counter is allowed."
      : "";

    const otherName = input.otherUser.profile.name ?? "the other user";
    const discoveryContext = input.isDiscoverer
      ? `${userName} initiated this discovery — they are actively looking for connections. ${otherName} was identified as a potential match.`
      : `${otherName} initiated this discovery and found ${userName} as a potential match. You are representing the discovered party.`;

    const discoveryQueryContext = input.discoveryQuery
      ? `\nDISCOVERY QUERY: ${userName} explicitly searched for "${input.discoveryQuery}".
QUERY PRIORITY RULE: This search query is the PRIMARY criterion for this negotiation. Before evaluating intents or profile overlap, first answer: does ${otherName} satisfy the search query "${input.discoveryQuery}"?
- If the query is a role or identity term (e.g. "samurai", "investors", "designers"): check whether ${otherName} IS that thing based on their profile. Subject-matter adjacency does not count (drawing samurai ≠ being a samurai, raising funding ≠ being an investor).
- If ${otherName} does NOT satisfy the query: REJECT the match. Background intents cannot rescue a query mismatch.
- If ${otherName} DOES satisfy the query: PROPOSE or ACCEPT the connection and evaluate fit normally using intents and profile data.`
      : '';

    const systemPrompt = SYSTEM_PROMPT
      .replace(/{userName}/g, userName)
      .replace("{discoveryContext}", discoveryContext)
      .replace("{discoveryQueryContext}", discoveryQueryContext)
      .replace("{role}", role)
      .replace("{networkContext}", networkContext)
      .replace("{finalTurnInstruction}", finalTurnInstruction);

    const historyText = input.history.length > 0
      ? `\n\nNegotiation history:\n${input.history.map((t, i) => {
          const msgPart = t.message ? ` — message: ${t.message}` : '';
          return `Turn ${i + 1}: ${t.action} — reasoning: ${t.assessment.reasoning}${msgPart}`;
        }).join("\n")}`
      : "";

    const discoveryQueryReminder = input.discoveryQuery
      ? `\nREMINDER: ${userName} searched for "${input.discoveryQuery}". Evaluate ${otherName} against this query FIRST. If ${otherName} is not a "${input.discoveryQuery}", reject.\n`
      : '';

    const intentsLabel = input.discoveryQuery ? 'Background intents (secondary to discovery query)' : 'Intents';

    const userMessage = `YOUR USER (${userName}):
Bio: ${input.ownUser.profile.bio ?? "N/A"}
Skills: ${input.ownUser.profile.skills?.join(", ") ?? "N/A"}
${intentsLabel}:
${input.ownUser.intents.map((i) => `- ${i.title}: ${i.description}`).join("\n")}

OTHER USER (${otherName}):
Bio: ${input.otherUser.profile.bio ?? "N/A"}
Skills: ${input.otherUser.profile.skills?.join(", ") ?? "N/A"}
Intents:
${input.otherUser.intents.map((i) => `- ${i.title}: ${i.description}`).join("\n")}

Why this match was suggested: ${input.seedAssessment.reasoning}${historyText}
${discoveryQueryReminder}
${input.history.length === 0 ? "This is the opening turn. Propose the connection case." : "Evaluate the latest arguments and respond."}`;

    const result = await model.invoke([
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);

    return result as NegotiationTurn;
  }
}
