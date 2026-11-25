import { createHash, timingSafeEqual } from "node:crypto";

/** The slice of a Better Auth endpoint or hook context this module uses. */
interface AuthCtx {
  query?: Record<string, unknown>;
  context: {
    internalAdapter: {
      createVerificationValue(data: { identifier: string; value: string; expiresAt: Date }): Promise<unknown>;
      findVerificationValue(identifier: string): Promise<{ value: string; expiresAt: Date | string } | null | undefined>;
    };
  };
}

/**
 * Ties an emailed sign-in link to the browser that asked for it.
 *
 * Mail security scanners (Microsoft Safe Links, Mimecast, …) open every link
 * in incoming mail, run the page and click its buttons, so a one-time link is
 * spent before the recipient reads the email. The requesting browser keeps a
 * random key in its own storage and sends only the key's hash with the
 * request; redeeming the link then needs the key itself. A scanner never saw
 * the request, has no key, and cannot spend the link.
 *
 * Links requested without a key hash (older clients) keep working unbound.
 */

/** Query parameter that carries the browser key to `/magic-link/verify`. */
export const BROWSER_KEY_PARAM = "browserKey";
/** Fragment flag on the emailed link telling the web page the link is bound. */
export const BOUND_LINK_PARAM = "bound";
/** Error the web login page shows when the link is opened in another browser. */
export const OTHER_BROWSER_ERROR = "OTHER_BROWSER";

const HASH_PATTERN = /^[0-9a-f]{64}$/;

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function bindingIdentifier(token: string): string {
  // The raw token never goes into storage.
  return `magic-link-browser:${sha256(token)}`;
}

/** Reads a well-formed browser key hash from `signIn.magicLink` metadata. */
export function browserKeyHashFrom(metadata: unknown): string | null {
  const hash = (metadata as { browserKeyHash?: unknown } | undefined)?.browserKeyHash;
  return typeof hash === "string" && HASH_PATTERN.test(hash) ? hash : null;
}

/** Records which browser may redeem `token`, for as long as the link lives. */
export async function bindLinkToBrowser(
  ctx: AuthCtx,
  token: string,
  browserKeyHash: string,
  expiresInSeconds: number,
): Promise<void> {
  await ctx.context.internalAdapter.createVerificationValue({
    identifier: bindingIdentifier(token),
    value: browserKeyHash,
    expiresAt: new Date(Date.now() + expiresInSeconds * 1000),
  });
}

/**
 * Whether this verify request may spend the token: always for an unbound
 * link, and for a bound one only with the key whose hash was recorded.
 */
export async function mayRedeemLink(ctx: AuthCtx): Promise<boolean> {
  const token = ctx.query?.token;
  if (typeof token !== "string" || !token) return true;
  const binding = await ctx.context.internalAdapter.findVerificationValue(bindingIdentifier(token));
  // Redis-backed storage hands `expiresAt` back as a JSON string.
  if (!binding || new Date(binding.expiresAt).getTime() < Date.now()) return true;
  const key = ctx.query?.[BROWSER_KEY_PARAM];
  if (typeof key !== "string" || !key) return false;
  const expected = Buffer.from(binding.value, "utf8");
  const actual = Buffer.from(sha256(key), "utf8");
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/**
 * Where to send a browser that opened a bound link without its key: the
 * web login page, carrying the requested `errorCallbackURL` only when it
 * points at the web app itself.
 */
export function otherBrowserRedirect(ctx: AuthCtx, webAppURL: string): string {
  const web = new URL(webAppURL);
  let target = new URL("/login", web);
  const requested = ctx.query?.errorCallbackURL;
  if (typeof requested === "string") {
    try {
      const candidate = new URL(requested, web);
      if (candidate.origin === web.origin) target = candidate;
    } catch { /* fall back to /login */ }
  }
  target.searchParams.set("error", OTHER_BROWSER_ERROR);
  return target.toString();
}
