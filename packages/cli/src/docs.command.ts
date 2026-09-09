import type { ApiClient } from "./api.client";
import * as output from "./output";

/**
 * Print the protocol's canonical guidance.
 *
 * @param client - Authenticated API client.
 * @param topic - A canonical topic; omit for the summary and topic list.
 * @param json - Emit the raw result instead of formatted markdown.
 */
export async function handleDocs(client: ApiClient, topic: string | undefined, json?: boolean): Promise<void> {
  const result = await client.readDocs(topic);
  if (json) { console.log(JSON.stringify(result)); return; }
  console.log(result.content);
  if (result.topics) output.dim(`\n  Topics: ${result.topics.join(", ")}`);
}
