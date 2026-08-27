import { isJsonRpcError, type JsonRpcRequest, type JsonRpcResponse } from "../wire/jsonrpc.ts";
import type { A2AMessage, A2ATask } from "../wire/types.ts";

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
