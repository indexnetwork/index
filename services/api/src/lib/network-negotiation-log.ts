/**
 * The anonymized negotiation log on a network's public invite page
 * (`/l/:code`), shaped like the Hermes plugin's agent log. Each line keeps
 * only what a turn did (propose, counter, accept, decline) and how a thread
 * closed. No message text, no people, no opportunity. Each thread's two
 * agents get made-up names, drawn at random for this one response, so a name
 * means nothing across views.
 */

export type NegotiationLogEvent =
  | { kind: 'turn'; thread: number; from: string; to: string; action: 'propose' | 'counter' | 'accept' | 'decline'; turn: number; at: string }
  | { kind: 'close'; thread: number; a: string; b: string; outcome: 'agreed' | 'declined' | 'closed'; turns: number; at: string };

const ADJECTIVES = [
  'Caffeinated', 'Suspicious', 'Overprepared', 'Polite', 'Sleepy', 'Ambitious', 'Chatty', 'Dramatic',
  'Punctual', 'Earnest', 'Scrappy', 'Diplomatic', 'Stubborn', 'Optimistic', 'Well-Read', 'Fashionably Late',
];
const CREATURES = [
  'Otter', 'Toaster', 'Pigeon', 'Walrus', 'Cactus', 'Lobster', 'Teapot', 'Moth',
  'Badger', 'Llama', 'Narwhal', 'Croissant', 'Penguin', 'Raccoon', 'Kettle', 'Axolotl',
];

/** Distinct made-up names, shuffled fresh for every response. */
function nameDeck(): () => string {
  const deck = ADJECTIVES.flatMap((adj) => CREATURES.map((c) => `${adj} ${c}`));
  for (let i = deck.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  let next = 0;
  return () => deck[next++ % deck.length];
}

export interface NegotiationTurnRow {
  negotiationId: string;
  turnIndex: number;
  action: 'propose' | 'counter' | 'accept' | 'decline';
  createdAt: Date;
  /** The turn's seat was the negotiation's initiator. */
  byInitiator: boolean;
}

export interface NegotiationCloseRow {
  negotiationId: string;
  outcome: 'agreed' | 'declined' | 'closed';
  settledAt: Date;
  turns: number;
}

const LOG_LENGTH = 14;

/** Minute precision is enough for a log and no sharper than it needs to be. */
function minute(date: Date): string {
  const d = new Date(date);
  d.setSeconds(0, 0);
  return d.toISOString();
}

/**
 * The newest {@link LOG_LENGTH} events, oldest first, with negotiation ids
 * replaced by small per-response thread numbers and made-up agent names.
 */
export function buildNegotiationLog(turns: NegotiationTurnRow[], closes: NegotiationCloseRow[]): NegotiationLogEvent[] {
  type Names = { a: string; b: string };
  type Raw = { id: string; at: Date; make: (thread: number, names: Names) => NegotiationLogEvent };
  const raw: Raw[] = [
    ...turns.map((t): Raw => ({
      id: t.negotiationId,
      at: t.createdAt,
      make: (thread, names) => ({
        kind: 'turn',
        thread,
        from: t.byInitiator ? names.a : names.b,
        to: t.byInitiator ? names.b : names.a,
        action: t.action,
        turn: t.turnIndex + 1,
        at: minute(t.createdAt),
      }),
    })),
    ...closes.map((c): Raw => ({
      id: c.negotiationId,
      // A close lands after the turn that settled it.
      at: new Date(c.settledAt.getTime() + 1),
      make: (thread, names) => ({ kind: 'close', thread, ...names, outcome: c.outcome, turns: c.turns, at: minute(c.settledAt) }),
    })),
  ];
  const newest = raw.sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, LOG_LENGTH).reverse();
  const draw = nameDeck();
  const threads = new Map<string, { n: number; names: Names }>();
  return newest.map((e) => {
    if (!threads.has(e.id)) threads.set(e.id, { n: threads.size + 1, names: { a: draw(), b: draw() } });
    const { n, names } = threads.get(e.id)!;
    return e.make(n, names);
  });
}
