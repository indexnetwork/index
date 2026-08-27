import { isJsonRpcError, type JsonRpcRequest, type JsonRpcResponse } from "../wire/jsonrpc.ts";
import type { A2AMessage, A2ATask, AgentCard } from "../wire/types.ts";

/** Fetches another agent's AgentCard from its A2A base URL
 * (`<url>/.well-known/agent-card.json`). Useful as a trust check before
 * negotiating: confirm the endpoint identifies as who you expect before
 * calling `sendA2AMessage`/`A2ANegotiationClient`. Throws if the fetch
 * fails or the response isn't valid JSON. */
export async function fetchAgentCard(url: string): Promise<AgentCard> {
  const cardUrl = new URL("/.well-known/agent-card.json", url);
  const response = await fetch(cardUrl);

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl} (${response.status})`);
  }

  return (await response.json()) as AgentCard;
}

/** POSTs a single `message/send` JSON-RPC call to another agent's A2A
 * endpoint and returns the resulting Task. Throws if the request fails at
 * the transport level, or if the counterparty returns a JSON-RPC error. */
export async function sendA2AMessage(url: string, message: A2AMessage): Promise<A2ATask> {
  const request: JsonRpcRequest<{ message: A2AMessage }> = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: { message },
  };

  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`A2A message/send to ${url} failed (${response.status}): ${body}`);
  }

  const rpcResponse = (await response.json()) as JsonRpcResponse<A2ATask>;
  if (isJsonRpcError(rpcResponse)) {
    throw new Error(
      `A2A message/send to ${url} returned an error: ${rpcResponse.error.message}`,
    );
  }

  return rpcResponse.result;
}
