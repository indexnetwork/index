import type { A2ACredentials } from "./transport.ts";

/** Builds an `A2ACredentials` function that attaches a static bearer token
 * to every outgoing call — pairs with `bearerTokenAuth()` on the other
 * side. For tokens that expire or rotate (e.g. short-lived JWTs), write a
 * custom `A2ACredentials` function that mints/refreshes one per call
 * instead. */
export function bearerCredentials(token: string): A2ACredentials {
  return () => ({ Authorization: `Bearer ${token}` });
}
