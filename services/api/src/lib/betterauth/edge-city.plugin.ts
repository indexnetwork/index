import type { BetterAuthPlugin } from "better-auth";
import { APIError, createAuthEndpoint } from "better-auth/api";
import { setSessionCookie } from "better-auth/cookies";
import { handleOAuthUserInfo } from "better-auth/oauth2";
import { z } from "zod";

export interface EdgeCityOptions {
  apiBase: string;
  tenantId: string;
  onSignIn?: (userId: string) => Promise<void>;
}

/**
 * "Login with Edge City": exchanges an EdgeOS bearer (obtained by the caller
 * through EdgeOS email OTP) for an Index session, like a Google idToken sign-in.
 * The bearer is verified against EdgeOS `/humans/me` before anything is trusted.
 */
export const edgeCity = (opts: EdgeCityOptions) =>
  ({
    id: "edge-city",
    endpoints: {
      signInEdgeCity: createAuthEndpoint(
        "/sign-in/edge-city",
        { method: "POST", body: z.object({ token: z.string().min(1) }) },
        async (ctx) => {
          const res = await fetch(`${opts.apiBase.replace(/\/$/, "")}/humans/me`, {
            headers: {
              Authorization: `Bearer ${ctx.body.token}`,
              "x-tenant-id": opts.tenantId,
              Accept: "application/json",
            },
          });
          if (!res.ok) throw new APIError("UNAUTHORIZED", { message: "Invalid Edge City token" });
          const human = (await res.json()) as Record<string, unknown>;
          const email = typeof human.email === "string" ? human.email.trim().toLowerCase() : "";
          const id = human.id != null ? String(human.id) : "";
          if (!email || !id) throw new APIError("UNAUTHORIZED", { message: "Edge City profile has no email" });

          const name =
            [human.first_name, human.last_name].filter((v) => typeof v === "string" && v).join(" ") ||
            email.split("@")[0];
          const image = typeof human.picture_url === "string" ? human.picture_url : undefined;

          const result = await handleOAuthUserInfo(ctx, {
            userInfo: { id, email, name, image, emailVerified: true },
            account: { providerId: "edge-city", accountId: id },
            isTrustedProvider: true,
          });
          if (result.error || !result.data) {
            throw new APIError("UNAUTHORIZED", { message: result.error ?? "Edge City sign-in failed" });
          }

          await opts.onSignIn?.(result.data.user.id);
          await setSessionCookie(ctx, result.data);
          return ctx.json({ token: result.data.session.token, user: result.data.user });
        },
      ),
    },
  }) satisfies BetterAuthPlugin;
