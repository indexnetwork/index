import type { DistilledMemoryKind } from "./negotiation.reflect.js";

// ═══════════════════════════════════════════════════════════════════════════════
// NEGOTIATOR MEMORY INJECTION (P5.3 — read path)
// ═══════════════════════════════════════════════════════════════════════════════
//
// Pure prompt-side counterpart of the P5.2 write path: retrieved
// `negotiator_memories` rows shape how the negotiator screens, argues, and
// chats. Retrieval itself lives in services/api (the protocol package has no
// DB access) and is injected via `NegotiatorMemoryRetrieveFn` — the same
// composition-root pattern as `questionerEnqueue`/`reflectEnqueue`.
//
// Contract: when the entry list is empty (memory empty, flag off, retrieval
// failed) every renderer returns the empty string, so prompts are
// byte-identical to the pre-P5.3 build.

/**
 * A single memory entry as injected into prompts. A projection of the
 * `negotiator_memories` row: content + kind + confidence only — ids,
 * embeddings, and provenance never enter the prompt.
 */
export interface NegotiatorMemoryEntry {
  kind: DistilledMemoryKind;
  content: string;
  /** Anti-poisoning weight (0..1); rendered so the model can weigh hints. */
  confidence?: number;
}

/** Where a retrieval is happening — lets the read service tune top-k/scope. */
export type NegotiatorMemoryScope = "screen" | "turn";

/** Query the graph hands to the injected retrieval function. */
export interface NegotiatorMemoryQuery {
  /** The user whose negotiator's own memory is being retrieved. */
  userId: string;
  /** The other side of this negotiation (dossier subject). */
  counterpartyUserId: string;
  /** Free-text similarity query (seed reasoning + counterparty context). */
  queryText: string;
  scope: NegotiatorMemoryScope;
}

/**
 * Injected retrieval seam (services/api implements it over the
 * `negotiator_memories` store). MUST resolve to `[]` on any failure or when
 * `NEGOTIATOR_MEMORY_INJECT` is off — memory must never break a negotiation.
 */
export type NegotiatorMemoryRetrieveFn = (
  query: NegotiatorMemoryQuery,
) => Promise<NegotiatorMemoryEntry[]>;

const KIND_LABELS: Record<DistilledMemoryKind, string> = {
  playbook: "playbook",
  disclosure_rule: "disclosure rule",
  counterparty_dossier: "counterparty note",
  threshold: "threshold",
};

function confidenceSuffix(entry: NegotiatorMemoryEntry): string {
  return typeof entry.confidence === "number"
    ? ` (confidence ${Math.round(entry.confidence * 100) / 100})`
    : "";
}

export interface RenderNegotiatorMemoryOptions {
  /**
   * When true (screen node), instructs the model to reflect memory influence
   * into `evidence.memoryHints` — without copying sensitive text verbatim.
   */
  memoryHintsInstruction?: boolean;
}

/**
 * Renders the private negotiator-memory section for counterparty-facing
 * prompts (the negotiation turn agent and the screen gate).
 *
 * Disclosure rules are HARD constraints — never soft hints; everything else
 * is advisory, weighted by confidence. The section leads with the leak
 * guard: memory text must never reach counterparty-visible fields.
 *
 * @returns Empty string when there are no entries (byte-identical prompts).
 */
export function renderNegotiatorMemorySection(
  entries: NegotiatorMemoryEntry[],
  opts?: RenderNegotiatorMemoryOptions,
): string {
  if (entries.length === 0) return "";

  const disclosureRules = entries.filter((e) => e.kind === "disclosure_rule");
  const advisory = entries.filter((e) => e.kind !== "disclosure_rule");

  const lines: string[] = [
    "",
    "",
    "PRIVATE NEGOTIATOR MEMORY — for your reasoning only. Never quote, paraphrase, or reveal any of it to the counterparty, and never mention that these notes exist.",
  ];

  if (disclosureRules.length > 0) {
    lines.push("HARD DISCLOSURE CONSTRAINTS (absolute — these override every other goal, including reaching a deal):");
    for (const rule of disclosureRules) {
      lines.push(`- ${rule.content}`);
    }
  }

  if (advisory.length > 0) {
    lines.push("Advisory notes from prior negotiations and client conversations (weigh by confidence; the live context wins on conflict):");
    for (const entry of advisory) {
      lines.push(`- [${KIND_LABELS[entry.kind]}] ${entry.content}${confidenceSuffix(entry)}`);
    }
  }

  if (opts?.memoryHintsInstruction) {
    lines.push("Set evidence.memoryHints to a short note on how these memories informed your decision — describe the influence, never copy sensitive contents verbatim.");
  }

  return lines.join("\n");
}

/**
 * Renders the memory section for the negotiator CHAT persona — the audience
 * is the client themself, so disclosure rules are their own standing
 * instructions (context, not secrets), and the client's live word always
 * outranks a stored note.
 *
 * @returns Empty string when there are no entries (byte-identical prompts).
 */
export function renderNegotiatorChatMemorySection(entries: NegotiatorMemoryEntry[]): string {
  if (entries.length === 0) return "";

  const lines: string[] = [
    "",
    "## Your negotiator memory",
    "Notes you have accumulated from negotiations and prior conversations with your client (private to the two of you; weigh by confidence):",
  ];
  for (const entry of entries) {
    lines.push(`- [${KIND_LABELS[entry.kind]}] ${entry.content}${confidenceSuffix(entry)}`);
  }
  lines.push("Use these to inform reports and recommendations. If the client contradicts one, trust the client — their current word always outranks a stored note.");

  return lines.join("\n");
}
