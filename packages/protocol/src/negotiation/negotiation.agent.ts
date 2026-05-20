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

export interface IndexNegotiatorConfig {
  /**
   * Hard ceiling on a single LLM turn round-trip, in ms. When the underlying
   * model.invoke call exceeds this, an AbortSignal cancels the request and the
   * promise rejects — the calling turn node catches the rejection and treats it
   * as a failed turn, so one slow upstream call cannot consume the whole
   * negotiate-phase budget.
   *
   * Defaults to `NEGOTIATOR_TURN_TIMEOUT_MS` env var when set, otherwise
   * `DEFAULT_TURN_TIMEOUT_MS`. Sized to clip the p99 tail on Gemini-2.5-Flash
   * (~20 s today on OpenRouter) without trimming p90 (~12 s).
   */
  turnTimeoutMs?: number;
}

const DEFAULT_TURN_TIMEOUT_MS = 15_000;

function resolveTurnTimeoutMs(override?: number): number {
  // `> 0` alone would accept Infinity (`Infinity > 0` is true) and reject NaN
  // by coincidence (NaN comparisons are always false). `AbortSignal.timeout`
  // throws on both, so require a finite positive number explicitly.
  if (typeof override === "number" && Number.isFinite(override) && override > 0) return override;
  const envValue = process.env.NEGOTIATOR_TURN_TIMEOUT_MS;
  if (envValue) {
    const parsed = Number(envValue);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  return DEFAULT_TURN_TIMEOUT_MS;
}

/**
 * Unified system negotiation agent that advocates for its user.
 * Adapts behavior based on turn position (first turn = propose, subsequent = respond).
 * @remarks Uses structured output constrained to NegotiationTurnSchema (without question action).
 */
export class IndexNegotiator {
  private readonly turnTimeoutMs: number;

  constructor(config?: IndexNegotiatorConfig) {
    this.turnTimeoutMs = resolveTurnTimeoutMs(config?.turnTimeoutMs);
  }

  /**
   * Generate a negotiation turn.
   * @param input - User contexts, seed assessment, history, and final turn flag
   * @returns A structured NegotiationTurn
   * @throws If the per-turn timeout fires before the LLM responds.
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

    const result = await model.invoke(
      [
        { role: "system", content: systemPrompt },
        { role: "user", content: userMessage },
      ],
      { signal: AbortSignal.timeout(this.turnTimeoutMs) },
    );

    return result as NegotiationTurn;
  }
}
