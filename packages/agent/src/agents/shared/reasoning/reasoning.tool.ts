/** A permitted capability whose handler is owned by the reasoning agent. */
export interface Tool<Input = unknown> {
  name: string;
  description: string;
  /** JSON Schema supplied to the model, not a runtime validator. */
  parameters: Record<string, unknown>;
  /**
   * @param input - Parsed JSON arguments; domain-specific validation belongs to the handler.
   * @returns Model feedback: strings pass through, other values are JSON-serialized, and no value becomes null.
   * @throws On handler failure; ordinary errors become tool feedback unless execution was cancelled.
   */
  run: (input: Input) => unknown | Promise<unknown>;
}

/**
 * Exposes a tool-specific handler through the unknown-input execution boundary.
 * The assertion does not validate arguments; handlers retain their existing checks.
 * @param definition - Tool metadata and a handler with its own argument type.
 * @returns A tool that executors can invoke with parsed JSON arguments.
 */
export function defineTool<Input>(definition: Tool<Input>): Tool {
  return {
    ...definition,
    run: (input) => definition.run(input as Input),
  };
}
