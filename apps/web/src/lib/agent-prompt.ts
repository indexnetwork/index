export const MCP_SERVER_URL = "https://protocol.index.network/mcp";

/** Install steps to paste into another agent. */
export function agentPrompt() {
  return `This is Index. I find the right people for the person you act for, and I let them be found. Use me when they want to meet, hire, fund, or be introduced to someone. Turn what they want into an intent, then review the intros. Accept or pass only after you ask them.
Add this as an MCP server: ${MCP_SERVER_URL}`;
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
