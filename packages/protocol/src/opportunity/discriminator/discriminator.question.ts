/**
 * Deterministic pool_discovery question synthesis (IND-418).
 *
 * A mined discriminator already carries everything a question needs: a label,
 * a question seed, 2–3 sides, and verified per-candidate assignments. This
 * module turns the top discriminator into a `Question` payload + server-side
 * pool snapshot with ZERO generation-time LLM calls — the phrasing was
 * produced (and evidence-verified) at mining time, so synthesis is pure,
 * auditable, and cheap to re-run for interview-mode chaining.
 */
import type { Question, QuestionOption, QuestionPoolDiscriminator, QuestionPoolSnapshot } from "../../shared/schemas/question.schema.js";
import { POOL_DISCRIMINATOR_MIN_POOL_SIZE, POOL_QUESTION_MAX_DISCRIMINATORS, POOL_QUESTION_MIN_EVIDENCE_RATE, POOL_QUESTION_MIN_VOI } from "./discriminator.env.js";
import type { ScoredDiscriminator } from "./discriminator.types.js";

/** Fixed option appended to every pool question — the no-preference escape. */
export const BOTH_MATTER_LABEL = "Both matter";

/** Max words in a chip-style option label (prototype voice: terse, glanceable). */
const MAX_LABEL_WORDS = 5;

/** Question title (≤12 chars, per QuestionSchema). */
const POOL_QUESTION_TITLE = "Matches";

/**
 * Converts a scored discriminator into the compact snapshot form stored on
 * the question row (verified assignments only; unknowns dropped).
 */
export function toQuestionDiscriminator(d: ScoredDiscriminator): QuestionPoolDiscriminator {
  const sideCounts: Record<string, number> = {};
  for (const side of d.sides) sideCounts[side] = 0;
  const assignments: Array<{ opportunityId: string; side: string }> = [];
  for (const a of d.assignments) {
    if (a.side === null || !a.verified) continue;
    if (!(a.side in sideCounts)) continue;
    sideCounts[a.side] += 1;
    assignments.push({ opportunityId: a.id, side: a.side });
  }
  return {
    label: d.label,
    questionSeed: d.questionSeed,
    sides: d.sides,
    sideCounts,
    voi: d.voi,
    evidenceRate: d.evidenceRate,
    ...(d.embedding ? { embedding: d.embedding } : {}),
    ...(d.embeddingModel ? { embeddingModel: d.embeddingModel } : {}),
    assignments,
  };
}

/**
 * Filters a mining pass down to question-eligible discriminators:
 * VoI ≥ {@link POOL_QUESTION_MIN_VOI}, evidenceRate ≥
 * {@link POOL_QUESTION_MIN_EVIDENCE_RATE}, capped at
 * {@link POOL_QUESTION_MAX_DISCRIMINATORS}. Input is already VoI-sorted.
 */
export function selectQuestionDiscriminators(discriminators: ScoredDiscriminator[]): ScoredDiscriminator[] {
  return discriminators
    .filter((d) => d.voi >= POOL_QUESTION_MIN_VOI && d.evidenceRate >= POOL_QUESTION_MIN_EVIDENCE_RATE)
    .slice(0, POOL_QUESTION_MAX_DISCRIMINATORS);
}

/** Truncates a side label to the chip word budget. */
function chipLabel(side: string): string {
  const words = side.trim().split(/\s+/);
  return words.slice(0, MAX_LABEL_WORDS).join(" ");
}

/**
 * Miner seeds are sometimes written from the intent owner's POV ("Do I
 * prefer…"). The question is asked TO the owner, so normalize to second
 * person. Conservative verb-pair map + bare pronoun/possessive swaps.
 */
