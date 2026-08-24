import { ChatOpenAI } from "@langchain/openai";
import { HumanMessage, SystemMessage } from "@langchain/core/messages";
import { z } from "zod";

const JUDGE_SYSTEM_PROMPT = `You are a test oracle for an AI system. Given the output of a system under test and evaluation criteria, determine whether the output passes or fails.

Return JSON with two fields:
- pass: true if the output satisfies the criteria, false otherwise
- reasoning: concise explanation of your judgment (1-3 sentences)`;

const judgeOutputSchema = z.object({
  pass: z.boolean(),
  reasoning: z.string(),
});

/**
 * Assert that `output` satisfies the given `criteria` according to an LLM judge.
 * Throws an error (with reasoning embedded) if the assertion fails.
 * Uses google/gemini-3.7-flash.
 *
 * @param output - The value produced by the system under test.
 * @param criteria - Natural language description of what the output must satisfy.
 * @throws {Error} If the LLM judge determines the output does not meet the criteria.
 */
export async function assertLLM(output: unknown, criteria: string): Promise<void> {
  const modelId = "google/gemini-3.7-flash";

  const model = new ChatOpenAI({
    model: modelId,
    apiKey: process.env.OPENROUTER_API_KEY!,
    configuration: {
      baseURL: "https://openrouter.ai/api/v1",
    },
    temperature: 0,
    maxTokens: 512,
  });

  const structured = model.withStructuredOutput(judgeOutputSchema, { name: "llm_judge" });

  const userMessage = `Output:\n${JSON.stringify(output, null, 2)}\n\nCriteria:\n${criteria}`;

  const result = await structured.invoke([
    new SystemMessage(JUDGE_SYSTEM_PROMPT),
    new HumanMessage(userMessage),
  ]);

  if (!result.pass) {
    throw new Error(`LLM assertion failed: ${result.reasoning}`);
  }
}
