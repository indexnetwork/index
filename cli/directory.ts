/**
 * A stand-in for the intent/match layer.
 *
 * Index Network is where agents actually find each other: parties publish
 * intents, the network matches them, and a match is what gives one agent
 * another's endpoint. The package deliberately knows none of that — the
 * host owns discovery and injects it as tools.
 *
 * So that two terminals can find each other without a network, this keeps
 * the same shape in a JSON file: each running agent registers its intent
 * and A2A URL, and `matchesFor()` pairs them. Swap `score()` for the real
 * matcher and the seam above it doesn't move.
 */
import { rename } from "node:fs/promises";

export interface DirectoryEntry {
  /** The party this agent acts for — the identity from its AgentCard. */
  id: string;
  name: string;
  /** A2A endpoint, which is what a match is ultimately for. */
  url: string;
  /** What the party is here to do. The thing being matched on. */
  intent: string;
  /** False for seeded fixtures: an intent with nobody behind it. */
  live: boolean;
  updatedAt?: string;
}

export interface Match {
  entry: DirectoryEntry;
  /** 0–1. Meaningless in absolute terms; only the ordering is meant. */
  score: number;
  /** Why these two were paired, in words. A real matcher would say
   * something better. */
  why: string;
}

export class Directory {
  constructor(
    private readonly file: string,
    /** Made-up intents with nobody running behind them, so the match list
     * looks like a directory rather than a pair. */
    private readonly seeds: DirectoryEntry[] = [],
  ) {}

  async all(): Promise<DirectoryEntry[]> {
    return [...(await this.read()), ...this.seeds];
  }

  /** Publishing an intent. Re-registering under the same id replaces it,
   * so a rescope or a restart doesn't leave two. */
  async register(entry: Omit<DirectoryEntry, "live" | "updatedAt">): Promise<void> {
    const entries = await this.read();
    const next = entries.filter((other) => other.id !== entry.id);
    // An intent with no endpoint is published but not reachable — someone
    // said what they want and there is nobody to say it to.
    next.push({ ...entry, live: Boolean(entry.url), updatedAt: new Date().toISOString() });
    await this.write(next);
  }

  async deregister(id: string): Promise<void> {
    const entries = await this.read();
    await this.write(entries.filter((entry) => entry.id !== id));
  }

  /** Everyone whose intent this one has something to do with, best first.
   * Never matches a party with itself. */
  async matchesFor(self: { id: string; intent: string }, limit = 5): Promise<Match[]> {
    const entries = await this.all();

    return entries
      .filter((entry) => entry.id !== self.id)
      .map((entry) => ({ entry, ...score(self.intent, entry.intent) }))
      .filter((match) => match.score > 0.12)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  private async read(): Promise<DirectoryEntry[]> {
    try {
      const parsed = await Bun.file(this.file).json();
      return Array.isArray(parsed) ? (parsed as DirectoryEntry[]) : [];
    } catch {
      return [];
    }
  }

  /** Written through a temporary file: two agents registering at once
   * otherwise read-modify-write over each other. */
  private async write(entries: DirectoryEntry[]): Promise<void> {
    const temporary = `${this.file}.${process.pid}.tmp`;
    await Bun.write(temporary, `${JSON.stringify(entries, null, 2)}\n`);
    await rename(temporary, this.file);
  }
}

// --- matching --------------------------------------------------------

// Two intents match when they are about the same thing and want opposite
// ends of it. That is the whole heuristic, and it is a placeholder for a
// real matcher — enough to pair "selling a road bike" with "buying a road
// bike" and to leave "looking for a mechanic" out of it.
const SEEKING = /\b(buy|buying|looking|need|needs|want|wants|seeking|seek|find|hire|rent|after)\b/;
const OFFERING = /\b(sell|selling|offer|offering|have|available|providing|provide|let|lease)\b/;

const STOPWORDS = new Set([
  "a", "an", "and", "any", "are", "as", "at", "be", "but", "by", "can", "for", "from", "good",
  "has", "have", "in", "is", "it", "its", "me", "my", "of", "on", "one", "or", "our", "out",
  "some", "that", "the", "their", "them", "there", "they", "this", "to", "under", "up", "want",
  "wants", "with", "would", "you", "your",
]);

function score(mine: string, theirs: string): { score: number; why: string } {
  const a = terms(mine);
  const b = terms(theirs);
  if (!a.size || !b.size) return { score: 0, why: "" };

  const shared = [...a].filter((term) => b.has(term));
  const overlap = shared.length / Math.min(a.size, b.size);

  const sides = compare(mine, theirs);
  const total = Math.max(0, Math.min(1, overlap + sides.weight));

  const why = [shared.length ? `both mention ${shared.slice(0, 4).join(", ")}` : "", sides.why]
    .filter(Boolean)
    .join("; ");

  return { score: Number(total.toFixed(2)), why };
}

/**
 * Which end of the same thing each party wants. Two buyers have plenty of
 * words in common and nothing to trade, so wanting the same end counts
 * against a match rather than for it.
 */
function compare(mine: string, theirs: string): { weight: number; why: string } {
  const seeking = SEEKING.test(mine.toLowerCase());
  const offering = OFFERING.test(mine.toLowerCase());
  const theySeek = SEEKING.test(theirs.toLowerCase());
  const theyOffer = OFFERING.test(theirs.toLowerCase());

  if (seeking && theyOffer && !theySeek) return { weight: 0.35, why: "you are looking, they are offering" };
  if (offering && theySeek && !theyOffer) return { weight: 0.35, why: "you are offering, they are looking" };
  if (seeking && theySeek) return { weight: -0.25, why: "you are both looking — nothing to trade" };
  if (offering && theyOffer) return { weight: -0.25, why: "you are both offering — nothing to trade" };
  return { weight: 0, why: "" };
}

function terms(text: string): Set<string> {
  const words = text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 2 && !STOPWORDS.has(word))
    .map(stem);

  return new Set(words);
}

/** Crude, and deliberately so: "bikes" and "bike" have to meet somewhere. */
function stem(word: string): string {
  return word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
