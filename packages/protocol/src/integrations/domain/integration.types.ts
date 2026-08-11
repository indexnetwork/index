/**
 * integrations/domain — pure integration entity value types.
 *
 * Contains session shapes, connection records, and tool action responses.
 * No application logic, no LLM calls, no cross-capability imports.
 *
 * IND-549: canonical domain layer for the integrations capability.
 */

/**
 * Session for interacting with an external integration platform.
 * Provides access to tools, OAuth authorization, and toolkit discovery.
 */
export interface IntegrationSession {
  tools(): Promise<unknown[]>;
  authorize(toolkit: string): Promise<{ redirectUrl: string; waitForConnection(timeout?: number): Promise<unknown> }>;
  toolkits(): Promise<{ items: Array<{ slug: string; name: string; connection?: { connectedAccount?: { id: string } } }> }>;
}

/** Options for creating an integration session. */
export interface IntegrationSessionOptions {
  manageConnections?: boolean | { callbackUrl?: string };
  /** Toolkit slug → auth config ID mapping to pin existing auth configs. */
  authConfigs?: Record<string, string>;
}

/** Response from executing a tool action on the integration platform. */
export interface ToolActionResponse {
  successful: boolean;
  error?: string;
  data?: Record<string, unknown>;
}

/** A connected integration account for a user. */
export interface IntegrationConnection {
  id: string;
  toolkit: string;
  status: string;
  createdAt: string;
}
