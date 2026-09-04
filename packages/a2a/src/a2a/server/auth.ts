import type { A2AIdentity } from "../wire/types.ts";

/**
 * Builds an `authenticate` hook for `createA2AHandler()` that admits a
 * request only if its `Authorization: Bearer <token>` header matches
 * `expectedToken` exactly. Fine for a single trust boundary you control
 * (e.g. server-to-server calls within one deployment); it does not verify
 * tokens issued by another party's own identity provider — for that,
 * write a custom `authenticate` function that verifies a JWT against the
 * issuer's JWKS instead.
 */
export function bearerTokenAuth(
  expectedToken: string,
  subject = "bearer",
): (request: Request) => A2AIdentity | null {
  return (request) => {
    const header = request.headers.get("authorization") ?? "";
    const [scheme, token] = header.split(" ");
    if (scheme?.toLowerCase() !== "bearer" || !token || token !== expectedToken) return null;
    return { subject };
  };
}
