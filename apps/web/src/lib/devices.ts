/** The macOS app signs in through the device grant with an `Index/mac` user agent. */
export function isMacUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.startsWith("Index/");
}

/** The Hermes plugin signs in through the device grant with a `Hermes` user agent. */
export function isHermesUserAgent(userAgent: string | null | undefined): boolean {
  return !!userAgent && userAgent.includes("Hermes");
}
