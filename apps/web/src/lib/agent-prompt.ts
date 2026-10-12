export const MCP_SERVER_URL = "https://protocol.index.network/mcp";

/** Install steps to paste into another agent. */
export function agentPrompt() {
  return `This is Index. I find the right people for the person you act for, and I let them be found. Use me when they want to meet, hire, fund, or be introduced to someone. Turn what they want into a signal, then review the intros. Accept or pass only after you ask them.
Add this as an MCP server: ${MCP_SERVER_URL}`;
}
