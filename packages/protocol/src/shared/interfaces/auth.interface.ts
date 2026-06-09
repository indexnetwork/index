import type { McpAuthInput } from '../schemas/mcp-auth.schema.js';

/**
 * Resolves the authenticated MCP identity from an auth input DTO.
 * The DTO is extracted from the transport at the edge (e.g. from HTTP Request
 * headers) before the protocol layer is called, keeping the shared auth
 * interface free of platform-specific `Request` coupling.
 */
export interface McpAuthResolver {
  /**
   * Extracts and validates the authenticated identity from the auth input.
   *
   * @param input - Transport-neutral auth input DTO with credential fields
   *   extracted at the MCP transport edge.
   * @returns The authenticated user's UUID, optional agent UUID, auth method,
   *   `networkScopeId` if the caller's API key is bound to a network-scoped
   *   agent, and `clientSurface` declaring which kind of UI is rendering the
   *   MCP response (drives connect-link redirect choice at click time).
   *
   *   When `networkScopeId` is set, the MCP server clamps `indexScope` to that
   *   single network plus the user's personal index — every downstream tool
   *   then operates against that clamped scope.
   *
   *   `isSessionAuth` is true for OAuth/JWT bearer sessions — the agent-
   *   registration gate in the MCP server is skipped for these callers.
   *
   *   `clientSurface` is passed through from the DTO. Only `'telegram'`
   *   activates the t.me redirect path on `/c/{code}` clicks.
   *
   * @throws Error if authentication fails (no token, invalid token, etc.)
   */
  resolveIdentity(input: McpAuthInput): Promise<{
    userId: string;
    agentId?: string;
    isSessionAuth?: boolean;
    networkScopeId?: string | null;
    clientSurface?: 'telegram' | 'web';
  }>;

  /**
   * @deprecated Use resolveIdentity instead.
   */
  resolveUserId(request: Request): Promise<string>;
}
