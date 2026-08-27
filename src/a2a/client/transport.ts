import { isJsonRpcError, type JsonRpcRequest, type JsonRpcResponse } from "../wire/jsonrpc.ts";
import type { A2AMessage, A2ATask, AgentCard } from "../wire/types.ts";

/** Produces the headers to attach to an outgoing A2A call — e.g. a static
 * bearer token, or a freshly-minted/refreshed one each call. See
 * `bearerCredentials()` for a minimal example. */
export type A2ACredentials = () => Record<string, string> | Promise<Record<string, string>>;

/** Fetches another agent's AgentCard from its A2A base URL
 * (`<url>/.well-known/agent-card.json`). Useful as a trust check before
 * negotiating: confirm the endpoint identifies as who you expect before
 * calling `sendA2AMessage`/`A2ANegotiationClient`. Throws if the fetch
 * fails or the response isn't valid JSON. The public AgentCard is
 * unauthenticated per the A2A spec, so `credentials` is rarely needed here. */
export async function fetchAgentCard(url: string, credentials?: A2ACredentials): Promise<AgentCard> {
  const cardUrl = new URL("/.well-known/agent-card.json", url);
  const headers = credentials ? await credentials() : undefined;
  const response = await fetch(cardUrl, { headers });

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl} (${response.status})`);
  }

  return (await response.json()) as AgentCard;
}

/** POSTs a single `message/send` JSON-RPC call to another agent's A2A
 * endpoint and returns the resulting Task. Throws if the request fails at
 * the transport level, or if the counterparty returns a JSON-RPC error
 * (including a 401 from a counterparty whose `authenticate` hook rejected
 * the call — pass `credentials` to attach whatever it expects). */
export async function sendA2AMessage(
  url: string,
  message: A2AMessage,
  credentials?: A2ACredentials,
): Promise<A2ATask> {
  const request: JsonRpcRequest<{ message: A2AMessage }> = {
    jsonrpc: "2.0",
    id: crypto.randomUUID(),
    method: "message/send",
    params: { message },
  };

  const headers = {
    "Content-Type": "application/json",
    ...(credentials ? await credentials() : {}),
  };

  const response = await fetch(url, {
    method: "POST",
    headers,
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
