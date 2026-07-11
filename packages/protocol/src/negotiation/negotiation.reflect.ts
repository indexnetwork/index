import { z } from "zod";

import { createStructuredModel } from "../shared/agent/model.config.js";
import { invokeWithAbortSignal } from "../shared/agent/model-signal.js";
import { protocolLogger } from "../shared/observability/protocol.logger.js";

const reflectLog = protocolLogger("NegotiationReflector");

/**
 * Memory kinds a reflection pass may distill (P5.1 `negotiator_memories.kind`).
 * Plain text at the DB level (55P04 lesson) — adding kinds is code-only.
 */
export const NEGOTIATOR_MEMORY_KINDS = [
  "playbook",
  "disclosure_rule",
  "counterparty_dossier",
  "threshold",
] as const;

export type DistilledMemoryKind = (typeof NEGOTIATOR_MEMORY_KINDS)[number];

/** Hard ceiling on entries distilled per reflection pass (per side). */
export const MAX_DISTILLED_MEMORIES = 3;

/**
 * One distilled memory entry as produced by the reflection LLM. The caller
 * owns persistence: it resolves `aboutCounterparty` to a `subjectUserId`,
 * computes the embedding, and attaches provenance `sourceRefs`.
 */
export const DistilledMemorySchema = z.object({
  kind: z.enum(NEGOTIATOR_MEMORY_KINDS),
  /** Self-contained operational statement, useful without the transcript. */
  content: z.string().min(1),
  /** Evidence strength, 0..1. Explicit client statements score high. */
  confidence: z.number().min(0).max(1),
  /**
   * True when the entry is about the counterparty (kind should be
   * `counterparty_dossier`); false for client-side rules and playbooks.
   */
  aboutCounterparty: z.boolean(),
  /** Turn indexes (0-based, into the provided transcript) evidencing this entry. */
  turnIndexes: z.array(z.number().int().min(0)).default([]),
});

export type DistilledMemory = z.infer<typeof DistilledMemorySchema>;

export const ReflectionResultSchema = z.object({
  memories: z.array(DistilledMemorySchema).max(MAX_DISTILLED_MEMORIES),
});

export type ReflectionResult = z.infer<typeof ReflectionResultSchema>;

/** A transcript row projected into the reflecting client's perspective. */
export interface ReflectionTranscriptEntry {
  index: number;
  speaker: "client" | "counterparty";
  action: string;
  message?: string;
  reasoning?: string;
}

export interface NegotiationReflectionInput {
  /** The user whose negotiator is reflecting (memories land on their agent). */
  clientUser: { id: string; name?: string; bio?: string };
  counterpartyUser: { id: string; name?: string; bio?: string };
  /** The client's seat in this negotiation. */
  seat: "initiator" | "counterparty";
  outcome: { hasOpportunity: boolean; reasoning: string; turnCount: number };
  transcript: ReflectionTranscriptEntry[];
  /** Network prompt for context (optional). */
  indexContext?: string;
}

export interface ChatReflectionInput {
  clientUser: { id: string; name?: string };
  /** The negotiator DM messages, oldest first. */
  messages: Array<{ role: "user" | "assistant"; content: string }>;
}

/**
 * Payload the finalize node hands to the injected {@link ReflectEnqueueFn}.
 * Carries user display context so the reflect worker never re-loads profiles;
 * turn history is loaded from the conversation by the worker (payloads stay
 * small in Redis).
 */
export interface NegotiationReflectJobData {
  negotiationId: string;
  conversationId: string;
  opportunityId?: string;
  sourceUser: { id: string; name?: string; bio?: string };
  candidateUser: { id: string; name?: string; bio?: string };
  initiatorUserId: string;
  outcome: { hasOpportunity: boolean; reasoning: string; turnCount: number };
}

/**
 * Injected enqueue callback for post-negotiation reflection (P5.2). The
 * protocol package has no BullMQ access — services/api wires this at its
 * composition roots, exactly like `QuestionerEnqueueFn`. Called fire-and-
 * forget from the finalize node: a reflection failure must never affect the
 * negotiation outcome.
 */
export type ReflectEnqueueFn = (job: NegotiationReflectJobData) => Promise<void>;

const NEGOTIATION_SYSTEM_PROMPT = `You are the private post-negotiation reflection process for {clientName}'s negotiator agent. The negotiation is over; your job is to distill AT MOST ${MAX_DISTILLED_MEMORIES} durable operational memory entries that will make {clientName}'s negotiator better in FUTURE negotiations. These memories are private to {clientName}'s agent — the counterparty never sees them.

Memory kinds:
- "playbook": a tactic or pattern that worked or failed (e.g. "Opening with the specific shared-interest angle got engagement; generic intros stalled").
- "disclosure_rule": what {clientName} is or is not willing to share/commit (only when the transcript actually evidences it).
- "counterparty_dossier": a durable fact about the counterparty useful in future dealings with THEM specifically (set aboutCounterparty=true).
- "threshold": a concrete boundary observed (e.g. minimum scope, timing constraints, deal-breakers).

Rules:
- Record ONLY what future negotiations need. No summaries, no play-by-play, no identity facts about {clientName} (their profile already covers those).
- Every entry MUST cite the transcript turn indexes that evidence it in turnIndexes.
- Each content string must be self-contained and actionable without the transcript.
- Set confidence by evidence strength: explicit statements ≈ 0.8-0.9, inferred patterns ≈ 0.4-0.6.
- aboutCounterparty=true ONLY for counterparty_dossier entries.
- Return an empty memories array when nothing durable was learned — most short or failed negotiations teach nothing. Do not force entries.`;

