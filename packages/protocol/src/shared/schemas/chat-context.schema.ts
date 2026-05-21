/**
 * ChatContextDigest — distilled view of a chat session used as anti-duplication
 * input for the decision-question generator. Each field is bounded so the
 * digest stays compact even as sessions grow.
 */
import { z } from "zod";

/** Per-entry character cap. Mirrors the summarizer prompt's "≤140 chars" rule. */
const ENTRY_MAX_CHARS = 140;
const entry = z.string().max(ENTRY_MAX_CHARS);

export const ChatContextDigestSchema = z.object({
  /** Facts the user volunteered (stage, location, role, timing, scope, …). */
  statedFacts: z.array(entry).max(20),
  /** Questions the assistant asked that the user has not yet answered. */
  openQuestions: z.array(entry).max(10),
  /** User pushback / negative signals on prior cards. */
  rejectionReasons: z.array(entry).max(10),
  /** Facts the assistant has already surfaced from prior negotiation turns. */
  surfacedFindings: z.array(entry).max(20),
});

export type ChatContextDigest = z.infer<typeof ChatContextDigestSchema>;
