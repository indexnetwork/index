/**
 * integrations/ports — IntegrationAdapter platform adapter port.
 *
 * Injected boundary for external integration platform access (OAuth sessions,
 * tool execution, connection management). Implemented by the host application
 * and passed into the protocol layer at the composition root.
 *
 * Retains host-integration configuration/actions semantics: adapter provides
 * session creation, tool execution, connection listing, OAuth auth URLs, and
 * disconnection — all platform-agnostic operations.
 *
 * IND-549: extracted from shared/interfaces/integration.interface.ts into the
 * integrations capability's dedicated ports layer.
 */

import type { IntegrationSession, IntegrationSessionOptions, ToolActionResponse, IntegrationConnection } from "../domain/index.js";

/**
 * Adapter for external integration platforms (OAuth sessions, tool execution).
 *
 * @remarks
 * Implementations wrap a specific platform SDK (e.g. Composio) and expose
 * a platform-agnostic API for creating user sessions and executing tool actions.
 */
export interface IntegrationAdapter {
  /**
   * Create an authenticated session for a user.
   * @param userId - User ID for the session
   * @param options - Session configuration (e.g. connection management)
   * @returns A session object for interacting with the platform
   */
  createSession(userId: string, options?: IntegrationSessionOptions): Promise<IntegrationSession>;

  /**
   * Execute a named tool action on behalf of a user.
   * @param slug - Tool action identifier (e.g. 'GMAIL_GET_CONTACTS')
   * @param userId - User to execute the action for
   * @param args - Arguments to pass to the tool action
   * @returns The tool execution response
   */
  executeToolAction(slug: string, userId: string, args: Record<string, unknown>): Promise<ToolActionResponse>;

  /**
   * List all connected accounts for a user.
   * @param userId - User to list connections for
   * @returns Array of connected integration accounts
   */
  listConnections(userId: string): Promise<IntegrationConnection[]>;

  /**
   * Get an OAuth authorization URL to connect a toolkit.
   * @param userId - User to authorize
   * @param toolkit - Toolkit slug (e.g. 'gmail')
   * @param callbackUrl - URL to redirect to after OAuth
   * @returns The redirect URL for OAuth
   */
  getAuthUrl(userId: string, toolkit: string, callbackUrl?: string): Promise<{ redirectUrl: string }>;

  /**
   * Disconnect (delete) a connected account.
   * @param connectedAccountId - The connected account ID to remove
   */
  disconnect(connectedAccountId: string): Promise<{ success: boolean }>;
}
