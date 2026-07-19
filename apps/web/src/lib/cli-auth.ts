/**
 * Accept only the loopback callback opened by the local Index CLI process.
 * Broad API credentials must never be redirected to caller-controlled origins.
 */
export function validateCliCallbackUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const port = Number(url.port);
    const isLoopback = url.hostname === "127.0.0.1" || url.hostname === "[::1]";
    if (
      url.protocol !== "http:"
      || !isLoopback
      || !Number.isInteger(port)
      || port < 1
      || port > 65535
      || url.pathname !== "/callback"
      || url.username
      || url.password
      || url.search
      || url.hash
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}
