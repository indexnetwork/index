/**
 * McpAuthInput — plain DTO extracted from the MCP HTTP request at the transport
 * edge before the protocol auth resolver is called. Keeps the shared auth
 * interface free of platform-specific `Request` coupling.
 */
export interface McpAuthInput {
  /** Authorization Bearer token (JWT or opaque session token). */
  bearerToken?: string;
  /** API key for agent/API-key authentication. */
  apiKey?: string;
  /** Client surface hint for UI branching (telegram vs web). */
  clientSurface?: 'telegram' | 'web';
  /** Telegram handle for identity verification (extracted from request headers). */
  telegramHandle?: string;
  /** Telegram username for identity verification (extracted from request headers). */
  telegramUsername?: string;
}