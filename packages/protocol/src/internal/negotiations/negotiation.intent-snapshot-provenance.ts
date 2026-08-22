export interface IntentSnapshot {
  userId: string;
  intentId: string;
  title: string;
  description: string;
}

type IntentSnapshotSource = {
  id?: unknown;
  intents?: Array<{
    id?: unknown;
    title?: unknown;
    description?: unknown;
  } | null | undefined>;
};

/**
 * Captures immutable, internal-only intent provenance at negotiation task
 * creation. Invalid records are excluded and each participant/intent pair is
 * kept once, so later mutable user context cannot rewrite task history.
 */
export function buildIntentSnapshots(
  sourceUser: IntentSnapshotSource,
  candidateUser: IntentSnapshotSource,
): IntentSnapshot[] {
  const snapshots: IntentSnapshot[] = [];
  const seen = new Set<string>();

  for (const user of [sourceUser, candidateUser]) {
    if (typeof user.id !== "string" || user.id.trim().length === 0) continue;
    for (const intent of Array.isArray(user.intents) ? user.intents : []) {
      if (typeof intent?.id !== "string" || intent.id.trim().length === 0) continue;
      const key = `${user.id}\u0000${intent.id}`;
      if (seen.has(key)) continue;
      seen.add(key);
      snapshots.push({
        userId: user.id,
        intentId: intent.id,
        title: typeof intent.title === "string" ? intent.title : "",
        description: typeof intent.description === "string" ? intent.description : "",
      });
    }
  }

  return snapshots;
}