function toSecondPerson(seed: string): string {
  return seed
    .replace(/\b(do|should|would|could|can|will) I\b/gi, (_, verb: string) => `${verb.toLowerCase()} you`)
    .replace(/\bam I\b/gi, "are you")
    .replace(/\bI\b/g, "you")
    .replace(/\bmy\b/gi, "your")
    // Third-person seeds ("Is the user primarily involved…") — the question is
    // asked TO the owner, never ABOUT them.
    .replace(/\b(is|was) (?:the|this) (user|owner|discoverer|client)\b/gi, "are you")
    .replace(/\bdoes (?:the|this) (user|owner|discoverer|client)\b/gi, "do you")
    .replace(/\b(?:the|this) (user|owner|discoverer|client)'s\b/gi, "your")
    .replace(/\b(?:the|this) (user|owner|discoverer|client)\b/gi, "you");
}

/**
 * Catch-all: after normalization the prompt must be second-person. Any
 * residual third-person reference to the owner means an unanticipated seed
 * shape slipped through — the deterministic two-sided template (always
 * second-person) is the safe fallback.
 */
function isStillThirdPerson(prompt: string): boolean {
  return /\b(?:the|this|a) (?:user|owner|discoverer|client)\b/i.test(prompt);
}

/**
 * A good discriminator prompt names BOTH sides so the chips read as a real
 * choice. When the seed mentions fewer than two sides (e.g. "Do you prefer
 * hands-on prototyping?"), fall back to a deterministic two-sided template.
 */
function mentionsSide(seed: string, side: string): boolean {
  const lowerSeed = seed.toLowerCase();
  return side
    .toLowerCase()
    .split(/[^a-z0-9-]+/)
    .filter((w) => w.length > 3)
    .some((w) => lowerSeed.includes(w));
}

/** Ensures the prompt reads as one second-person, two-sided question. */
function toPrompt(questionSeed: string, sides: string[]): string {
  let p = toSecondPerson(questionSeed.trim().replace(/\s+/g, " "));
  const sidesMentioned = sides.filter((s) => mentionsSide(p, s)).length;
  if (sidesMentioned < 2 || isStillThirdPerson(p)) {
    const last = sides[sides.length - 1];
    const head = sides.slice(0, -1).join(", ");
    p = `Which matters more here: ${head} or ${last}`;
  }
  // Sentence-case the first character (template + normalization can lowercase it).
  p = p.charAt(0).toUpperCase() + p.slice(1);
  if (!/[?]$/.test(p)) p = p.replace(/[.!]+$/, "") + "?";
  return p.slice(0, 400);
}

/** Input for one question synthesis. */
export interface SynthesizePoolQuestionInput {
  /** The discriminator to ask about (already eligibility-filtered). */
  discriminator: QuestionPoolDiscriminator;
  /** Remaining ranked eligible discriminators (interview-mode chain stash). */
  alternates: QuestionPoolDiscriminator[];
  poolSize: number;
  /** Exact bounded candidate opportunity IDs supplied to this synthesis pass. */
  opportunityIds: string[];
  /** ISO-8601 timestamp of the mining pass. */
  minedAt: string;
  /** Discovery run id, when known. */
  runId?: string;
  /**
   * Intent payload snippet — folded into the evidence chip so the question
   * self-identifies on any surface ("based on 16 people matching ‘…’").
   */
  intentText?: string;
  /** Stable hash of the full normalized intent payload + summary. */
  intentFingerprint?: string;
}

/** Synthesized question: client payload + server-side snapshot. */
export interface SynthesizedPoolQuestion {
  payload: Question;
  pool: QuestionPoolSnapshot;
}

/**
 * Builds the pool_discovery question. Returns null when the pool is below
 * the k-anonymity floor or the discriminator shape is unusable (guards are
 * duplicated here so no caller can bypass them).
 */
export function synthesizePoolQuestion(input: SynthesizePoolQuestionInput): SynthesizedPoolQuestion | null {
  const { discriminator: d, poolSize } = input;
  if (poolSize < POOL_DISCRIMINATOR_MIN_POOL_SIZE) return null;
  if (d.sides.length < 2 || d.sides.length > 3) return null;

  // Evidence chip: aggregate count + the intent it belongs to, so the card is
  // self-identifying on every surface (QuestionSchema caps evidence at 160).
  const snippet = input.intentText?.trim().replace(/\s+/g, " ") ?? "";
  const evidence = snippet.length > 0
    ? `based on ${poolSize} people matching “${snippet.slice(0, 110)}${snippet.length > 110 ? "…" : ""}”`
    : `based on ${poolSize} people matching this intent`;

  const sideOptions: QuestionOption[] = d.sides.map((side) => ({
    label: chipLabel(side),
    description: `${d.sideCounts[side] ?? 0} of your ${poolSize} current matches lean this way`,
  }));
  const options: QuestionOption[] = [
    ...sideOptions,
    {
      label: BOTH_MATTER_LABEL,
      description: "No preference — keep the current ranking",
    },
  ];

  return {
    payload: {
      title: POOL_QUESTION_TITLE,
      prompt: toPrompt(d.questionSeed, d.sides),
      options,
      multiSelect: false,
      evidence,
    },
    pool: {
      poolSize,
      opportunityIds: [...input.opportunityIds],
      minedAt: input.minedAt,
      ...(input.runId ? { runId: input.runId } : {}),
      ...(snippet.length > 0 ? { intentText: snippet.slice(0, 160) } : {}),
      ...(input.intentFingerprint ? { intentFingerprint: input.intentFingerprint } : {}),
      discriminator: d,
      alternates: input.alternates,
    },
  };
}
