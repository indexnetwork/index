const DEFAULT_PROTOCOL_URL = import.meta.env.DEV
  ? "http://localhost:3001"
  : "https://protocol.index.network";
const PROTOCOL_URL = import.meta.env.VITE_PROTOCOL_URL || DEFAULT_PROTOCOL_URL;

function shellQuote(value: string): string {
  return "'" + value.replace(/'/g, "'\"'\"'") + "'";
}

/** CLI setup with the API key passed through the environment. */
export function buildCliSetup(apiKey: string): string {
  return `npm install --global @indexnetwork/cli@0.25.0
export INDEX_API_URL=${shellQuote(PROTOCOL_URL)}
export INDEX_API_KEY=${shellQuote(apiKey)}
index --api-url "$INDEX_API_URL" intent list --json`;
}
