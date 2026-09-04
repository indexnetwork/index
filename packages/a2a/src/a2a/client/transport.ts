import { asDeadlineError, deadlineSignal, type DeadlineOptions } from "../../core/deadline.ts";
import { isJsonRpcError, type JsonRpcRequest, type JsonRpcResponse } from "../wire/jsonrpc.ts";
import type { A2AMessage, A2ATask, AgentCard } from "../wire/types.ts";

/** Produces the headers to attach to an outgoing A2A call — e.g. a static
 * bearer token, or a freshly-minted/refreshed one each call. See
 * `bearerCredentials()` for a minimal example. */
export type A2ACredentials = () => Record<string, string> | Promise<Record<string, string>>;

/** Re-exported so callers can name the shape they pass without reaching
 * into `core/`. See `DeadlineOptions` for how `signal` and `timeoutMs`
 * interact. */
export type { DeadlineOptions };

/** The card is a small static JSON GET with no model work behind it, so it
 * gets a short deadline: an endpoint that hasn't answered this in 30s is
 * not one worth negotiating with. */
const DEFAULT_CARD_TIMEOUT_MS = 30_000;

/** A `message/send` waits on the counterparty running a full model turn of
 * its own, so this has to clear their model deadline (120s by default)
 * with room for transport on top — otherwise we'd abandon turns that were
 * about to succeed. It exists to bound the counterparty that accepts the
 * connection and then never answers at all. */
const DEFAULT_SEND_TIMEOUT_MS = 180_000;

/** Fetches another agent's AgentCard from its A2A base URL
 * (`<url>/.well-known/agent-card.json`). Useful as a trust check before
 * negotiating: confirm the endpoint identifies as who you expect before
 * calling `sendA2AMessage`/`A2ANegotiationClient`. Throws if the fetch
 * fails, times out, or the response isn't valid JSON. The public AgentCard
 * is unauthenticated per the A2A spec, so `credentials` is rarely needed
 * here. */
export async function fetchAgentCard(
  url: string,
  credentials?: A2ACredentials,
  options: DeadlineOptions = {},
): Promise<AgentCard> {
  const cardUrl = new URL("/.well-known/agent-card.json", url);
  const headers = credentials ? await credentials() : undefined;

  let response: Response;
  let body: string;
  try {
    response = await fetch(cardUrl, {
      headers,
      signal: deadlineSignal(options, DEFAULT_CARD_TIMEOUT_MS),
    });
    body = await response.text();
  } catch (error) {
    throw asDeadlineError(
      error,
      options,
      DEFAULT_CARD_TIMEOUT_MS,
      `Agent card fetch from ${cardUrl}`,
    );
  }

  if (!response.ok) {
    throw new Error(`Failed to fetch agent card from ${cardUrl} (${response.status})`);
  }

  try {
    return JSON.parse(body) as AgentCard;
  } catch {
    throw new Error(`Agent card at ${cardUrl} was not valid JSON: ${body}`);
  }
}

/** POSTs a single `message/send` JSON-RPC call to another agent's A2A
 * endpoint and returns the resulting Task. Throws if the request fails at
 * the transport level, exceeds its deadline, or if the counterparty returns
 * a JSON-RPC error (including a 401 from a counterparty whose
 * `authenticate` hook rejected the call — pass `credentials` to attach
 * whatever it expects).
 *
 * Pass `options.signal` to be able to give up on a counterparty that
 * accepts the connection and then goes quiet; `options.timeoutMs` adjusts
 * the built-in deadline that bounds that case by default. */
export async function sendA2AMessage(
  url: string,
  message: A2AMessage,
  credentials?: A2ACredentials,
  options: DeadlineOptions = {},
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

  let response: Response;
  let body: string;
  try {
    response = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(request),
      signal: deadlineSignal(options, DEFAULT_SEND_TIMEOUT_MS),
    });
    // Inside the deadline: a counterparty can stall just as effectively
    // after sending headers as before.
    body = await response.text();
  } catch (error) {
    throw asDeadlineError(
      error,
      options,
      DEFAULT_SEND_TIMEOUT_MS,
      `A2A message/send to ${url}`,
    );
  }

  if (!response.ok) {
    throw new Error(`A2A message/send to ${url} failed (${response.status}): ${body}`);
  }

  let rpcResponse: JsonRpcResponse<A2ATask>;
  try {
    rpcResponse = JSON.parse(body) as JsonRpcResponse<A2ATask>;
  } catch {
    throw new Error(`A2A message/send to ${url} returned a non-JSON response: ${body}`);
  }

  if (isJsonRpcError(rpcResponse)) {
    throw new Error(
      `A2A message/send to ${url} returned an error: ${rpcResponse.error.message}`,
    );
  }

  return rpcResponse.result;
}
