import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import type { UserNegotiationContext, SeedAssessment } from "../shared/schemas/negotiation-state.schema.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";
import { renderNegotiatorMemorySection, type NegotiatorMemoryEntry } from "./negotiation.memory.js";
import type { NegotiationTurn } from "./negotiation.state.js";
import { attributedDialogueIsEmpty, renderAttributedPriorDialogue, type AttributedPriorDialogue } from "./negotiation.attribution.js";

const screenLog = protocolLogger("NegotiationScreener");

/**
 * Screen-gate modes (P2.1 — client-advocate protocol).
 *
 * - `off` — the screen node is skipped entirely; no LLM call, no telemetry.
 * - `shadow` — the screen decision is made and recorded (task metadata +
 *   trace event + log line) but NEVER blocks: every fresh negotiation still
 *   proceeds to the first turn. Used to measure pass rates against observed
 *   reject rates before enforcement.
 * - `enforce` — (P2.2) a `pass` decision blocks the negotiation before the
 *   first turn: the graph routes straight to finalize with outcome
 *   `reason: "screened_out"` — zero turns, zero counterparty involvement,
 *   zero notifications; the opportunity is quietly `rejected`. A failed
 *   screen still fails OPEN (never blocks), and `reach_out` proceeds normally.
 */
export const NEGOTIATION_SCREEN_MODES = ["off", "shadow", "enforce"] as const;

export type NegotiationScreenMode = (typeof NEGOTIATION_SCREEN_MODES)[number];

/**
 * Resolve the screen mode from `NEGOTIATION_SCREEN_MODE`.
 *
 * Defaults to `off` when unset or unrecognized — the screen gate is an
 * explicit opt-in flip (same operational pattern as
 * `NEGOTIATION_PROTOCOL_VERSION` / `NEGOTIATOR_CHAT_ENABLED`): code ships
 * inert, the environment turns it on.
 */
export function configuredScreenMode(): NegotiationScreenMode {
  const raw = process.env.NEGOTIATION_SCREEN_MODE;
  if (raw === "shadow" || raw === "enforce" || raw === "off") return raw;
  return "off";
}

/**
 * Structured screen decision — the outreach gate's verdict on whether this
 * match is worth the client's name before any turn is exchanged.
 */
export const ScreenDecisionSchema = z.object({
  decision: z.enum(["reach_out", "pass"]),
  reasoning: z.string(),
  /** Suggested opening angle for the outreach turn (only when reaching out). */
  outreachAngle: z.string().nullable().optional(),
  evidence: z.object({
    /** How well the counterparty's context/premises fit the client's need. */
    counterpartyPremiseFit: z.string(),
    /** How the client's intents align with what the counterparty seeks. */
    intentAlignment: z.string(),
    /** Prior-negotiation memory signals (P5.3). Filled only when negotiator memory was injected into the screen prompt. */
    memoryHints: z.string().nullable().optional(),
  }),
});

export type ScreenDecision = z.infer<typeof ScreenDecisionSchema>;

/**
 * The record persisted to `tasks.metadata.screenDecision` and returned into
 * graph state. Extends the LLM decision with operational context so pass-rate
 * queries can group by mode and exclude failed-open rows.
 */
export interface ScreenDecisionRecord extends ScreenDecision {
  mode: NegotiationScreenMode;
  /** True when the screen LLM call failed and the gate defaulted open. */
  failedOpen?: boolean;
  /** Error message when `failedOpen` is set. */
  error?: string;
  screenedAt: string;
  durationMs: number;
}

