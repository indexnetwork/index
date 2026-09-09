import type { ApiClient } from "./api.client";

/** Discover HTTP tools or invoke one JSON object query. */
export async function handleTool(client: ApiClient, subcommand: string | undefined, name: string | undefined, query: string | undefined, json?: boolean): Promise<void> {
  let result: unknown;
  if (subcommand === "list") {
    result = await client.listTools();
  } else if (subcommand === "call") {
    if (!name || query === undefined) throw new Error("Usage: index tool call <name> --query '<json object>'");
    let parsed: unknown;
    try { parsed = JSON.parse(query); } catch { throw new Error("--query must be valid JSON"); }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error("--query must be a JSON object");
    result = await client.callTool(name, parsed as Record<string, unknown>);
  } else {
    throw new Error("Usage: index tool list | index tool call <name> --query '<json object>'");
  }
  console.log(JSON.stringify(result, null, json ? undefined : 2));
}
