const DEFAULT_PROTOCOL_URL = import.meta.env.DEV
  ? "http://localhost:3001"
  : "https://protocol.index.network";
const PROTOCOL_URL = import.meta.env.VITE_PROTOCOL_URL || DEFAULT_PROTOCOL_URL;
const MCP_URL = `${PROTOCOL_URL}/mcp`;

function yamlDoubleQuoted(value: string): string {
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export interface McpConfigs {
  mcpUrl: string;
  claudeConfig: string;
  hermesConfig: string;
}

export function buildMcpConfigs(apiKey: string): McpConfigs {
  const claudeConfig = JSON.stringify(
    {
      mcpServers: {
        index: {
          type: "http",
          url: MCP_URL,
          headers: { "x-api-key": apiKey },
        },
      },
    },
    null,
    2,
  );

  const hermesConfig = `mcp_servers:
  - name: index
    url: ${yamlDoubleQuoted(MCP_URL)}
    headers:
      x-api-key: ${yamlDoubleQuoted(apiKey)}`;

  return { mcpUrl: MCP_URL, claudeConfig, hermesConfig };
}
