import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint, createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import { z } from "zod";

/**
 * The MCP plugin in Better Auth 1.6.11 only asks for consent when the caller
 * supplies prompt=consent. Its token endpoint consumes even a pending code.
 * Keep both sides of that boundary here rather than relying on the consent UI.
 */
export const mcpConsentSecurity = (webAppURL: string) => ({
  id: "mcp-consent-security",
  hooks: {
    before: [
      {
        matcher: (ctx) => ctx.path === "/mcp/authorize",
        handler: createAuthMiddleware(async (ctx) => {
          // This also changes the signed login-prompt cookie used by the MCP
          // plugin's post-login continuation. Never accept the client's prompt.
          return { context: { query: { ...ctx.query, prompt: "consent" } } };
        }),
      },
      {
        matcher: (ctx) => ctx.path === "/mcp/token",
        handler: createAuthMiddleware(async (ctx) => {
          const body = ctx.body instanceof FormData ? Object.fromEntries(ctx.body.entries()) : ctx.body;
          if (body?.grant_type !== "authorization_code" || typeof body.code !== "string") return;
          const verification = await ctx.context.internalAdapter.findVerificationValue(body.code);
          if (!verification) return; // The MCP plugin reports invalid_grant itself.
          // Only codes rotated by the owner's explicit approval are valid.
          // A pre-deployment code (or a code issued by any bypass of the
          // authorize hook) cannot become an MCP access token.
          const value = JSON.parse(verification.value) as { mcpConsentApproved?: boolean };
          if (value.mcpConsentApproved !== true) {
            throw new APIError("UNAUTHORIZED", { error: "invalid_grant", error_description: "Consent is required" });
          }
        }),
      },
    ],
  },
  endpoints: {
    decideMcpConsent: createAuthEndpoint(
      "/mcp/consent",
      { method: "POST", body: z.object({ consent_code: z.string().min(1), accept: z.boolean() }) },
      async (ctx) => {
        // Consent is a browser action. Require the actual consent page's Origin
        // even in environments where Better Auth's generic CSRF check is off.
        if (ctx.request?.headers.get("origin") !== new URL(webAppURL).origin) {
          throw new APIError("FORBIDDEN", { error: "invalid_request", error_description: "Invalid consent origin" });
        }
        const value = await pendingConsent(ctx, ctx.body.consent_code);
        // Consume the pending code before issuing another. Better Auth's OIDC
        // consent action renames the code in-place; with secondary storage its
        // cache key remains the old code, making the approved code unusable.
        const consumed = await ctx.context.internalAdapter.consumeVerificationValue(ctx.body.consent_code);
        if (!consumed || consumed.expiresAt <= new Date()) throw invalidConsent();
        const authorization = JSON.parse(consumed.value) as { userId: string; requireConsent: boolean; state?: string };
        if (authorization.userId !== value.userId || authorization.requireConsent !== true) throw invalidConsent();

        const redirectURI = new URL(value.redirectURI);
        if (!ctx.body.accept) {
          redirectURI.searchParams.set("error", "access_denied");
        } else {
          const code = crypto.randomUUID();
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: code,
            value: JSON.stringify({ ...authorization, requireConsent: false, mcpConsentApproved: true }),
            expiresAt: new Date(Date.now() + 600_000),
          });
          redirectURI.searchParams.set("code", code);
        }
        if (authorization.state) redirectURI.searchParams.set("state", authorization.state);
        return ctx.json({ redirectURI: redirectURI.toString() }, { headers: { "Cache-Control": "no-store" } });
      },
    ),
    getMcpConsentDetails: createAuthEndpoint(
      "/mcp/consent-details",
      { method: "GET", query: z.object({ consent_code: z.string().min(1) }) },
      async (ctx) => {
        const value = await pendingConsent(ctx, ctx.query.consent_code);
        const client = await ctx.context.adapter.findOne<{ name?: string; disabled: boolean; redirectUrls: string }>({
          model: "oauthApplication",
          where: [{ field: "clientId", value: value.clientId }],
        });
        if (!client || client.disabled || !client.redirectUrls.split(",").includes(value.redirectURI)) {
          throw invalidConsent();
        }
        return ctx.json(
          { clientName: client.name || "Unnamed client", redirectURI: value.redirectURI },
          { headers: { "Cache-Control": "no-store" } },
        );
      },
    ),
  },
}) satisfies BetterAuthPlugin;

function invalidConsent() {
  return new APIError("UNAUTHORIZED", { error: "invalid_request", error_description: "Invalid consent request" });
}

async function pendingConsent(
  ctx: Parameters<typeof getSessionFromCtx>[0],
  code: string,
): Promise<{ clientId: string; redirectURI: string; userId: string }> {
  const session = await getSessionFromCtx(ctx);
  if (!session) throw invalidConsent();

  const verification = await ctx.context.internalAdapter.findVerificationValue(code);
  if (!verification || verification.expiresAt <= new Date()) throw invalidConsent();
  const value = JSON.parse(verification.value) as {
    clientId?: string;
    redirectURI?: string;
    userId?: string;
    requireConsent?: boolean;
  };
  if (value.requireConsent !== true || value.userId !== session.user.id || !value.clientId || !value.redirectURI) {
    throw invalidConsent();
  }
  return { clientId: value.clientId, redirectURI: value.redirectURI, userId: value.userId };
}
