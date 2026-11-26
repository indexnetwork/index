import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { z } from "zod";

export interface BonfiresOptions {
  /** Who signs the tokens, e.g. https://hack.bonfires.london. Must match the token's `iss`. */
  issuer: string;
  /** Where the issuer's public keys are. Defaults to `<issuer>/.well-known/jwks.json`. */
  jwksUrl?: string;
  /** This API's origin. Must match the token's `aud`, so a token made for another service is refused. */
  audience: string;
  onSignIn?: (userId: string) => Promise<void>;
}

/** A token older than this is refused whatever its `exp` says. Bonfires signs them for 60 seconds. */
const MAX_TOKEN_AGE_S = 120;
/** Allowed clock difference between the issuer and us, so a fresh token is not refused as "issued in the future". */
const CLOCK_TOLERANCE_S = 30;

/**
 * "Login with Bonfires": exchanges a short token signed by a Bonfires app for an
 * Index session, like Edge City sign-in. The app has already signed the person in
 * and verified their email; the token says so (`sub` = `email`, `email_verified`).
 * Nothing in it is trusted until its ES256 signature checks against the issuer's
 * published keys, and each token is accepted once.
 */
export const bonfires = (opts: BonfiresOptions) => {
  const issuer = opts.issuer.replace(/\/+$/, "");
  const keys = createRemoteJWKSet(new URL(opts.jwksUrl || `${issuer}/.well-known/jwks.json`));
  /** Token ids already used, until they expire. One process: a second replica needs a shared store. */
  const used = new Map<string, number>();

  return {
    id: "bonfires",
    endpoints: {
      signInBonfires: createAuthEndpoint(
        "/sign-in/bonfires",
        { method: "POST", body: z.object({ token: z.string().min(1) }) },
        async (ctx) => {
          const claims = await jwtVerify(ctx.body.token, keys, {
            issuer,
            audience: opts.audience,
            algorithms: ["ES256"],
            maxTokenAge: MAX_TOKEN_AGE_S,
            clockTolerance: CLOCK_TOLERANCE_S,
            requiredClaims: ["sub", "exp", "iat", "jti"],
          }).then(
            (verified) => verified.payload,
            () => null,
          );
          if (!claims) throw new APIError("UNAUTHORIZED", { message: "Invalid Bonfires token" });

          const email = typeof claims.email === "string" ? claims.email.trim().toLowerCase() : "";
          if (!email || claims.email_verified !== true || claims.sub !== email) {
            throw new APIError("UNAUTHORIZED", { message: "Bonfires token has no verified email" });
          }

          const now = Math.floor(Date.now() / 1000);
          for (const [id, exp] of used) if (exp < now) used.delete(id);
          const jti = String(claims.jti);
          if (used.has(jti)) throw new APIError("UNAUTHORIZED", { message: "Bonfires token already used" });
          used.set(jti, claims.exp ?? now + MAX_TOKEN_AGE_S);

          const name = (typeof claims.name === "string" && claims.name.trim()) || email.split("@")[0];
          const image = typeof claims.picture === "string" ? claims.picture : undefined;

          // Whether this sign-in is what makes the account: the caller only writes a
          // profile it knows nobody else has touched.
          const existing = await ctx.context.internalAdapter.findUserByEmail(email);

          const result = await handleOAuthUserInfo(ctx, {
            userInfo: { id: email, email, name, image, emailVerified: true },
            account: { providerId: "bonfires", accountId: email },
            isTrustedProvider: true,
          });
          if (result.error || !result.data) {
            throw new APIError("UNAUTHORIZED", { message: result.error ?? "Bonfires sign-in failed" });
          }

          await opts.onSignIn?.(result.data.user.id);
          await setSessionCookie(ctx, result.data);
          return ctx.json({
            token: result.data.session.token,
            user: result.data.user,
            created: !existing,
          });
        },
      ),
    },
  } satisfies BetterAuthPlugin;
};
