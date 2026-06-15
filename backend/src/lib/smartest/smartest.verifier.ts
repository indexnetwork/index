/**
 * Smartest verifier: schema validation + LLM judge.
 * Model is configurable via SMARTEST_VERIFIER_MODEL (default: Gemini 2.5 Flash for fast runs).
 */

import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { ChatOpenAI } from '@langchain/openai';
import { getSmartestVerifierModel } from './smartest.config';
import type { VerificationResult } from './smartest.types';
import { SMARTEST_VERIFIER_SYSTEM_PROMPT, buildVerifierUserMessage, smartestVerifierOutputSchema } from './smartest.verifier.prompt';

/**
 * Truncate output for LLM verification so large conversation/tool payloads don't blow context.
 * For chat-graph-like output: pass only responseText and error (and minimal metadata) so the
 * verifier judges the actual user-facing reply, not internal tool calls or message history.
 */
export function truncateForVerification(output: unknown): unknown {
  if (output == null || typeof output !== 'object') return output;

  const obj = output as Record<string, unknown>;
  const messages = obj.messages;
  const responseText = obj.responseText;
  const error = obj.error;
  const hasResponseText = typeof responseText === 'string';
  const hasError = typeof error === 'string';

  if (!Array.isArray(messages) || (!hasResponseText && !hasError)) return output;

  // Emphasize what the verifier should judge: the final reply and any error.
  // Omit full messages so the verifier doesn't confuse tool calls with the response.
  const verifierPayload: Record<string, unknown> = {
    responseText: responseText ?? '',
    error: error ?? undefined,
    _note:
      'Chat graph output; messages array omitted. Judge only responseText (and error if present).',
  };
  if (typeof obj.shouldContinue === 'boolean') verifierPayload.shouldContinue = obj.shouldContinue;
  if (typeof obj.iterationCount === 'number') verifierPayload.iterationCount = obj.iterationCount;

  return verifierPayload;
}

/**
 * Run optional schema validation on the output. Returns error message if invalid.
 */
export function runSchemaCheck(
  output: unknown,
  schema: { parse: (v: unknown) => unknown }
): { ok: true } | { ok: false; error: string } {
  try {
    schema.parse(output);
    return { ok: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return { ok: false, error: message };
  }
}

/**
 * Call the LLM verifier and return pass + reasoning.
 * Uses a thinking model (default: Gemini 2.5 Pro). Override via SMARTEST_VERIFIER_MODEL.
 * Truncates large outputs (e.g. chat messages) before verification to avoid timeouts.
 */
export async function runLlmVerifier(
  scenarioDescription: string,
  input: unknown,
  output: unknown,
  criteria: string
): Promise<VerificationResult> {
  const modelId = getSmartestVerifierModel();
  const outputForVerifier = truncateForVerification(output);

  const userContent = buildVerifierUserMessage(
    scenarioDescription,
    input,
    outputForVerifier,
    criteria
  );

  const model = new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: process.env.OPENROUTER_BASE_URL || 'https://openrouter.ai/api/v1',
    },
    temperature: 0.2,
    maxTokens: 1024,
  });

  const structuredModel = model.withStructuredOutput(smartestVerifierOutputSchema, {
    name: 'smartest_verifier',
  });

  const messages = [
    new SystemMessage(SMARTEST_VERIFIER_SYSTEM_PROMPT),
    new HumanMessage(userContent),
  ];

  const parsed = await structuredModel.invoke(messages);

  if (!parsed || typeof parsed.pass !== 'boolean') {
    return {
      pass: false,
      reasoning: 'Verifier did not return a valid { pass, reasoning } object.',
    };
  }

  return {
    pass: parsed.pass,
    reasoning: typeof parsed.reasoning === 'string' ? parsed.reasoning : '',
  };
}
