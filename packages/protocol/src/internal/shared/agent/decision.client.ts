import { getAbortSignalConfig } from "./model-signal.js";

const DECISIONS_URL = "https://openrouter.ai/api/alpha/decisions";
const JEV_MODEL = "typesafe/jev-1.13";
const TIMEOUT_MS = 60_000;

export type DecisionQuestion =
  | { type: "noul"; instructions: string; criteria?: { true: string; false: string } }
  | { type: "choice"; instructions: string; criteria: Record<string, string> }
  | { type: "score"; instructions: string; criteria: string[] };

export type DecisionAnswer =
  | { type: "noul"; noul: number }
  | { type: "choice"; choice: string }
  | { type: "score"; score: number };

/**
 * Jev, through OpenRouter's Decisions API. It returns typed answers, not text.
 * A missing key, a bad response, or a timeout throws. Callers keep their own fallback.
 */
export class DecisionClient {
  constructor(private readonly apiKey?: string, private readonly timeout = TIMEOUT_MS) {}

  /**
   * @param state - The draft and whatever else the questions refer to.
   * @param questions - Named noul, choice, or score questions.
   * @param signal - Cancels this call. A request-scoped signal is used when this is omitted.
   * @returns One answer per question key.
   */
  async decide(
    state: unknown,
    questions: Record<string, DecisionQuestion>,
    signal?: AbortSignal,
  ): Promise<Record<string, DecisionAnswer>> {
    const apiKey = this.apiKey ?? process.env.OPENROUTER_API_KEY;
    if (!apiKey?.trim()) throw new Error("DecisionClient: OPENROUTER_API_KEY is required.");

    const caller = signal ?? getAbortSignalConfig()?.signal;
    const deadline = AbortSignal.timeout(this.timeout);
    const stop = caller ? AbortSignal.any([caller, deadline]) : deadline;
    const response = await fetch(DECISIONS_URL, {
      method: "POST",
      signal: stop,
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: JEV_MODEL, state, questions }),
    });
    const body = await response.text();
    let data: { error?: { message?: string }; answers?: Record<string, { type?: string; noul?: number; choice?: string; score?: number }> } = {};
    try {
      data = JSON.parse(body) as typeof data;
    } catch {
      if (response.ok) throw new Error(`Jev returned a non-JSON response: ${body.slice(0, 500)}`);
    }
    if (!response.ok || data.error || !data.answers) {
      throw new Error(`Jev request failed (${response.status}): ${(data.error?.message ?? body).slice(0, 500)}`);
    }
    return readAnswers(data.answers);
  }
}

function readAnswers(raw: Record<string, { type?: string; noul?: number; choice?: string; score?: number }>): Record<string, DecisionAnswer> {
  const answers: Record<string, DecisionAnswer> = {};
  for (const [key, answer] of Object.entries(raw)) {
    if (answer?.type === "noul" && typeof answer.noul === "number") answers[key] = { type: "noul", noul: answer.noul };
    else if (answer?.type === "choice" && typeof answer.choice === "string") answers[key] = { type: "choice", choice: answer.choice };
    else if (answer?.type === "score" && typeof answer.score === "number") answers[key] = { type: "score", score: answer.score };
    else throw new Error(`Jev answer "${key}" was unusable`);
  }
  return answers;
}
