import type { ModelMessage } from "./model.ts";

// --- identity and intent ---------------------------------------------

/**
 * Who this agent acts for. One identity per agent, and it stays the same
 * across every intent scope — the intent narrows what the agent is working
 * on, never who it is.
 */
export interface AgentIdentity {
  /** Display name, used as the party name the agent speaks under. */
  name: string;
  /** Stable identifier for the party this agent acts for — a DID, a
   * profile URL, an account id. */
  id: string;
  description?: string;
}

/** What the agent is currently working on. Scoping an agent to one narrows
 * its context; it doesn't create a different agent. */
export interface Intent {
  id?: string;
  statement: string;
}

// --- the agent loop --------------------------------------------------

/** One thing that happened during a run. A tool step carries `output` or
 * `error`, never both. */
export type Step =
  | { kind: "message"; content: string }
  | { kind: "tool"; name: string; input: unknown; output?: unknown; error?: string }
  | { kind: "ask"; question: string; options?: string[] };

/** Why a run stopped. */
export type RunEnd =
  /** The model answered with text instead of another tool call. */
  | "done"
  /** The agent needs the user to answer something before it can continue.
   * See `pending`; resume by passing the answer to the next `run()`. */
  | "needs-input"
  /** `maxSteps` was spent while the model was still working. */
  | "max-steps";

export interface PendingQuestion {
  question: string;
  /** Suggested answers, when the agent offered a choice rather than an
   * open question. */
  options?: string[];
}

/**
 * Where this agent's conversation with its party is recorded.
 *
 * There's one conversation per agent instance, not many keyed by id — the
 * agent holds no state itself, so this is the host's, and defaults to an
 * in-memory store. Swap it for something shared and an agent picks a
 * suspended conversation back up after a restart, or from another process.
 */
export interface MessageStore {
  /** The conversation so far, including the system message once a run has
   * produced one. Empty before the first run. */
  list(): ModelMessage[];
  /** Replaces the stored transcript with a run's full result. */
  save(messages: ModelMessage[]): void;
}

export interface RunResult {
  /** The agent's final text. Empty if it never produced any. */
  output: string;
  steps: Step[];
  end: RunEnd;
  /** Set when `end` is "needs-input": what the agent needs to know. */
  pending?: PendingQuestion;
  /** The full transcript, including the system message. Pass it back as
   * `messages` to continue — that's how a suspended run resumes. A host
   * with a shared `MessageStore` can rely on that instead: `run()` already
   * saved this same array there. */
  messages: ModelMessage[];
}
