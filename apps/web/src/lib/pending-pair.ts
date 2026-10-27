/**
 * A "pair agents" click from someone who wasn't signed in yet. It has to
 * outlive sign-in, a magic link opened in another tab, and onboarding, so it
 * lives in localStorage; the profile page finishes the pair and clears it.
 */
const KEY = "index.pendingPair";
/** Long enough for sign-up and onboarding; older clicks are forgotten. */
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export interface PendingPair {
  /** The profile to come back to, e.g. `/seren`. */
  path: string;
  /** Whose agent to pair with. */
  userId: string;
  at: number;
  /** Times the home page has sent them back; a pair that can't finish stops bouncing. */
  bounces?: number;
}

/**
 * The real flow makes at most two trips (after onboarding, and after a first
 * intent). Generous, because StrictMode renders the home page twice in dev.
 */
const MAX_BOUNCES = 10;

export function rememberPendingPair(pair: Omit<PendingPair, "at">): void {
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...pair, at: Date.now() }));
  } catch {
    // Private mode can refuse storage; the visitor just clicks pair again.
  }
}

export function readPendingPair(): PendingPair | null {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    const pair = JSON.parse(raw) as PendingPair;
    if (!pair?.path || !pair.userId || Date.now() - pair.at > MAX_AGE_MS) {
      localStorage.removeItem(KEY);
      return null;
    }
    return pair;
  } catch {
    return null;
  }
}

/**
 * Where the home page should send someone with an unfinished pair, counting
 * the trip. After a few trips it gives up, so a pair that can never finish
 * doesn't trap them away from home.
 */
export function takePendingPairRedirect(): string | null {
  const pair = readPendingPair();
  if (!pair) return null;
  const bounces = (pair.bounces ?? 0) + 1;
  if (bounces > MAX_BOUNCES) {
    clearPendingPair();
    return null;
  }
  try {
    localStorage.setItem(KEY, JSON.stringify({ ...pair, bounces }));
  } catch {
    // Unwritable storage still allows this one trip.
  }
  return pair.path;
}

export function clearPendingPair(): void {
  try {
    localStorage.removeItem(KEY);
  } catch {
    // Nothing to clear.
  }
}