const CHAT_SYSTEM_PROMPT = `You are the private reflection process for {clientName}'s negotiator agent, reviewing a direct chat between {clientName} (the client) and their negotiator. Distill AT MOST ${MAX_DISTILLED_MEMORIES} durable operational memory entries capturing the client's STATED preferences, corrections, and instructions.

Memory kinds:
- "playbook": how the client wants negotiations approached (style, priorities).
- "disclosure_rule": what the client said they will or won't share/commit.
- "threshold": concrete boundaries the client stated (rates, scope, timing, deal-breakers).

Rules:
- Only distill what the CLIENT stated or clearly confirmed — never invent preferences from the negotiator's own suggestions.
- Do NOT produce counterparty_dossier entries; this is a client-side conversation. Always set aboutCounterparty=false.
- Each content string must be self-contained and actionable.
- turnIndexes cite 0-based indexes into the provided message list.
- Set confidence by how explicit the client was (direct instruction ≈ 0.9, implied preference ≈ 0.5).
- Return an empty memories array when the chat contains no durable guidance — casual Q&A usually doesn't.`;

const DEFAULT_REFLECT_TIMEOUT_MS = 20_000;

export interface NegotiationReflectorConfig {
  /** Hard ceiling on the reflection LLM round-trip, in ms (default 20000). */
  timeoutMs?: number;
}

/**
 * The memory distiller (P5.2). One structured LLM call per reflection pass,
 * producing ≤ {@link MAX_DISTILLED_MEMORIES} private memory entries for one
 * client's negotiator. Throws on LLM/validation failure — callers (the reflect
 * queue worker) own the swallow-and-log policy, since reflection must never
 * affect a negotiation outcome.
 */
export class NegotiationReflector {
  private readonly timeoutMs: number;

  constructor(config?: NegotiationReflectorConfig) {
    this.timeoutMs = config?.timeoutMs && Number.isFinite(config.timeoutMs) && config.timeoutMs > 0
      ? config.timeoutMs
      : DEFAULT_REFLECT_TIMEOUT_MS;
  }

  /**
   * Distill memories from a finished negotiation, from one side's perspective.
   * @throws When the LLM call times out or returns schema-invalid output.
   */
  async reflectNegotiation(input: NegotiationReflectionInput): Promise<DistilledMemory[]> {
    const clientName = input.clientUser.name ?? "the client";
    const counterpartyName = input.counterpartyUser.name ?? "the counterparty";

    const systemPrompt = NEGOTIATION_SYSTEM_PROMPT.replace(/{clientName}/g, clientName);

    const transcriptText = input.transcript.length > 0
      ? input.transcript.map((t) => {
          const who = t.speaker === "client" ? `${clientName}'s negotiator` : `${counterpartyName}'s negotiator`;
          const parts = [`[${t.index}] ${who} → ${t.action}`];
          if (t.message) parts.push(`message: ${t.message}`);
          if (t.reasoning) parts.push(`reasoning: ${t.reasoning}`);
          return parts.join("\n  ");
        }).join("\n")
      : "(no turns)";

    const userMessage = `CLIENT: ${clientName}${input.clientUser.bio ? ` — ${input.clientUser.bio}` : ""}
SEAT: ${input.seat === "initiator" ? "initiator (client's negotiator reached out)" : "counterparty (client's negotiator was reached)"}
COUNTERPARTY: ${counterpartyName}${input.counterpartyUser.bio ? ` — ${input.counterpartyUser.bio}` : ""}
${input.indexContext ? `NETWORK CONTEXT: ${input.indexContext}\n` : ""}
OUTCOME: ${input.outcome.hasOpportunity ? "accepted" : "not accepted"} after ${input.outcome.turnCount} turn(s) — ${input.outcome.reasoning}

TRANSCRIPT:
${transcriptText}

Distill the durable memories (or return an empty array).`;

    return this.distill(systemPrompt, userMessage);
  }

  /**
   * Distill stated preferences/corrections from a client ↔ negotiator chat.
   * @throws When the LLM call times out or returns schema-invalid output.
   */
  async reflectChat(input: ChatReflectionInput): Promise<DistilledMemory[]> {
    const clientName = input.clientUser.name ?? "the client";
    const systemPrompt = CHAT_SYSTEM_PROMPT.replace(/{clientName}/g, clientName);

    const chatText = input.messages
      .map((m, i) => `[${i}] ${m.role === "user" ? clientName : "negotiator"}: ${m.content}`)
      .join("\n");

    const userMessage = `CHAT between ${clientName} and their negotiator (oldest first):
${chatText}

Distill the client's durable guidance (or return an empty array).`;

    return this.distill(systemPrompt, userMessage);
  }

  private async distill(systemPrompt: string, userMessage: string): Promise<DistilledMemory[]> {
    const model = createStructuredModel("negotiationReflector", ReflectionResultSchema, { name: "negotiation_reflector" });

    const result = await this.callModel(model, [
      { role: "system", content: systemPrompt },
      { role: "user", content: userMessage },
    ]);

    const parsed = ReflectionResultSchema.safeParse(result);
    if (!parsed.success) {
      reflectLog.warn("Reflection output failed schema validation", {
        issues: parsed.error.issues.map((i) => i.message).slice(0, 3),
      });
      throw new Error(`Reflection failed validation: ${parsed.error.issues[0]?.message ?? "unknown"}`);
    }
    return parsed.data.memories.slice(0, MAX_DISTILLED_MEMORIES);
  }

  /**
   * Raw structured-model round trip. Split out as a seam so tests can drive
   * the schema-validation path without a live provider.
   */
  protected async callModel(
    model: ReturnType<typeof createStructuredModel>,
    chatMessages: Array<{ role: string; content: string }>,
  ): Promise<unknown> {
    return invokeWithAbortSignal(model, chatMessages, AbortSignal.timeout(this.timeoutMs));
  }
}
