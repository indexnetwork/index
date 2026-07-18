import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { SystemNegotiationTurnSchema, FinalNegotiationTurnSchema, type NegotiationTurn, type UserNegotiationContext, type SeedAssessment } from "./negotiation.state.js";
import { turnSchemaFor, fallbackActionFor } from "./negotiation.protocol.js";
import type { NegotiationSeat, NegotiationProtocolVersion } from "../shared/schemas/negotiation-state.schema.js";
import type { NegotiationUserAnswer } from "../shared/interfaces/database.interface.js";
import { renderNegotiatorMemorySection, type NegotiatorMemoryEntry } from "./negotiation.memory.js";
import { renderBargainingShiftSection } from "./negotiation.deadlock.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";

const agentLog = protocolLogger("IndexNegotiator");

const SYSTEM_PROMPT = `You are the Index Negotiator, an AI agent acting on behalf of {userName}. You represent their interests in a bilateral negotiation about a potential connection on a discovery network.

{discoveryContext}
{discoveryQueryContext}
Your user's role in this connection: {role}
Network context: {networkContext}

Your job: Evaluate whether this connection genuinely serves {userName}'s interests given their role. Argue their case honestly — acknowledge weaknesses, but advocate for genuine fit.

Rules:
{actionRules}
- Focus on concrete intent alignment, not vague overlap.
- Do NOT reference internal system details like scores, pre-screens, or evaluator outputs.
- suggestedRoles: "agent" = can help, "patient" = seeks help, "peer" = mutual benefit.
{finalTurnInstruction}{bargainingShift}{negotiatorMemory}`;

/** v1 action rules — byte-identical to the pre-seat-rules prompt. */
const V1_ACTION_RULES = `- On the FIRST turn: Propose the connection case. Explain why it would benefit both parties. Set action to "propose".
- On SUBSEQUENT turns: Evaluate the other agent's arguments. Either:
  - "counter" if you have specific objections but see potential
  - "accept" if the match genuinely benefits {userName}
  - "reject" if the match does not serve {userName}'s needs`;

/** v2 initiator seat: reaching stance — accept is structurally unavailable. */
const V2_INITIATOR_RULES = `- You hold the INITIATING seat: your user's side surfaced this match and you are reaching out. Only the counterparty may accept — "accept" is NOT available to you.
- On the FIRST turn: Make the outreach case. Explain why the connection would benefit both parties. Set action to "outreach".
- On SUBSEQUENT turns: Evaluate the counterparty's arguments. Either:
  - "counter" if you have specific objections but see potential
  - "question" if you need a specific clarification from the counterparty
  - "withdraw" if the match does not serve {userName}'s needs`;

/**
 * v2 client-consult pause rule (P3.2). Appended to either seat's rules only
 * when the caller granted `canAskUser` — the action never appears in the
 * prompt (or the schema) otherwise.
 */
const ASK_USER_RULE = `
- "ask_user" if you need {userName}'s OWN input before you can proceed — typically permission to disclose something sensitive (budget, availability, private details) or a fact only they know. This PAUSES the negotiation until they answer (up to 24h), so use it only when proceeding without their input would risk over-disclosure or a wrong call. You get AT MOST ONE client consultation per negotiation — spend it well. Set askUser: { disclosureSubject: what you need permission for or need to know, draftQuestion: the question in your words }. Use "question" (not "ask_user") when the clarification should come from the other side.`;

