export interface McpServerConfig {
  name: string;
  url: string;
  headers: Record<string, string>;
}

/**
 * Builds the MCP server config snippet returned by the headless signup endpoint.
 * Callers embed this in their runtime's MCP servers config.
 *
 * URL precedence matches `protocol-init.ts` and `opportunity.controller.ts`:
 * `BASE_URL || API_BASE_URL || APP_URL`, with the production protocol host as
 * the final fallback so a misconfigured deployment never returns a localhost
 * URL to integrators.
 */
export const buildMcpServerConfig = (apiKey: string): McpServerConfig => {
  const base = (
    process.env.BASE_URL ||
    process.env.API_BASE_URL ||
    process.env.APP_URL ||
    'https://protocol.index.network'
  ).replace(/\/+$/, '');
  return {
    name: 'index',
    url: `${base}/mcp`,
    headers: { 'x-api-key': apiKey },
  };
};
