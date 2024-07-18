import { z } from "zod";
import { ChatOpenAI } from "@langchain/openai";

const model = new ChatOpenAI({
  model: "gpt-3.5-turbo",
  temperature: 0,
});

const joke = z.object({
  intent: z
    .string()
    .min(1)
    .max(500)
    .describe(
      "Users' intent, should be self-sufficient, comprehensive description",
    ),

  requestingUpdates: z
    .boolean()
    .describe(
      "Indicates if the user is strongly requesting future updates rather than an immediate answer",
    ),

  intentProbability: z
    .number()
    .int()
    .min(0)
    .max(10)
    .describe(
      "Probability of the intent requiring future updates, on a scale of 0-10",
    ),

  examples: z
    .array(z.string())
    .optional()
    .describe("Examples of phrases indicating a request for updates"),
});

const structuredLlm = model.withStructuredOutput(joke, {
  name: `update_intent`,
});

const x = await structuredLlm.invoke("let me know about semantic stuff");

console.log(x);
