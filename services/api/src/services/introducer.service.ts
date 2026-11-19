import { createModel, type Model } from '@indexnetwork/agent';
import { generateText, jsonSchema, Output } from 'ai';
import { auth } from '../lib/betterauth/auth.instance';
import { log } from '../lib/log';
import { introducerDatabaseAdapter, type ContactInput, type IntroducerDatabaseAdapter, type IntroductionRow, type PairCandidate } from '../adapters/introducer.database.adapter';

const logger = log.service.from('introducer');

/** Read access to saved contacts and to "other contacts" (people you've emailed). */
export const CONTACT_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
] as const;

const PEOPLE_API = 'https://people.googleapis.com/v1';
/** Google caps a page at 1000; 10 pages per source is plenty for a preview. */
const MAX_PAGES = 10;
/** Candidates the screen reads; it keeps the ones that genuinely fit. */
const CANDIDATE_LIMIT = 40;
const PAIR_LIMIT = 15;
/** Screened pairs per member, reused across page loads for a while. */
const PAIRS_TTL_MS = 10 * 60_000;

let screenModel: Model | null = null;
function introModel(): Model {
  screenModel ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/introduce', 'X-Title': 'Index Intro Desk' },
  });
  return screenModel;
}

interface ScreenResult {
  pairs: { i: number; intro: string }[];
}

const screenSchema = jsonSchema<ScreenResult>({
  type: 'object',
  properties: {
    pairs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          i: { type: 'integer', description: 'The pair number from the list.' },
          intro: { type: 'string', description: "Two short sentences in the introducer's voice to both people, first names, saying concretely why they should talk. No flattery, no emoji." },
        },
        required: ['i', 'intro'],
        additionalProperties: false,
      },
    },
  },
  required: ['pairs'],
  additionalProperties: false,
});

export type ImportOutcome =
  | { kind: 'ok'; total: number; onIndex: number }
  | { kind: 'not_linked' }
  | { kind: 'missing_scope' }
  | { kind: 'google_error'; status: number };

export interface IntroducerStatus {
  google: { linked: boolean; contactsScope: boolean };
  contacts: { total: number; onIndex: number; lastImportAt: string | null };
}

/** A pair as the Intro Desk shows it. */
export interface PairSuggestion {
  key: string;
  networkId: string;
  networkTitle: string;
  score: number;
  a: PairCandidate['a'];
  b: PairCandidate['b'];
  /** A starting intro the member edits before waking both agents. */
  draft: string;
}

export type StepSide = 'a' | 'b' | 'both' | 'you';

/** One line of an introduction's progress. Never carries what an agent said. */
export interface ProgressStep {
  side: StepSide;
  kind: 'opened' | 'turn' | 'agreed' | 'committed' | 'declined' | 'expired';
  action?: string;
  turn?: number;
  at: string;
}

export interface IntroductionProgress {
  opportunityId: string;
  status: string;
  createdAt: string;
  context: string;
  a: IntroductionRow['a'];
  b: IntroductionRow['b'];
  /** Whose agent has the turn now; null when nobody does. */
  awaiting: 'a' | 'b' | null;
  phase: 'negotiating' | 'agreed' | 'accepted' | 'declined' | 'expired';
  steps: ProgressStep[];
}

interface GooglePerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** Short enough for a one-line "wants" in the draft. */
function clip(text: string, max = 140): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

/**
 * The introducer: a member imports who they know, sees pairs of other people
 * whose intents fit, and wakes both agents with their own intro. Progress is
 * the negotiation's shape (who moved, when, the outcome), never its wording.
 */
export class IntroducerService {
  constructor(private readonly adapter: IntroducerDatabaseAdapter = introducerDatabaseAdapter) {}

  async status(userId: string): Promise<IntroducerStatus> {
    const [scope, counts] = await Promise.all([
      this.adapter.googleScope(userId),
      this.adapter.contactCounts(userId),
    ]);
    const granted = (scope ?? '').split(/[,\s]+/);
    return {
      google: {
        linked: scope !== undefined,
        contactsScope: CONTACT_SCOPES.every((s) => granted.includes(s)),
      },
      contacts: {
        total: counts.total,
        onIndex: counts.onIndex,
        lastImportAt: counts.lastImportAt?.toISOString() ?? null,
      },
    };
  }

