/**
 * MCP clients register themselves (RFC 7591) and choose their own name, so the
 * name alone proves nothing. The redirect URI is what an authorization code is
 * sent to, so a known HTTPS host is the one thing we can vouch for: a client
 * that registers as "ChatGPT" with a chatgpt.com redirect can only deliver the
 * code to ChatGPT.
 */
const KNOWN_MCP_CLIENT_HOSTS: Record<string, string> = {
  "chatgpt.com": "ChatGPT",
  "claude.ai": "Claude",
  "claude.com": "Claude",
};

/** The name we vouch for when the redirect goes to a known client's host, else null. */
export function knownMcpClientName(redirectURI: string): string | null {
  let url: URL;
  try {
    url = new URL(redirectURI);
  } catch {
    return null;
  }
  if (url.protocol !== "https:" || url.port !== "" || url.username || url.password) return null;
  return KNOWN_MCP_CLIENT_HOSTS[url.hostname] ?? null;
}

/** The host (with port) a consent page shows as where approval returns to. */
export function redirectHost(redirectURI: string): string {
  try {
    return new URL(redirectURI).host || redirectURI;
  } catch {
    return redirectURI;
  }
}