/** v2 counterparty seat: receiving stance — acceptance is this seat's decision alone. */
const V2_COUNTERPARTY_RULES = `- You hold the RECEIVING seat: the other side reached out to {userName}. Whether to accept is YOUR seat's decision alone.
- Evaluate the initiator's arguments. Either:
  - "accept" if the match genuinely benefits {userName}
  - "decline" if the match does not serve {userName}'s needs
  - "counter" if you have specific objections but see potential
  - "question" if you need a specific clarification from the initiator
- Never use "outreach" — you are responding, not reaching out.`;

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
  /** Whether this negotiation is continuing a prior conversation with the same counterparty. */
  isContinuation?: boolean;
  /** User answers collected by the questioner between negotiation sessions. */
  userAnswers?: NegotiationUserAnswer[];
  /**
   * The acting user's seat under the v2 client-advocate protocol. Selects the
   * seat-scoped turn schema and prompt stance when `protocolVersion` is `v2`.
   * Ignored under v1. Defaults from `isDiscoverer` when omitted.
   */
  seat?: NegotiationSeat;
  /**
   * Negotiation protocol version for this task (inherited, never re-stamped).
   * `v1` (default) keeps the legacy symmetric vocabulary and prompt.
   */
  protocolVersion?: NegotiationProtocolVersion;
  /**
   * Whether the `ask_user` client-consult pause (P3.2) is available on this
   * turn. The caller (negotiation graph) grants it only when the feature flag
   * is on, the pause loop is fully wired (questioner + answer-window timer +
   * opportunity to resume against), the turn is v2 non-final and non-opening,
   * and this side has not already consumed its one client question for the
   * negotiation. When true, the seat schema and prompt gain the action.
   */
  canAskUser?: boolean;
  /**
   * Deadlock→bargaining drafting stance (IND-428, flag-gated by the caller).
   * Present = the graph detected a stalemate (N consecutive counter/question
   * turns) and this turn should be drafted in the bargaining stance —
   * concessions/scope reductions instead of re-arguing merits. v2 only;
   * ignored under v1. Absent → the prompt is byte-identical to before.
   */
  bargaining?: { consecutiveNonConvergent: number };
  /**
   * Retrieved negotiator memories for the acting user (P5.3 read path).
   * Rendered as a private prompt section — hard disclosure constraints plus
   * advisory hints. Absent/empty → the prompt is byte-identical to before.
   */
  memory?: NegotiatorMemoryEntry[];
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

// Resolver-valid range is `(0, Number.MAX_SAFE_INTEGER]`. The upper bound is
// the runtime ceiling: `AbortSignal.timeout(N)` throws when N is outside
// `[0, Number.MAX_SAFE_INTEGER]`, so `Number.isFinite` alone isn't enough —
// values like `1e30` pass finiteness but blow up at the AbortSignal call.
// The lower bound (`n > 0`) is a design choice rather than a runtime
// constraint: `AbortSignal.timeout(0)` is technically legal but would abort
// every turn before the LLM produces a response, so we reject it and fall
// back to the default just like any other invalid override.
function isValidTimeoutMs(n: number): boolean {
  return Number.isFinite(n) && n > 0 && n <= Number.MAX_SAFE_INTEGER;
}

