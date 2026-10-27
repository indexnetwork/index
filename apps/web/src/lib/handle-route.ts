/**
 * First path segments the router owns (apps/web/src/routes.tsx). Any other
 * first segment is a handle: a username or a network link name at
 * `index.network/<handle>`. Keep this in step with the routes.
 */
const ROUTED_SEGMENTS = new Set([
  "9db20a5fbe", "about", "agents", "blog", "chat", "cli-auth", "download", "found-in-translation",
  "hermes", "i", "l", "login", "mcp", "negotiations", "networks", "o", "onboarding", "opportunities",
  "pages", "profile", "protocol", "s", "settings", "setup", "u", "waitlist",
]);

/** Whether a path is `/<handle>` (or a tab under a network's handle). */
export function isHandlePath(pathname: string): boolean {
  const first = pathname.split("/")[1] ?? "";
  return first !== "" && !ROUTED_SEGMENTS.has(first);
}