export interface NegotiationScreenerInput {
  /** The client — the user whose negotiator is deciding whether to reach out. */
  clientUser: UserNegotiationContext;
  /** The counterparty the client's negotiator would be reaching out to. */
  counterpartyUser: UserNegotiationContext;
  /** The counterparty's `user_contexts` paragraph (empty string when absent). */
  counterpartyContext?: string;
  /** The explicit search query that triggered discovery (if any). */
  discoveryQuery?: string;
  seedAssessment: Omit<SeedAssessment, "actors">;
  indexContext: { networkId: string; prompt?: string };
  /**
   * Retrieved negotiator memories for the client (P5.3 read path). Rendered
   * as a private prompt section with a memoryHints instruction. Absent/empty
   * → the prompt is byte-identical to before.
   */
  memory?: NegotiatorMemoryEntry[];
  /**
   * Whether this screen is for a continuation — a match against a counterparty
   * this client already has prior dialogue with (IND-563). When set with
   * `priorDialogue`, the gate evaluates the NEW signal on its own merits with
   * that dialogue as context. Absent → the prompt is byte-identical to before.
   */
  isContinuation?: boolean;
  /**
   * Prior negotiation turns with this counterparty (continuations only).
   * Rendered as read-only context so the gate can tell a materially-new signal
   * from a rehash of an already-settled one. Never treated as this task's own
   * outreach.
   */
  priorDialogue?: NegotiationTurn[];
  /**
   * Attributed form of the prior dialogue (IND-569). When present it supersedes
   * the flat `priorDialogue` list: earlier concluded opportunities and legacy
   * unattributed turns render as labeled, separated blocks so the gate can see
   * which prior turns belonged to OTHER opportunities. Absent → the flat
   * `priorDialogue` rendering is used (byte-identical to before).
   */
  priorDialogueAttributed?: AttributedPriorDialogue;
}

const SYSTEM_PROMPT = `You are the outreach gate for {clientName}'s negotiator agent on a discovery network. Before any negotiation turn is exchanged, you decide whether this match is worth reaching out to on {clientName}'s behalf — their name and attention are spent with every outreach.

Network context: {networkContext}

Decide:
- "reach_out" when the counterparty plausibly serves {clientName}'s stated needs and a concrete, honest opening case can be made. When reaching out, set outreachAngle to the strongest specific angle for the opening message.
- "pass" when the match is generic, one-sided, or rests on vague overlap that would waste both parties' attention.

Rules:
{queryRule}
- Judge concrete intent alignment, not topical adjacency.
- Fill evidence.counterpartyPremiseFit with what (if anything) in the counterparty's context actually fits, and evidence.intentAlignment with how the intents line up. Be specific; cite the strongest signal either way.
- Do NOT reference internal system details like scores, pre-screens, or evaluator outputs in reasoning that could be shown to users.{negotiatorMemory}`;

const QUERY_RULE = `- {clientName} explicitly searched for "{discoveryQuery}". This query is the PRIMARY criterion: if the counterparty does not satisfy it, pass — background intents cannot rescue a query mismatch.`;
const NO_QUERY_RULE = `- No explicit search query: judge against {clientName}'s active intents.`;

const DEFAULT_SCREEN_TIMEOUT_MS = 15_000;

export interface NegotiationScreenerConfig {
  /** Hard ceiling on the screen LLM round-trip, in ms (default 15000). */
  timeoutMs?: number;
}

/**
 * The outreach gate (P2.1). One structured LLM call deciding
 * `reach_out | pass` for a fresh negotiation, from the reaching client's
 * perspective. Throws on LLM/validation failure — the screen graph node owns
 * the fail-open policy (a failed screen never blocks the negotiation).
 */
export class NegotiationScreener {
  private readonly timeoutMs: number;

  constructor(config?: NegotiationScreenerConfig) {
    this.timeoutMs = config?.timeoutMs && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_SCREEN_TIMEOUT_MS;
  }