  /** Pull saved contacts and people-you've-emailed from Google, then match them to Index accounts. */
  async importContacts(userId: string): Promise<ImportOutcome> {
    const status = await this.status(userId);
    if (!status.google.linked) return { kind: 'not_linked' };
    if (!status.google.contactsScope) return { kind: 'missing_scope' };

    let accessToken: string;
    try {
      const tokens = await auth.api.getAccessToken({ body: { providerId: 'google', userId } });
      accessToken = tokens.accessToken;
    } catch (error) {
      logger.warn('Google access token unavailable', { userId, error: String(error) });
      return { kind: 'missing_scope' };
    }

    const rows = new Map<string, ContactInput>();
    const add = (people: GooglePerson[], source: ContactInput['source']) => {
      for (const person of people) {
        const org = person.organizations?.[0];
        for (const address of person.emailAddresses ?? []) {
          const email = address.value?.trim().toLowerCase();
          if (!email || !email.includes('@') || rows.has(email)) continue;
          rows.set(email, {
            email,
            name: person.names?.[0]?.displayName?.trim() || null,
            organization: org?.name?.trim() || null,
            title: org?.title?.trim() || null,
            source,
          });
        }
      }
    };

    const saved = await this.fetchAll(accessToken, '/people/me/connections', { personFields: 'names,emailAddresses,organizations' }, 'connections');
    if ('status' in saved) return { kind: 'google_error', status: saved.status };
    add(saved.people, 'google_contacts');

    const other = await this.fetchAll(accessToken, '/otherContacts', { readMask: 'names,emailAddresses' }, 'otherContacts');
    if ('status' in other) return { kind: 'google_error', status: other.status };
    add(other.people, 'google_other');

    await this.adapter.upsertContacts(userId, [...rows.values()]);
    this.invalidatePairs(userId);
    const counts = await this.adapter.contactCounts(userId);
    logger.info('Contacts imported', { userId, total: counts.total, onIndex: counts.onIndex });
    return { kind: 'ok', total: counts.total, onIndex: counts.onIndex };
  }

