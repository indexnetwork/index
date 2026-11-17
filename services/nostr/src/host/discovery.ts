/**
 * Discovery: which intents should negotiate.
 *
 * In production this is Index's own discovery (embeddings and
 * `openCounterparties` in the API), which will read intents from the relay
 * and call {@link Host.openNegotiation}. The preview ships a stand-in that
 * scores word overlap, so the whole loop can run without the API. It is
 * deliberately simple and says so in its name.
 */
import type { Intent } from '@indexnetwork/nostr';

export interface DiscoveryCandidate {
  intent: Intent;
  score: number;
}

export interface Discovery {
  readonly name: string;
  /** Rank `others` as counterparties for `intent`, best first. Scoping (shared network, different person) is done by the caller. */
  rank(intent: Intent, others: Intent[]): DiscoveryCandidate[];
}

const STOPWORDS = new Set(['the', 'and', 'for', 'with', 'who', 'that', 'this', 'are', 'you', 'your', 'our', 'can', 'want', 'looking', 'need', 'someone', 'about', 'from', 'into', 'have', 'has', 'will', 'would', 'like', 'any', 'all', 'but', 'not', 'out', 'help', 'work', 'working']);

export function tokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9+#]+/).filter((word) => word.length >= 3 && !STOPWORDS.has(word)).map((word) => word.replace(/s$/, '')));
}

/** Preview stand-in: Jaccard overlap of content words. */
export class LexicalDiscovery implements Discovery {
  readonly name = 'preview-lexical';

  constructor(private readonly threshold: number) {}

  rank(intent: Intent, others: Intent[]): DiscoveryCandidate[] {
    const mine = tokens(intent.text);
    if (mine.size === 0) return [];
    return others
      .map((other) => {
        const theirs = tokens(other.text);
        const shared = [...mine].filter((word) => theirs.has(word)).length;
        const union = new Set([...mine, ...theirs]).size;
        return { intent: other, score: union === 0 ? 0 : shared / union };
      })
      .filter((candidate) => candidate.score >= this.threshold)
      // Ties go to the fresher intent.
      .sort((a, b) => b.score - a.score || b.intent.createdAt - a.intent.createdAt);
  }
}

/** Never opens anything on its own; an external discovery service drives the host. */
export class NoDiscovery implements Discovery {
  readonly name = 'off';
  rank(): DiscoveryCandidate[] {
    return [];
  }
}
