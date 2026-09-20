import type { Tool } from "./reasoning.tool.js";

/**
 * Agent-prepared input for one bounded reasoning/tool run.
 * Operation metadata identifies work without parsing prompts; external executors
 * must keep principal briefing history separate from A2A negotiation history.
 */
export type ExecutionInput = {
  /** Prepared role/rules, human-principal relationship, current intent, and UTC date. */
  instructions: string;
  /** The current task and its relevant context, prepared by the agent. */
  prompt: string;
  /** Permitted handlers through which the agent collects its domain outputs. */
  tools: Tool[];
  /** Agent-owned cap on model responses, each followed by its requested tool calls. */
  maxSteps: number;
  /** Runner-owned cooperative cancellation; persisted effects are not rolled back. */
  abortSignal: AbortSignal;
  principalId: string;
  intentId: string;
} & (
  | { operation: "wake"; opportunityId?: never }
  | { operation: "brief"; opportunityId: string }
  | { operation: "negotiate"; opportunityId: string }
);

/**
 * Executes a whole reasoning/tool run, not a single model completion.
 *
 * Implementations await each response's tool calls sequentially in their returned
 * order. Execution ends when a response requests no tools or maxSteps is spent.
 * Unknown tools, invalid JSON arguments, and ordinary handler errors become tool
 * feedback within the remaining budget, without automatic retries or extra steps.
 * Observed cancellation takes precedence over ordinary tool-error feedback.
 *
 * @param input - Prepared instructions, task context, tools, budget, cancellation, and work identity.
 * @returns Resolves without a domain result; the agent retains outputs collected through its handlers.
 * @throws If a model request fails or cancellation is observed.
 */
export type Execute = (input: ExecutionInput) => Promise<void>;
