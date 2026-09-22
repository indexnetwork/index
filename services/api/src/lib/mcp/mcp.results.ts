import type { CallToolResult } from '@modelcontextprotocol/server';

import { log } from '../log';
import { captureAppException } from '../sentry';

import type { McpPrincipal } from './mcp.types';

const logger = log.server.from('mcp');

type JsonObject = Record<string, unknown>;

/** Return one successful MCP tool result as JSON text. */
export function mcpSuccess(result: JsonObject = {}): CallToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ success: true, ...result }) }],
  };
}

/** Return one expected domain failure as JSON text. */
export function mcpError(code: string, error: string, details: JsonObject = {}): CallToolResult {
  return {
    isError: true,
    content: [{ type: 'text', text: JSON.stringify({ success: false, code, error, ...details }) }],
  };
}

/** Capture an unexpected tool failure without exposing its details to the caller. */
export function captureMcpToolFailure(
  error: unknown,
  tool: string,
  principal: McpPrincipal,
): CallToolResult {
  logger.error('MCP tool failed', {
    tool,
    userId: principal.userId,
    error: error instanceof Error ? error.message : String(error),
  });
  captureAppException(error, {
    subsystem: 'mcp',
    operation: 'mcp.tool',
    tags: { tool },
    userId: principal.userId,
  });
  return mcpError('internal_error', 'The tool could not complete the request.');
}
