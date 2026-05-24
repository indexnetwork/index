/**
 * Mode presets for the QuestionerAgent. Each preset provides a system prompt
 * and a buildPrompt function that assembles the user message from a typed
 * context object. Only the `discovery` preset ships in Slice 1; others throw
 * until their implementation slices land.
 */
import type { QuestionMode } from "../shared/schemas/question.schema.js";
import {
  SYSTEM_PROMPT as DISCOVERY_SYSTEM_PROMPT,
  buildQuestionPrompt as buildDiscoveryPrompt,
} from "../opportunity/question.prompt.js";

export interface QuestionerPreset {
  /** The LLM system prompt for this mode. */
  systemPrompt: string;
  /** Builds the user-message string from the mode-specific context. */
  buildPrompt: (context: unknown) => string;
}

const presets: Partial<Record<QuestionMode, QuestionerPreset>> = {
  discovery: {
    systemPrompt: DISCOVERY_SYSTEM_PROMPT,
    buildPrompt: (context: unknown) =>
      buildDiscoveryPrompt(context as Parameters<typeof buildDiscoveryPrompt>[0]),
  },
};

/**
 * Retrieve the preset for the given mode.
 * @param mode - The question mode to look up.
 * @returns The matching preset with systemPrompt and buildPrompt.
 * @throws Error if the mode's preset is not yet implemented.
 */
export function getPreset(mode: QuestionMode): QuestionerPreset {
  const preset = presets[mode];
  if (!preset) {
    throw new Error(`QuestionerAgent preset "${mode}" is not implemented yet`);
  }
  return preset;
}
