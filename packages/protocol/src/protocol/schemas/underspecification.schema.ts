import { z } from "zod";

/**
 * Canonical QUD repair categories for underspecified intents/questions.
 *
 * Shared between signals (the intent clarifier decides whether an utterance is
 * underspecified) and questions (which records the category on the question it
 * raises). It lives here rather than inside either capability because both need
 * it: filing it under `questions/` meant the signals clarifier had to
 * import the whole questions capability — LLM agents and tools included — to
 * reach a three-value enum.
 */
export const UnderspecificationTypeSchema = z.enum([
  "missing_constituent",
  "missing_constraint",
  "open_alternative_set",
]);

export type UnderspecificationType = z.infer<typeof UnderspecificationTypeSchema>;