function resolveTurnTimeoutMs(override?: number): number {
  if (typeof override === "number" && isValidTimeoutMs(override)) return override;
  const envValue = process.env.NEGOTIATOR_TURN_TIMEOUT_MS;
  if (envValue) {
    const parsed = Number(envValue);
    if (isValidTimeoutMs(parsed)) return parsed;
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
    const version: NegotiationProtocolVersion = input.protocolVersion ?? "v1";
    const seat: NegotiationSeat = input.seat ?? (input.isDiscoverer ? "initiator" : "counterparty");
    const isFinalTurn = input.isFinalTurn ?? false;
    const canAskUser = input.canAskUser === true && version === "v2" && !isFinalTurn;
    // Deadlock→bargaining stance (IND-428): v2 only — defense in depth on top
    // of the graph-side gating, mirroring the canAskUser guard above.
    const bargainingActive = input.bargaining != null && version === "v2";
    const schema = turnSchemaFor(version, seat, isFinalTurn, {
      system: SystemNegotiationTurnSchema,
      final: FinalNegotiationTurnSchema,
    }, { askUser: canAskUser });
    const model = createStructuredModel("negotiator", schema, { name: "index_negotiator" });

    const userName = input.ownUser.profile.name ?? "your user";
    const role = input.seedAssessment.valencyRole || "peer";
    const networkContext = input.indexContext.prompt || "General discovery";
    const actionRules = (version === "v2"
      ? (seat === "initiator" ? V2_INITIATOR_RULES : V2_COUNTERPARTY_RULES)
      : V1_ACTION_RULES) + (canAskUser ? ASK_USER_RULE : "");
    const finalTurnInstruction = input.isFinalTurn
      ? (version === "v2"
          ? (seat === "initiator"
              ? "\n\nIMPORTANT: This is your FINAL turn. You MUST choose either 'withdraw' or 'counter'. Accept is not available to your seat."
              : "\n\nIMPORTANT: This is your FINAL turn. You MUST choose either 'accept' or 'decline'. No counter is allowed.")
          : "\n\nIMPORTANT: This is your FINAL turn. You MUST choose either 'accept' or 'reject'. No counter is allowed.")
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
      .replace("{actionRules}", actionRules)
      .replace(/{userName}/g, userName)
      .replace("{discoveryContext}", discoveryContext)
      .replace("{discoveryQueryContext}", discoveryQueryContext)
      .replace("{role}", role)
      .replace("{networkContext}", networkContext)
      .replace("{finalTurnInstruction}", finalTurnInstruction)
      .replace("{bargainingShift}", renderBargainingShiftSection({
        active: bargainingActive,
        userName,
        canAskUser,
        consecutiveNonConvergent: input.bargaining?.consecutiveNonConvergent ?? 0,
      }))
      .replace("{negotiatorMemory}", renderNegotiatorMemorySection(input.memory ?? []));

    const historyText = input.history.length > 0
      ? `\n\nNegotiation history:\n${input.history.map((t, i) => {
          const msgPart = t.message ? ` — message: ${t.message}` : '';
          return `Turn ${i + 1}: ${t.action} — reasoning: ${t.assessment.reasoning}${msgPart}`;
        }).join("\n")}`
      : "";

    const continuationContext = input.isContinuation && input.history.length > 0
      ? `\n\n--- Prior dialogue with this counterparty ---
${historyText}

--- New signal under evaluation ---
${input.discoveryQuery
  ? `Discovery query: "${input.discoveryQuery}"`
  : `Seed assessment: ${input.seedAssessment.reasoning}`
}

Policy: You are continuing a prior dialogue. If this signal is materially the same as one you previously evaluated, you may resolve quickly. If materially different, evaluate on its own merits.`
      : '';

    const userAnswersContext = input.userAnswers && input.userAnswers.length > 0
      ? `\n\n--- ${userName}'s additional context (provided between sessions) ---\n${input.userAnswers.map((a) => {
          const opts = Array.isArray(a.selectedOptions) ? a.selectedOptions : [];
          const parts = opts.length > 0 ? opts.join(', ') : '';
          const free = a.freeText ? (parts ? ` — ${a.freeText}` : a.freeText) : '';
          if (!parts && !free) return '';
          return `- ${parts}${free}`;
        }).filter(Boolean).join("\n")}\n`
      : '';

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

Why this match was suggested: ${input.seedAssessment.reasoning}${input.isContinuation ? continuationContext : historyText}${userAnswersContext}
${discoveryQueryReminder}
${input.history.length === 0 && !input.isContinuation ? (version === "v2" && seat === "initiator" ? "This is the opening turn. Make the outreach case." : "This is the opening turn. Propose the connection case.") : "Evaluate the latest arguments and respond."}`;

    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    // Structured output is schema-constrained, but providers can still emit
    // out-of-vocabulary actions. Validate; retry once; then fall back to the
    // conservative seat-valid action instead of poisoning the turn history.
    for (let attempt = 0; attempt < 2; attempt++) {
      const result = await this.callModel(model, chatMessages);
      const parsed = schema.safeParse(result);
      if (parsed.success) return parsed.data as NegotiationTurn;
      agentLog.warn("Negotiator output failed seat-schema validation", {
        attempt: attempt + 1,
        seat,
        version,
        isFinalTurn,
        issues: parsed.error.issues.map((i) => i.message).slice(0, 3),
      });
    }

    const fallbackAction = fallbackActionFor(version, seat, isFinalTurn);
    agentLog.warn("Negotiator output invalid after retry; using conservative fallback", {
      seat, version, isFinalTurn, fallbackAction,
    });
    return {
      action: fallbackAction,
      assessment: {
        reasoning: "Agent produced an invalid response; conservative fallback applied.",
        suggestedRoles: { ownUser: "peer", otherUser: "peer" },
      },
      message: null,
    };
  }

  /**
   * Raw structured-model round trip. Split out as a seam so tests can drive
   * the validate→retry→fallback loop without a live provider.
   */
  protected async callModel(
    model: ReturnType<typeof createStructuredModel>,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    return invokeWithAbortSignal(model, chatMessages, AbortSignal.timeout(this.turnTimeoutMs));
  }
}
