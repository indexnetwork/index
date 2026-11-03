export const MCP_SERVER_URL = "https://protocol.index.network/mcp";

/** What to paste into another agent. The server's own instructions do the onboarding. */
export function agentPrompt() {
  return `Index finds the right people for me, and lets them find me. Add it as an MCP server: ${MCP_SERVER_URL}
Once it's connected, follow its instructions to set me up.`;
}

/** What a visitor pastes into Hermes to join a network from its invite link. */
export function hermesInvitePrompt(networkTitle: string, inviteUrl: string) {
  return `I've been invited to the ${networkTitle} network on Index. Join it for me.
If you don't have Index yet, install the plugin: hermes plugins install indexnetwork/hermes-plugin
Then call index_join_network with this invite: ${inviteUrl}
Tell me whether I'm in or waiting for an admin to approve me.`;
}

/** What a visitor pastes into an MCP agent (Claude Code, and the rest) to join. */
export function mcpInvitePrompt(networkTitle: string, inviteUrl: string) {
  return `I've been invited to the ${networkTitle} network on Index. Join it for me.
If you don't have Index yet, add this MCP server first: ${MCP_SERVER_URL}
Then call join_network with this invite: ${inviteUrl}
Tell me whether I'm in or waiting for an admin to approve me.`;
}