  private async fetchAll(
    accessToken: string,
    path: string,
    params: Record<string, string>,
    listKey: 'connections' | 'otherContacts',
  ): Promise<{ people: GooglePerson[] } | { status: number }> {
    const people: GooglePerson[] = [];
    let pageToken: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ ...params, pageSize: '1000', ...(pageToken ? { pageToken } : {}) });
      const res = await fetch(`${PEOPLE_API}${path}?${query}`, { headers: { Authorization: `Bearer ${accessToken}` } });
      if (!res.ok) {
        logger.warn('Google People API refused', { path, status: res.status });
        return { status: res.status };
      }
      const body = await res.json() as { nextPageToken?: string } & Record<string, GooglePerson[] | undefined>;
      people.push(...(body[listKey] ?? []));
      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }
    return { people };
  }

  private readonly pairCache = new Map<string, { at: number; pairs: PairSuggestion[] }>();

  /** Forget a member's screened pairs, e.g. after a fresh import. */
  invalidatePairs(userId: string): void {
    this.pairCache.delete(userId);
  }

  /**
   * Pairs the member could introduce, contacts first. Similar intents are not
   * the same as a reason to meet, so a model screens the closest candidates
   * for pairs where one person can help the other, and drafts the intro.
   * Without a model it falls back to the closest pairs and a plain draft.
   */
  async pairs(userId: string): Promise<PairSuggestion[]> {
    const cached = this.pairCache.get(userId);
    if (cached && Date.now() - cached.at < PAIRS_TTL_MS) return cached.pairs;

    const candidates = await this.adapter.pairCandidates(userId, CANDIDATE_LIMIT);
    const toPair = (c: PairCandidate, draft: string): PairSuggestion => ({
      key: `${c.a.intentId}:${c.b.intentId}`,
      networkId: c.networkId,
      networkTitle: c.networkTitle,
      score: c.score,
      a: c.a,
      b: c.b,
      draft,
    });
    const plainDraft = (c: PairCandidate) =>
      `${firstName(c.a.name)}, ${firstName(c.b.name)}: I think you two should talk. ${firstName(c.a.name)} is after "${clip(c.a.intentText, 90)}", and ${firstName(c.b.name)} is after "${clip(c.b.intentText, 90)}".`;

    let pairs: PairSuggestion[];
    try {
      pairs = candidates.length ? await this.screen(candidates, toPair) : [];
    } catch (error) {
      logger.warn('Pair screen failed; using closest pairs', { userId, error: String(error) });
      pairs = candidates.slice(0, PAIR_LIMIT).map((c) => toPair(c, plainDraft(c)));
    }
    this.pairCache.set(userId, { at: Date.now(), pairs });
    return pairs;
  }

  private async screen(
    candidates: PairCandidate[],
    toPair: (c: PairCandidate, draft: string) => PairSuggestion,
  ): Promise<PairSuggestion[]> {
    const list = candidates.map((c, i) =>
      `${i}. ${firstName(c.a.name)} wants: ${clip(c.a.intentText, 300)}\n   ${firstName(c.b.name)} wants: ${clip(c.b.intentText, 300)}`).join('\n');
    const { output } = await generateText({
      model: introModel(),
      output: Output.object({ schema: screenSchema }),
      prompt: [
        'You help someone decide which two people they know to introduce to each other.',
        'Each numbered pair below is two people and what each wants right now.',
        'Keep a pair only when meeting would plausibly move at least one of them toward what they want:',
        'one can offer what the other is looking for, or they want to build or do the same specific thing together.',
        'Drop pairs that merely share a topic, both want the same scarce thing (two people both raising, both job hunting, both traveling), or are vague.',
        `Return at most ${PAIR_LIMIT}, strongest first. For each, write the intro the introducer will send to both people.`,
        '',
        list,
      ].join('\n'),
    });
    const seen = new Set<number>();
    return (output?.pairs ?? [])
      .filter((p) => p.i >= 0 && p.i < candidates.length && !seen.has(p.i) && seen.add(p.i))
      .slice(0, PAIR_LIMIT)
      .map((p) => toPair(candidates[p.i]!, p.intro.trim()));
  }

  async introductions(userId: string, opportunityId?: string): Promise<IntroductionProgress[]> {
    const rows = await this.adapter.introductions(userId, opportunityId);
    const negotiationIds = rows.map((r) => r.negotiationId).filter((id): id is string => !!id);
    const [turns, events] = await Promise.all([
      this.adapter.turnMeta(negotiationIds),
      this.adapter.eventMeta(rows.map((r) => r.opportunityId)),
    ]);

    return rows.map((row) => {
      const sideOf = (id: string | null): StepSide => (id === row.a.userId ? 'a' : id === row.b.userId ? 'b' : 'both');
      const steps: ProgressStep[] = [];
      for (const e of events.filter((x) => x.opportunityId === row.opportunityId)) {
        const kind = e.type as ProgressStep['kind'];
        steps.push({ side: e.type === 'opened' ? 'you' : sideOf(e.actorUserId), kind, at: e.at.toISOString() });
      }
      for (const t of turns.filter((x) => x.negotiationId === row.negotiationId)) {
        steps.push({ side: sideOf(t.seatUserId), kind: 'turn', action: t.action, turn: t.turnIndex + 1, at: t.at.toISOString() });
      }
      if (!steps.some((s) => s.kind === 'opened')) {
        steps.push({ side: 'you', kind: 'opened', at: row.createdAt.toISOString() });
      }
      steps.sort((x, y) => x.at.localeCompare(y.at) || (x.kind === 'opened' ? -1 : y.kind === 'opened' ? 1 : 0));

      const phase: IntroductionProgress['phase'] =
        row.status === 'accepted' ? 'accepted'
          : row.status === 'rejected' ? 'declined'
            : row.status === 'expired' ? 'expired'
              : row.status === 'pending' ? 'agreed'
                : 'negotiating';
      const awaiting = row.awaitingUserId === row.a.userId ? 'a' : row.awaitingUserId === row.b.userId ? 'b' : null;
      return {
        opportunityId: row.opportunityId,
        status: row.status,
        createdAt: row.createdAt.toISOString(),
        context: row.context,
        a: row.a,
        b: row.b,
        awaiting,
        phase,
        steps,
      };
    });
  }
}

export const introducerService = new IntroducerService();
