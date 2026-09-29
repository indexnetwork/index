import type { CallToolResult } from '@modelcontextprotocol/server';

import { log } from '../log';
import { captureAppException } from '../sentry';

import type { McpPrincipal } from './mcp.types';

const logger = log.server.from('mcp');

type JsonObject = Record<string, unknown>;

/**
 * Return one successful MCP tool result as JSON text, led by an optional
 * markdown summary. Models copy links they can read far more reliably than
 * they assemble them from JSON fields, so entity names arrive pre-linked.
 */
export function mcpSuccess(result: JsonObject = {}, summary?: string): CallToolResult {
  const json = { type: 'text' as const, text: JSON.stringify({ success: true, ...result }) };
  return {
    content: summary ? [{ type: 'text', text: summary }, json] : [json],
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
