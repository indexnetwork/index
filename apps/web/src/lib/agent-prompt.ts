import { protocolOrigin } from "@/lib/protocol-origin";

/** Production MCP server, used when the app runs without a protocol origin (local dev on the Vite proxy). */
export const MCP_SERVER_URL = "https://protocol.index.network/mcp";

/**
 * The MCP server for the API this app talks to, so a prompt copied from dev
 * connects to dev and its invite codes resolve there.
 */
export function mcpServerUrl(): string {
  const origin = protocolOrigin();
  return origin ? `${origin}/mcp` : MCP_SERVER_URL;
}

/**
 * What to paste into another agent, the same everywhere. The server's own
 * instructions do the onboarding. From an invite link it also joins that
 * network, first, so the onboarding that follows already sees its members.
 */
export function agentPrompt(invite?: { networkTitle: string; inviteUrl: string }) {
  const lines = [
    `Index finds the right people for me, and lets them find me. Add it as an MCP server: ${mcpServerUrl()}`,
  ];
  if (invite) {
    lines.push(`Once it's connected, join the ${invite.networkTitle} network for me: call join_network with this invite: ${invite.inviteUrl}`);
    lines.push(`Tell me whether I'm in or waiting for an admin to approve me, then follow its instructions to set me up.`);
  } else {
    lines.push(`Once it's connected, follow its instructions to set me up.`);
  }
  return lines.join("\n");
}
