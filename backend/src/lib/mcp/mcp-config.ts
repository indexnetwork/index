import { resolveProtocolBaseUrl } from '../protocol-url';

export interface McpServerConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds the MCP server config snippet returned by the headless signup endpoint.
 * Callers embed this in their runtime's MCP servers config.
 *
 * The `/mcp` endpoint is served by the protocol host, so the base URL comes
 * from `resolveProtocolBaseUrl` (protocol-host vars only, never the frontend
 * `APP_URL`). The public protocol host is the fallback so a misconfigured
 * deployment never returns a localhost URL to integrators.
 */
export const buildMcpServerConfig = (apiKey: string): McpServerConfig => {
  const base = resolveProtocolBaseUrl('https://protocol.index.network');
  return {
    name: 'index',
    url: `${base}/mcp`,
    headers: { 'x-api-key': apiKey },
  };
};
