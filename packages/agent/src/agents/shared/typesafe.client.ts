const TYPESAFE_URL = "https://api.typesafe.ai/v1/systemone";
const DEFAULT_MODEL = "jev-latest";
const DEFAULT_TIMEOUT = 120_000;

/** Text or structured input sent to TypeSafe. */
export type TypeSafeContent = string | Record<string, unknown> | readonly unknown[];

/** One typed question evaluated independently against the request's state. */
export type TypeSafeQuestion = { instructions: TypeSafeContent } & (
  | { type: "choice"; criteria: Record<string, TypeSafeContent | null> }
  | { type: "score"; criteria: readonly TypeSafeContent[] }
  | { type: "noul"; criteria?: { true?: TypeSafeContent; false?: TypeSafeContent } }
);

/** An answer narrowed to its question type and, for Choice, its supplied options. */
export type TypeSafeAnswer<Question extends TypeSafeQuestion = TypeSafeQuestion> =
  Question extends { type: "choice"; criteria: infer Criteria }
    ? {
      type: "choice";
      choice: keyof Criteria & string;
      probabilities: Record<keyof Criteria & string, number>;
      confidence: number;
    }
    : Question extends { type: "score" }
      ? {
        type: "score";
        score: number;
        legend: Record<string, string>;
        probabilities: Record<string, number>;
        confidence: number;
      }
      : { type: "noul"; noul: number };

/** Typed answers keyed by the request's question names, with model and usage metadata. */
export interface TypeSafeResponse<Questions extends Record<string, TypeSafeQuestion> = Record<string, TypeSafeQuestion>> {
  model: string;
  answers: { [Name in keyof Questions]: TypeSafeAnswer<Questions[Name]> };
  usage: { input_tokens: number; output_tokens: number };
}

/** Host-supplied credentials and settings for direct decision requests. */
export interface TypeSafeClientOptions {
  apiKey: string;
  /** TypeSafe model ID. Defaults to jev-latest. */
  model?: string;
  /** Maximum duration of one request, including its response body, in milliseconds. */
  timeout?: number;
}

/** TypeSafe decision access without reasoning policy, environment reads, or automatic retries. */
export class TypeSafeClient {
  private readonly apiKey: string;
  private readonly model: string;
  private readonly timeout: number;

  /**
   * Configures model access without making a request.
   * @param options - Required credential, optional model ID, and per-request timeout.
   * @throws When the API key or model ID is blank.
   */
  constructor(options: TypeSafeClientOptions) {
    if (!options.apiKey?.trim()) throw new Error("TypeSafe API key missing. Pass `apiKey`.");
    this.apiKey = options.apiKey;
    this.model = options.model ?? DEFAULT_MODEL;
    if (!this.model.trim()) throw new Error("Provide a nonempty TypeSafe model ID.");
    this.timeout = options.timeout ?? DEFAULT_TIMEOUT;
  }

  /**
   * Evaluates all supplied questions in one request against the same state.
   * @param state - Text or structured context for the questions.
   * @param questions - Named Choice, Score, or Noul questions with their instructions and criteria.
   * @param abortSignal - Runner-owned cancellation, combined with the request deadline.
   * @returns Typed answers, the model that evaluated them, and token usage.
   * @throws On cancellation, timeout, network failure, or an unsuccessful or unusable response.
   */
  async evaluate<const Questions extends Record<string, TypeSafeQuestion>>(
    state: TypeSafeContent,
    questions: Questions,
    abortSignal: AbortSignal,
  ): Promise<TypeSafeResponse<Questions>> {
    abortSignal.throwIfAborted();
    const stop = AbortSignal.any([abortSignal, AbortSignal.timeout(this.timeout)]);

    const response = await fetch(TYPESAFE_URL, {
      method: "POST",
      signal: stop,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: this.model, state, questions }),
    });
    stop.throwIfAborted();
    const body = await response.text();
    stop.throwIfAborted();

    if (!response.ok) throw new Error(`TypeSafe request failed (${response.status}): ${body.slice(0, 500)}`);

    let data: TypeSafeResponse<Questions> | null;
    try {
      data = JSON.parse(body) as TypeSafeResponse<Questions> | null;
    } catch {
      throw new Error(`TypeSafe returned a non-JSON response: ${body.slice(0, 500)}`);
    }
    if (!data?.answers || Object.keys(questions).some((name) => !data.answers[name])) {
      throw new Error("TypeSafe response was missing answers.");
    }

    return data;
  }
}
