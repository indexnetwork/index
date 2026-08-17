/** Strict, default-off gate for finding opportunities on behalf of another user. */
export function isIntroducerDiscoveryEnabled(): boolean {
  return process.env.INTRODUCER_DISCOVERY_ENABLED === "true";
}
