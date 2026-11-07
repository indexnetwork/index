import type { CallToolResult, McpServer } from '@modelcontextprotocol/server';
import { jsonSchema, tool, type JSONSchema7, type ToolSet } from 'ai';
import { z } from 'zod-v4';

import { registerMcpTools } from '../mcp/mcp.tools';
import type { McpPrincipal } from '../mcp/mcp.types';

/** One Index MCP tool as `registerMcpTools` declared it. */
interface RecordedTool {
  name: string;
  description: string;
  inputSchema?: z.ZodType;
  readOnly: boolean;
  handler: (input: unknown) => Promise<CallToolResult> | CallToolResult;
}

/**
 * Collect the Index MCP tools for one owner without running an MCP server.
 * `registerMcpTools` only calls `registerTool`, so a recorder stands in for
 * the server and the home agent gets exactly the MCP surface: same checks,
 * same results, nothing reimplemented.
 *
 * @param principal - The owner every tool acts for.
 * @returns The tools, in registration order.
 */
function recordMcpTools(principal: McpPrincipal): RecordedTool[] {
  const recorded: RecordedTool[] = [];
  const recorder = {
    registerTool(
      name: string,
      config: { description?: string; inputSchema?: z.ZodType; annotations?: { readOnlyHint?: boolean } },
      handler: RecordedTool['handler'],
    ) {
      recorded.push({
        name,
        description: config.description ?? '',
        inputSchema: config.inputSchema,
        readOnly: config.annotations?.readOnlyHint === true,
        handler,
      });
    },
  };
  registerMcpTools(recorder as unknown as McpServer, principal);
  return recorded;
}

/** A tool's input as JSON Schema for the model; anything zod can't express is left open. */
function toJsonSchema(schema?: z.ZodType): JSONSchema7 {
  if (!schema) return { type: 'object', properties: {} };
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: 'input', target: 'draft-7', unrepresentable: 'any' }) as JSONSchema7 & { $schema?: string };
  return rest;
}

/** The text a tool result carries, flagged when the tool reported an error. */
function resultText(result: CallToolResult): string {
  const text = result.content
    .map((part) => (part.type === 'text' ? part.text : ''))
    .filter(Boolean)
    .join('\n\n');
  return result.isError ? `ERROR: ${text}` : text;
}

export interface HomeAgentTools {
  tools: ToolSet;
  /** Names of tools that changed something, in call order. */
  changed: string[];
}

/**
 * The Index MCP tools as AI SDK tools for one owner's home agent.
 *
 * Tools whose description starts "Agent tool" are for scheduled agent work
 * (the MCP instructions say never to call them on a person's request), so the
 * home agent never sees them.
 *
 * @param userId - The signed-in owner.
 * @returns The tool set, and a log of the calls that changed something.
 */
export function homeAgentTools(userId: string): HomeAgentTools {
  const principal: McpPrincipal = { userId, authKind: 'session' };
  const changed: string[] = [];
  const tools: ToolSet = {};
  for (const entry of recordMcpTools(principal)) {
    if (entry.description.startsWith('Agent tool')) continue;
    tools[entry.name] = tool({
      description: entry.description,
      inputSchema: jsonSchema(toJsonSchema(entry.inputSchema)),
      execute: async (raw: unknown) => {
        // The MCP server validates before calling a handler; so does this.
        const parsed = entry.inputSchema ? entry.inputSchema.safeParse(raw ?? {}) : { success: true as const, data: raw ?? {} };
        if (!parsed.success) return `ERROR: invalid input for ${entry.name}: ${parsed.error.message}`;
        const result = await entry.handler(parsed.data);
        if (!entry.readOnly && !result.isError) changed.push(entry.name);
        return resultText(result);
      },
    });
  }
  return { tools, changed };
}
