/**
 * Shared helpers for the examples/ scripts. These make real OpenRouter
 * calls through `Negotiator` — set OPENROUTER_API_KEY before running them.
 * Every run is capped at MAX_TURNS, since a live model isn't guaranteed to
 * reach a terminal action on its own.
 */
import type { Agent, AgentTurn, Negotiation, RunOptions, RunResult, Step } from "../src/index.ts";

export const MAX_TURNS = 6;

export function logTurn(speaker: string, turn: AgentTurn): void {
  console.log(`[${speaker}] (${turn.decision.action}) ${turn.decision.message}`);
}

/** Prints how a negotiation ended, in the terms this package reports it. */
export function logOutcome(negotiation: Negotiation): void {
  const by = negotiation.endedBy
    ? `${negotiation.endedBy.speaker} took "${negotiation.endedBy.action}"`
    : "nobody took a terminal action";

  console.log(`\n— ended: ${negotiation.end} (${by})`);
  console.log(`  shared task state: ${negotiation.state}`);
}

/** Prints one step of an agent run. */
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
 * Nothing is held open between the two runs. `messages` and `negotiations`
 * are the whole state — persist them and resume tomorrow if you like.
 */
export async function answerUntilDone(
  agent: Agent,
  result: RunResult,
  answers: string[],
  options: RunOptions = {},
): Promise<RunResult> {
  let asked = 0;
  while (result.end === "needs-input" && asked < answers.length) {
    const answer = answers[asked++]!;
    console.log(`  > ${answer}\n`);
    result = await agent.run(answer, { ...options, messages: result.messages, negotiations: result.negotiations });
  }
  return result;
}

/** Serves an agent handler on an ephemeral local port. */
export function serve(fetch: (request: Request) => Promise<Response>) {
  const server = Bun.serve({ port: 0, fetch });
  return { url: server.url.toString(), stop: () => server.stop(true) };
}
