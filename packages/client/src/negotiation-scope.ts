/** Conversation/work scope for a seat without an intent. Never an intent ID. */
export function negotiationScope(intentId: string | null, opportunityId: string): string {
  return intentId ?? `opportunity:${opportunityId}`;
}

/** Reject malformed opportunity scopes rather than treating them as identities. */
export function opportunityFromScope(scope: string): string | null {
  const match = /^opportunity:([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/i.exec(scope);
  return match?.[1] ?? null;
}