  /**
   * Produce a screen decision for a fresh match.
   * @throws When the LLM call times out or returns schema-invalid output.
   */
  async invoke(input: NegotiationScreenerInput): Promise<ScreenDecision> {
    const model = createStructuredModel("negotiationScreener", ScreenDecisionSchema, { name: "negotiation_screener" });

    const clientName = input.clientUser.profile.name ?? "your client";
    const counterpartyName = input.counterpartyUser.profile.name ?? "the counterparty";
    const networkContext = input.indexContext.prompt || "General discovery";
    const queryRule = (input.discoveryQuery ? QUERY_RULE : NO_QUERY_RULE)
      .replace(/{clientName}/g, clientName)
      .replace(/{discoveryQuery}/g, input.discoveryQuery ?? "");

    const systemPrompt = SYSTEM_PROMPT
      .replace(/{clientName}/g, clientName)
      .replace("{networkContext}", networkContext)
      .replace("{queryRule}", queryRule)
      .replace("{negotiatorMemory}", renderNegotiatorMemorySection(input.memory ?? [], { memoryHintsInstruction: true }));

    const formatIntents = (intents: UserNegotiationContext["intents"]): string =>
      intents.length > 0 ? intents.map((i) => `- ${i.title}: ${i.description}`).join("\n") : "- (none)";

    const formatScreenTurn = (t: NegotiationTurn, i: number) => {
      const msgPart = t.message ? ` — ${t.message}` : "";
      return `Turn ${i + 1}: ${t.action} — ${t.assessment.reasoning}${msgPart}`;
    };

    // IND-569: prefer the attributed rendering (labeled per-opportunity blocks)
    // when the graph supplies it; otherwise fall back to the flat prior-turn list.
    const hasAttributed = input.isContinuation
      && input.priorDialogueAttributed != null
      && !attributedDialogueIsEmpty(input.priorDialogueAttributed);
    const flatPriorDialogue = input.isContinuation && input.priorDialogue && input.priorDialogue.length > 0
      ? input.priorDialogue
      : [];
    const priorDialogueBody = hasAttributed
      ? renderAttributedPriorDialogue(input.priorDialogueAttributed!, formatScreenTurn)
      : (flatPriorDialogue.length > 0 ? flatPriorDialogue.map(formatScreenTurn).join("\n") : "");
    const priorDialogueContext = priorDialogueBody
      ? `\n\n--- Prior dialogue with ${counterpartyName} (already spoken) ---\n${priorDialogueBody}\n\nThis is a NEW signal against a counterparty ${clientName} has prior dialogue with. Some turns above may belong to OTHER, already-concluded opportunities (each block is labeled); they are background only. Judge the new signal on its own merits: if it is materially the same as what was already discussed, pass unless something concrete changed; if materially different, judge it fresh. Do NOT reach out again on generic overlap just because they spoke before.`
      : "";

    const userMessage = `YOUR CLIENT (${clientName}):
Bio: ${input.clientUser.profile.bio ?? "N/A"}
${input.discoveryQuery ? `Search query: "${input.discoveryQuery}"\nBackground intents (secondary to the query):` : "Active intents:"}
${formatIntents(input.clientUser.intents)}

COUNTERPARTY (${counterpartyName}):
Bio: ${input.counterpartyUser.profile.bio ?? "N/A"}
${input.counterpartyContext ? `Context: ${input.counterpartyContext}\n` : ""}Active intents:
${formatIntents(input.counterpartyUser.intents)}

Why this match was suggested: ${input.seedAssessment.reasoning}${priorDialogueContext}

Decide whether reaching out serves ${clientName}.`;

    const chatMessages = [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ];

    const result = await this.callModel(model, chatMessages);
    const parsed = ScreenDecisionSchema.safeParse(result);
    if (!parsed.success) {
      screenLog.warn("Screen output failed schema validation", {
        issues: parsed.error.issues.map((i) => i.message).slice(0, 3),
      });
      throw new Error(`Screen decision failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    }
    return parsed.data;
  }

  /**
   * Raw structured-model round trip. Split out as a seam so tests can drive
   * the schema-validation and fail-open paths without a live provider.
   */
  protected async callModel(
    model: ReturnType<typeof createStructuredModel>,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    return invokeWithAbortSignal(model, chatMessages, AbortSignal.timeout(this.timeoutMs));
  }
}
