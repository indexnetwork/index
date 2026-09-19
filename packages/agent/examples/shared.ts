/**
 * Helpers for the low-level ModelLoop examples, not the public Agent API.
 * These make real OpenRouter calls — set OPENROUTER_API_KEY before running.
 */
import type { ModelLoop, RunOptions } from "../src/core/model.loop.ts";
import type { RunResult, Step } from "../src/index.ts";

/** Prints one step of a model loop run. */
export function logStep(step: Step): void {
  if (step.kind === "message") {
    console.log(`\n${step.content}`);
    return;
  }
  if (step.kind === "ask") {
    console.log(`  ? ${step.question}${step.options ? ` [${step.options.join(" / ")}]` : ""}`);
    return;
  }
  const outcome = step.error ? `error: ${step.error}` : JSON.stringify(step.output);
  console.log(`  · ${step.name}(${JSON.stringify(step.input)}) -> ${truncate(outcome)}`);
}

function truncate(text: string, max = 140): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

/**
 * The host's side of a conversation: whenever the run stops to ask, hand it
 * the next scripted answer and resume. In production the answer comes from
 * a chat message, a push notification, a form — whatever channel the host
 * has to the user, seconds or days later.
 *
 * Nothing is held open between the two runs. `messages` is the whole
 * state — persist it and resume tomorrow if you like.
 */
export async function answerUntilDone(
  loop: ModelLoop,
  result: RunResult,
  answers: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  let asked = 0;
  while (result.end === "needs-input" && asked < answers.length) {
    const answer = answers[asked++]!;
    console.log(`  > ${answer}\n`);
    result = await loop.run(answer, { ...options, messages: result.messages });
  }
  return result;
}
