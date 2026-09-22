/** Authenticated identity available to every Index MCP tool. */
export interface McpPrincipal {
  userId: string;
  authKind: 'api_key' | 'session';
}
