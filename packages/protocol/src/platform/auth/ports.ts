import type { McpAuthInput, McpResolvedIdentity } from './mcp.js';

/**
 * Resolves the authenticated MCP identity from an auth input DTO.
 * The DTO is extracted from the transport at the edge (e.g. from HTTP Request
 * headers) before the protocol layer is called. New auth paths stay free of
 * platform-specific `Request` coupling; `resolveUserId` remains only as a
 * deprecated compatibility bridge while callers migrate to `resolveIdentity`.
 */
export interface McpAuthResolver {
  /**
   * Extracts and validates the authenticated identity from the auth input.
   *
   * @param input - Transport-neutral auth input DTO with credential fields
   *   extracted at the MCP transport edge.
   * @returns The authenticated user's UUID and the auth method. A key names a
   *   user and nothing else: there is no agent or network binding to read off
   *   it.
   *
   *   `isSessionAuth` is true for OAuth/JWT bearer sessions, which are the only
   *   callers allowed the owner-control and agent-admin tools.
   *
   * @throws Error if authentication fails (no token, invalid token, etc.)
   */
  resolveIdentity(input: McpAuthInput): Promise<McpResolvedIdentity>;

  /**
   * Deprecated HTTP Request bridge retained for compatibility with older
   * callers. New transport code must extract `McpAuthInput` at the edge and
   * call `resolveIdentity` instead.
   *
   * @deprecated Use resolveIdentity instead.
   */
  resolveUserId(request: Request): Promise<string>;
}
