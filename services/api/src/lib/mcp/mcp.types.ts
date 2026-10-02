/** The credential behind an MCP call, which a later event delivery re-checks. */
export interface McpCredential {
  kind: 'api_key' | 'oauth' | 'session';
  /** API key id, OAuth client id, or device session id. */
  id: string;
}

/** Authenticated identity available to every Index MCP tool. */
export interface McpPrincipal {
  userId: string;
  authKind: 'api_key' | 'session';
  /** Absent for a web-app JWT, which names no revocable credential. */
  credential?: McpCredential;
}
