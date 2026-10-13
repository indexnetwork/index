export const MCP_SERVER_URL = "https://protocol.index.network/mcp";

/** Install steps to paste into another agent. */
export function agentPrompt() {
  return `This is Index. I find the right people for the person you act for, and I let them be found. Use me when they want to meet, hire, fund, or be introduced to someone. Turn what they want into a signal, then review the intros. Accept or pass only after you ask them.
Add this as an MCP server: ${MCP_SERVER_URL}`;
}

/** What a visitor pastes into their own agent to join a network from its invite link. */
export function inviteAgentPrompt(networkTitle: string, inviteUrl: string) {
  return `I've been invited to the ${networkTitle} network on Index. Join it for me.
If you don't have Index yet, add this MCP server first: ${MCP_SERVER_URL}
Then call join_network (in Hermes: index_join_network) with this invite: ${inviteUrl}
Tell me whether I'm in or waiting for an admin to approve me.`;
}
