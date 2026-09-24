import type { ToolDefinition } from "./model.ts";

/**
 * One capability a run may call. `parameters` is JSON Schema, handed to the
 * model verbatim, so it is the only thing telling the model how to call this.
 */
export interface Tool<I = Record<string, unknown>> {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
  run: (input: I) => unknown | Promise<unknown>;
}

/**
 * Keep a tool's own argument type while collecting it into a run's
 * `Tool<never>[]`, so each handler reads its arguments without a cast.
 *
 * @param definition - One tool, typed by its arguments.
 * @returns The same tool, as a run takes them.
 */
export function tool<I>(definition: Tool<I>): Tool<never> {
  return definition;
}

/** @param tool - One tool. @returns Its declaration for the model. */
export function toolDefinition(tool: Tool<never>): ToolDefinition {
  return {
    type: "function",
    function: { name: tool.name, description: tool.description, parameters: tool.parameters },
  };
}
