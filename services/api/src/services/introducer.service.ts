import { createModel, type Model } from '@indexnetwork/agent';
import { decideNegotiationOpening, identityPairKeyOf } from '@indexnetwork/protocol';
import { generateText, jsonSchema, Output } from 'ai';

import { auth } from '../lib/betterauth/auth.instance';
import { executeSendEmail } from '../lib/email/transport.helper';
import { escapeHtml } from '../lib/escapeHtml';
import { GMAIL_SCOPE, sentFrequency } from '../lib/introducer/gmail-frequency';
import { judgePair } from '../lib/introducer/judge';
import { researchPerson } from '../lib/introducer/research';
import { log } from '../lib/log';
import { appendClientOpportunityEvent } from '../lib/opportunity/opportunity.command';
import { publishUserEvent, type UserEvent } from '../lib/user-events';
import { EmbedderAdapter } from '../adapters/embedder.adapter';
import { detectSocialLabel } from '../adapters/database.shared';
import { negotiationDatabaseAdapter } from '../adapters/negotiation.database.adapter';
import { introducerDatabaseAdapter, type ContactCard, type ContactInput, type IntroducerDatabaseAdapter, type IntroductionRow, type ContactFilter, type ContactListRow, type MatchCandidate, type ProposalRow } from '../adapters/introducer.database.adapter';

const logger = log.service.from('IntroducerService');

/** Read access to saved contacts and to "other contacts" (people you've emailed). */
export const CONTACT_SCOPES = [
  'https://www.googleapis.com/auth/contacts.readonly',
  'https://www.googleapis.com/auth/contacts.other.readonly',
] as const;

const PEOPLE_API = 'https://people.googleapis.com/v1';
/** Google caps a page at 1000; 10 pages per source is plenty for a preview. */
const MAX_PAGES = 10;
/** Contacts are re-read from Google in the background once the last sync is this old. */
const SYNC_EVERY_MS = 24 * 60 * 60_000;
/** Below this cosine similarity a card and an intent are not worth a screen. */
const MATCH_FLOOR = 0.2;
/** Contacts read per new intent, across everyone who can introduce it. */
const PER_INTENT = 24;
/** Research: emails per sweep, how many run at once, and tries before giving up. */
const RESEARCH_PER_SWEEP = 10;
const RESEARCH_CONCURRENCY = 3;
const RESEARCH_ATTEMPTS = 3;
/** Intents read per newly synced contact. */
const PER_CONTACT = 3;
/** Pairs one screen call judges. */
const SCREEN_BATCH = 15;
const EMBED_BATCH = 64;
const INTRODUCER_REASONING = 'Opened by a third party who knows the second person; that person is not on Index.';
const WEB_APP_URL = process.env.WEB_APP_URL ?? 'https://index.network';

let screenModel: Model | null = null;
function introModel(): Model {
  screenModel ??= createModel({
    apiKey: process.env.OPENROUTER_API_KEY,
    headers: { 'HTTP-Referer': 'https://index.network/introduce', 'X-Title': 'Index Intro Desk' },
  });
  return screenModel;
}

interface ScreenResult {
  pairs: { i: number; member: string; contact: string; intro: string }[];
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
          member: { type: 'string', description: 'At most 6 words completing "<member first name> …" with what they need, e.g. "needs a payments design partner". Lowercase, no period.' },
          contact: { type: 'string', description: 'At most 6 words completing "<contact first name> …" with who they are for this pair, from their card only, e.g. "runs checkout at Stripe". Lowercase, no period.' },
          intro: { type: 'string', description: "Two short sentences in the introducer's voice to both people, first names, saying concretely why they should talk. Claim nothing about the contact beyond their card. No flattery, no emoji." },
        },
        required: ['i', 'member', 'contact', 'intro'],
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
  google: { linked: boolean; contactsScope: boolean; gmailScope: boolean };
  contacts: { total: number; onIndex: number; lastImportAt: string | null };
}

/**
 * A proposal on the Intro Desk: an opportunity nobody has opened yet, in the
 * opportunity format (`detection`, `actors`, `interpretation`, `context`,
 * `confidence`), plus what the card shows. The contact's actor has
 * `contactId` and `via` until opening seats them.
 */
export interface OpportunityProposalView {
  id: string;
  status: ProposalRow['status'];
  /** Why opening failed, said to the introducer. */
  failure: string | null;
  detection: ProposalRow['detection'];
  actors: ProposalRow['actors'];
  interpretation: ProposalRow['interpretation'];
  context: ProposalRow['context'];
  confidence: number;
  opportunityId: string | null;
  networkTitle: string;
  member: { userId: string; name: string; avatar: string | null; line: string; intentText: string };
  contact: { id: string; name: string; line: string; detail: string | null };
  /** The draft intro, `metadata.introducer.context` once opened. */
  draft: string;
}

/** A contact in the owner's contacts list. Only the owner ever reads these. */
export interface ContactView {
  id: string;
  name: string;
  email: string;
  detail: string | null;
  source: 'saved' | 'emailed';
  onIndex: boolean;
  excluded: boolean;
  proposals: number;
}

type EmailAccount = NonNullable<Awaited<ReturnType<IntroducerDatabaseAdapter['accountByEmail']>>>;

/** What researching an email, or taking its existing account, came to. */
type SeatOutcome =
  | { kind: 'seated'; userId: string }
  | { kind: 'on_index' | 'opted_out' | 'not_found' }
  | { kind: 'unavailable'; attempts: number };

export type WakeOutcome = { kind: 'ok' } | { kind: 'not_found' } | { kind: 'busy' } | { kind: 'gone' };

/**
 * What an introducer learns about an introduction: where it ended up, never
 * how. No turns, no whose-move, no wording, and a "no fit" never says which
 * side or whether an agent or a person said it. `private` means it left the
 * talks and one of the two keeps the outcome from introducers (their
 * `introducerReports` setting is `none`).
 */
export type IntroductionPhase = 'talking' | 'agreed' | 'met' | 'no_fit' | 'quiet' | 'private';

/** A note one side sent back. It never says which side. */
export interface IntroductionReport {
  note: string;
  at: string;
}

export interface IntroductionProgress {
  opportunityId: string;
  createdAt: string;
  /** When its status was last written. */
  updatedAt: string;
  context: string;
  a: IntroductionRow['a'];
  b: IntroductionRow['b'];
  phase: IntroductionPhase;
  reports: IntroductionReport[];
}

/** The phase an opportunity status reads as, before anyone's setting hides it. */
export function phaseOf(status: string): Exclude<IntroductionPhase, 'private'> {
  return status === 'accepted' ? 'met'
    : status === 'rejected' ? 'no_fit'
      : status === 'expired' ? 'quiet'
        : status === 'pending' ? 'agreed'
          : 'talking';
}

/** Longest note a seat may send its introducer. */
export const REPORT_NOTE_MAX = 280;

const INTRODUCE_URL = `${(process.env.WEB_APP_URL || 'https://index.network').replace(/\/+$/, '')}/introduce`;

const PHASE_LABEL: Record<IntroductionPhase, string> = {
  talking: 'talking',
  agreed: 'agreed',
  met: 'met',
  no_fit: 'no fit',
  quiet: 'went quiet',
  private: 'ended',
};

/** One line on where an introduction is, as the Introduce page says it. */
export function phaseLine(p: Pick<IntroductionProgress, 'a' | 'b' | 'phase'>): string {
  const A = firstName(p.a.name), B = firstName(p.b.name);
  switch (p.phase) {
    case 'talking': return 'Both agents are awake and talking privately.';
    case 'agreed': return `The agents agreed. Now it's up to ${A} and ${B}.`;
    case 'met': return `${A} and ${B} both said yes. They're connected.`;
    case 'no_fit': return "It wasn't a fit. Nothing more happens.";
    case 'quiet': return 'It went quiet before both said yes.';
    case 'private': return 'It ended. One of them keeps how it went private.';
  }
}

export type ReportResult = { id: string } | { error: string; status: number };



interface GooglePerson {
  names?: { displayName?: string }[];
  emailAddresses?: { value?: string }[];
  organizations?: { name?: string; title?: string }[];
}

const FAILURES = {
  on_index: 'They joined Index since; their agent can find this on its own.',
  opted_out: 'They asked Index not to contact them.',
  not_found: "We couldn't find them online.",
  research_unavailable: "We couldn't look them up. Try again later.",
  not_visible: "That intent isn't public in a network you share any more.",
  not_opened: "The agents couldn't be woken. Try again.",
} as const;

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

function clip(text: string, max: number): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  return flat.length > max ? `${flat.slice(0, max - 1).trimEnd()}…` : flat;
}

function contactName(card: ContactCard): string {
  return card.name?.trim() || card.email.split('@')[0]!;
}

/** The card the matcher embeds and the screen reads: name, role, company, work domain. */
function cardText(card: ContactCard): string {
  const domain = card.email.split('@')[1] ?? '';
  const role = [card.title, card.organization].filter(Boolean).join(', ');
  return [contactName(card), role || null, domain ? `(${domain})` : null].filter(Boolean).join(' — ');
}

/**
 * The introducer. A member's Google contacts are matched, in the background,
 * against public intents in the networks they share; the member picks a pair
 * on the Intro Desk and wakes it. The contact is reached through the member,
 * one hop, never through a network: their seat is in no network, discovery
 * never returns it, and nobody but the introducer can reach them. Progress is
 * the introduction's phase only.
 */
export class IntroducerService {
  private readonly embedder = new EmbedderAdapter();
  private readonly syncing = new Set<string>();

  constructor(private readonly adapter: IntroducerDatabaseAdapter = introducerDatabaseAdapter) {}

  // ─── contacts ──────────────────────────────────────────────────────────────

  async status(userId: string): Promise<IntroducerStatus> {
    const [account, counts] = await Promise.all([
      this.adapter.googleAccount(userId),
      this.adapter.contactCounts(userId),
    ]);
    const granted = (account?.scope ?? '').split(/[,\s]+/);
    return {
      google: {
        linked: account !== undefined,
        // Google access tokens last an hour. Without a refresh token the grant
        // is spent once that hour is up, so ask the member to connect again.
        contactsScope: !!account?.usable && CONTACT_SCOPES.every((s) => granted.includes(s)),
        gmailScope: !!account?.usable && granted.includes(GMAIL_SCOPE),
      },
      contacts: {
        total: counts.total,
        onIndex: counts.onIndex,
        lastImportAt: counts.lastImportAt?.toISOString() ?? null,
      },
    };
  }

  /**
   * Keep contacts current without a button: once the last sync is a day old,
   * read Google again in the background. Contacts removed there go here too.
   */
  syncIfStale(userId: string, status: IntroducerStatus): void {
    const last = status.contacts.lastImportAt;
    if (!status.google.contactsScope || !last || Date.now() - Date.parse(last) < SYNC_EVERY_MS) return;
    void this.importContacts(userId).catch((error) => logger.warn('Background contact sync failed', { userId, error: String(error) }));
  }

  /**
   * Read saved contacts and people-you've-emailed from Google, make the stored
   * list match, and mark who is already on Index. Runs on connect, then daily.
   * Matching the new contacts continues in the background.
   */
  async importContacts(userId: string): Promise<ImportOutcome> {
    if (this.syncing.has(userId)) {
      const counts = await this.adapter.contactCounts(userId);
      return { kind: 'ok', total: counts.total, onIndex: counts.onIndex };
    }
    this.syncing.add(userId);
    try {
      const outcome = await this.syncContacts(userId);
      if (outcome.kind === 'ok') {
        void this.matchContacts(userId).catch((error) => logger.warn('Matching new contacts failed', { userId, error: String(error) }));
      }
      return outcome;
    } finally {
      this.syncing.delete(userId);
    }
  }

  private async syncContacts(userId: string): Promise<ImportOutcome> {
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
    if ('status' in saved) return saved.status === 401 ? { kind: 'missing_scope' } : { kind: 'google_error', status: saved.status };
    add(saved.people, 'google_contacts');

    const other = await this.fetchAll(accessToken, '/otherContacts', { readMask: 'names,emailAddresses' }, 'otherContacts');
    if ('status' in other) return other.status === 401 ? { kind: 'missing_scope' } : { kind: 'google_error', status: other.status };
    add(other.people, 'google_other');

    await this.adapter.replaceContacts(userId, [...rows.values()]);
    // Gmail is optional: without it, saved contacts rank before people you've only emailed.
    const frequency = process.env.INTRODUCER_GMAIL === '1' && status.google.gmailScope ? await sentFrequency(accessToken) : null;
    await this.adapter.rankContacts(userId, frequency);
    const counts = await this.adapter.contactCounts(userId);
    logger.info('Contacts synced', { userId, total: counts.total, onIndex: counts.onIndex });
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

  // ─── matching (background) ─────────────────────────────────────────────────

  /** Embed contact cards that have none yet. @returns The ids embedded. */
  async embedContacts(limit: number, ownerUserId?: string): Promise<string[]> {
    const done: string[] = [];
    while (done.length < limit) {
      const cards = await this.adapter.contactsToEmbed(Math.min(EMBED_BATCH, limit - done.length), ownerUserId);
      if (!cards.length) break;
      const vectors = await this.embedder.generate(cards.map(cardText)) as number[][];
      await this.adapter.setContactEmbeddings(cards.map((card, i) => ({ id: card.id, embedding: vectors[i]! })));
      done.push(...cards.map((c) => c.id));
      if (cards.length < EMBED_BATCH) break;
    }
    return done;
  }

  /** After a sync: embed this member's new cards and match them to intents they can see. */
  async matchContacts(userId: string): Promise<number> {
    const ids = await this.embedContacts(5000, userId);
    let kept = 0;
    for (let i = 0; i < ids.length; i += 200) {
      const candidates = await this.adapter.candidatesForContacts(userId, ids.slice(i, i + 200), PER_CONTACT);
      kept += await this.screenAndStore(candidates);
    }
    if (ids.length) logger.info('Matched new contacts', { userId, embedded: ids.length, kept });
    return kept;
  }

  /** A new public intent: find who, among the members who can see it, knows someone for it. */
  async matchIntent(intentId: string): Promise<number> {
    const candidates = await this.adapter.candidatesForIntent(intentId, PER_INTENT);
    return this.screenAndStore(candidates);
  }

  private async screenAndStore(all: MatchCandidate[]): Promise<number> {
    const candidates = all.filter((c) => c.score >= MATCH_FLOOR);
    let kept = 0;
    for (let i = 0; i < candidates.length; i += SCREEN_BATCH) {
      const batch = candidates.slice(i, i + SCREEN_BATCH);
      try {
        const rows = await this.screen(batch);
        await this.adapter.insertProposals(rows);
        kept += rows.length;
      } catch (error) {
        logger.warn('Pair screen failed', { error: String(error), size: batch.length });
      }
    }
    return kept;
  }

  private async screen(batch: MatchCandidate[]) {
    const list = batch.map((c, i) =>
      `${i}. ${firstName(c.member.name)} wants: ${clip(c.member.intentText, 300)}\n   Contact: ${cardText(c.contact)}`).join('\n');
    const { output } = await generateText({
      model: introModel(),
      output: Output.object({ schema: screenSchema }),
      prompt: [
        'Someone is deciding which people from their address book to introduce to members of their network.',
        'Each numbered item is a member and what they want, then one of the introducer\'s contacts as their address book has them: name, role, company, email domain.',
        'Keep an item only when the contact\'s role or company makes them plausibly useful for what the member wants: they could offer it, decide on it, or build it with them.',
        'Drop items where the card is too thin to tell, the fit is only a shared topic, or the contact would want the same scarce thing as the member.',
        'For each kept item write the two short lines and the intro.',
        '',
        list,
      ].join('\n'),
    });
    const seen = new Set<number>();
    return (output?.pairs ?? [])
      .filter((p) => p.i >= 0 && p.i < batch.length && !seen.has(p.i) && seen.add(p.i))
      .map((p) => {
        const c = batch[p.i]!;
        return {
          introducerUserId: c.introducerUserId,
          intentId: c.member.intentId,
          contactId: c.contact.id,
          networkId: c.networkId,
          memberUserId: c.member.userId,
          score: c.score,
          intentLine: clip(p.member, 80),
          contactLine: clip(p.contact, 80),
          draft: clip(p.intro, 1000),
        };
      });
  }

  private sweepCursor = new Date(Date.now() - 60 * 60_000);
  private sweeping = false;
  private researching = false;

  /**
   * The background pass, every few minutes: embed contact cards still
   * missing one, match public intents created since the last pass, start
   * researching contacts with new pairs beside the pass, and email contacts
   * a member said yes to. Every step is idempotent, so a missed or repeated
   * pass is harmless.
   */
  async sweep(): Promise<void> {
    if (this.sweeping) return;
    this.sweeping = true;
    try {
      await this.embedContacts(500);
      const fresh = await this.adapter.publicIntentsSince(this.sweepCursor, 100);
      for (const intent of fresh) {
        await this.matchIntent(intent.id).catch((error) => logger.warn('Matching an intent failed', { intentId: intent.id, error: String(error) }));
        this.sweepCursor = intent.createdAt;
      }
      // Research makes slow paid calls: it runs on its own, never holding up matching or outreach.
      void this.researchStep().catch((error) => logger.warn('Contact research step failed', { error: String(error) }));
      await this.outreach();
    } finally {
      this.sweeping = false;
    }
  }

  // ─── research ──────────────────────────────────────────────────────────────

  /**
   * Research each contact with a checking pair once per email: make the
   * identity-only seat, or settle the pairs when there is no one to find.
   * At most 10 emails per pass, 3 at a time; a pass still running skips the next.
   */
  async researchStep(): Promise<void> {
    if (this.researching || !process.env.PARALLELS_API_KEY) return;
    this.researching = true;
    try {
      const due = await this.adapter.checkingDue(RESEARCH_PER_SWEEP);
      let next = 0;
      const worker = async () => {
        while (next < due.length) {
          const item = due[next++]!;
          await this.researchEmail(item.email, item.contact).catch((error) => logger.warn('Researching a contact failed', { error: String(error) }));
        }
      };
      await Promise.all(Array.from({ length: Math.min(RESEARCH_CONCURRENCY, due.length) }, worker));
    } finally {
      this.researching = false;
    }
  }

  private async researchEmail(email: string, contact: ContactCard): Promise<void> {
    const settle = async (reason: keyof typeof FAILURES) => {
      for (const proposal of await this.adapter.proposalsForEmail(email, 'checking')) {
        await this.adapter.setProposal(proposal.id, { status: 'unmatched', failure: FAILURES[reason] });
      }
    };
    const existing = await this.adapter.accountByEmail(email);
    const status = await this.adapter.researchStatus(email);
    if (status === 'found') {
      // Researched before: judge its pairs without researching again, unless the ghost has become a real account.
      if (existing?.deleted) return settle('opted_out');
      if (existing?.emailVerified) return settle('on_index');
      if (!await this.adapter.foundSeatId(email)) {
        // The ghost is gone: research this email again later.
        await this.adapter.clearResearch(email);
        return;
      }
      return this.judgeEmail(email);
    }
    // Researched before and found nothing: final, so a new pair settles at once.
    if (!existing && status === 'not_found') return settle('not_found');
    const seat = existing ? await this.adoptAccount(email, existing) : await this.researchAndSeat(email, contact);
    switch (seat.kind) {
      case 'seated':
        return this.judgeEmail(email);
      case 'unavailable':
        if (seat.attempts >= RESEARCH_ATTEMPTS) {
          await settle('research_unavailable');
          await this.adapter.resetResearchAttempts(email);
        }
        return;
      default:
        return settle(seat.kind);
    }
  }

  /**
   * Research one email and seat whoever it finds: an identity-only ghost,
   * recorded per email. Every try is counted before the paid call, so one
   * that fails or loses its seat afterwards is never researched again for
   * free; found nothing is recorded as final. An account that appeared
   * meanwhile is taken as it is.
   * The card is the introducer's own address book: a hint for research to
   * find the right person, never copied onto the seat.
   */
  private async researchAndSeat(email: string, contact: ContactCard): Promise<SeatOutcome> {
    // No API key: nothing would run, so it is not a try.
    if (!process.env.PARALLELS_API_KEY) return { kind: 'unavailable', attempts: 0 };
    const attempts = await this.adapter.recordAttempt(email);
    const unavailable = (reason: string): SeatOutcome => {
      logger.info('Contact research', { outcome: 'unavailable', reason, attempts });
      return { kind: 'unavailable', attempts };
    };
    const research = await researchPerson({ name: contact.name, email, organization: contact.organization, title: contact.title });
    if (research.kind === 'unavailable') return unavailable(research.reason);
    if (research.kind === 'not_found') {
      await this.adapter.recordResearch(email, 'not_found');
      logger.info('Contact research', { outcome: 'not_found' });
      return { kind: 'not_found' };
    }
    try {
      const created = await this.adapter.createSeat({
        email,
        name: publicName(research.name) ?? nameFromEmail(email),
        intro: research.headline.trim() || null,
        socials: profileLinks(research.socials),
      });
      if (created) {
        await this.adapter.recordResearch(email, 'found', created.userId);
        logger.info('Contact research', { outcome: 'found' });
        return { kind: 'seated', userId: created.userId };
      }
      // An account appeared while we researched: treat it as any existing one.
      const existing = await this.adapter.accountByEmail(email);
      if (!existing) {
        logger.warn('Seat not created and no account found');
        return unavailable('lost');
      }
      return await this.adoptAccount(email, existing);
    } catch (error) {
      // The try is already counted: let the attempt limit settle it like any other failure.
      logger.warn('Seating a researched contact failed', { error: String(error) });
      return unavailable('seat_failed');
    }
  }

  /**
   * An account the email already has. Claimed or deleted is final; an
   * unclaimed one (an earlier seat) is the seat as it is, intents untouched.
   */
  private async adoptAccount(email: string, account: EmailAccount): Promise<SeatOutcome> {
    if (account.deleted) return { kind: 'opted_out' };
    if (account.emailVerified) return { kind: 'on_index' };
    await this.adapter.recordResearch(email, 'found', account.id);
    logger.info('Contact research', { outcome: 'existing' });
    return { kind: 'seated', userId: account.id };
  }

  /**
   * Judge each checking pair of a found email both ways: worth it to both,
   * it goes to the desk; not, it settles; no verdict, it stays checking for
   * the next sweep. A pair whose intent is private now is left alone.
   */
  private async judgeEmail(email: string): Promise<void> {
    let unsettled = false;
    for (const proposal of await this.adapter.proposalsForEmail(email, 'checking')) {
      const input = await this.adapter.judgeInput(proposal.id, email);
      if (!input) { unsettled = true; continue; }
      const judgment = await judgePair(input);
      logger.info('Pair judged', { proposalId: proposal.id, mutual: judgment ? judgment.mutual : null });
      if (!judgment) { unsettled = true; continue; }
      if (!judgment.mutual) {
        await this.adapter.unmatchProposal(proposal.id, 'not mutual');
        continue;
      }
      await this.adapter.promoteProposal(proposal.id, {
        confidence: judgment.rank / 100,
        card: { member: judgment.memberLine, contact: judgment.contactLine },
        draft: judgment.draft,
        judgment: { memberGets: judgment.memberGets, contactGets: judgment.contactGets },
      });
    }
    // Pairs left checking come back after 30 minutes, not every sweep.
    if (unsettled) await this.adapter.touchResearch(email);
  }

  // ─── the desk ──────────────────────────────────────────────────────────────

  async proposals(userId: string): Promise<OpportunityProposalView[]> {
    const rows = await this.adapter.proposals(userId);
    return rows.map(toProposalView);
  }

  async skip(userId: string, id: string): Promise<boolean> {
    return this.adapter.claimProposal(id, userId, ['proposed', 'failed'], 'skipped');
  }

  // ─── contacts list ─────────────────────────────────────────────────────────

  async contacts(userId: string, options: { q?: string; filter: ContactFilter; offset: number }): Promise<{ contacts: ContactView[]; total: number }> {
    const { rows, total } = await this.adapter.listContacts(userId, { ...options, limit: 50 });
    return { total, contacts: rows.map(toContactView) };
  }

  /** Never propose this contact, or allow it again. */
  async setExcluded(userId: string, contactId: string, excluded: boolean): Promise<boolean> {
    return this.adapter.setExcluded(userId, contactId, excluded);
  }

  /** Members this introducer said never to suggest. */
  async excludedMembers(userId: string): Promise<{ userId: string; name: string; avatar: string | null }[]> {
    return this.adapter.excludedMembers(userId);
  }

  /** Never propose pairs with this member, or allow them again. */
  async setMemberExcluded(userId: string, memberUserId: string, excluded: boolean): Promise<boolean> {
    return this.adapter.setMemberExcluded(userId, memberUserId, excluded);
  }

  /** Remove one contact from the owner's list for good; a later sync won't bring it back. */
  async removeContact(userId: string, contactId: string): Promise<boolean> {
    return this.adapter.removeContact(userId, contactId);
  }

  /**
   * Delete every imported contact and the proposals made from them. Nothing
   * syncs again until the member reads their contacts again; introductions
   * already opened are kept.
   */
  async deleteContacts(userId: string): Promise<number> {
    const deleted = await this.adapter.deleteContacts(userId);
    logger.info('Contacts deleted by owner', { userId, deleted });
    return deleted;
  }

  /**
   * Wake a pair. Returns at once; the contact is looked up and seated, and
   * both agents woken, in the background. The desk polls the proposal.
   */
  async wake(userId: string, id: string, context: string): Promise<WakeOutcome> {
    const [row] = await this.adapter.proposals(userId, id);
    if (!row) return { kind: 'not_found' };
    if (!await this.adapter.canIntroduce(userId, row.member.intentId, row.networkId)) {
      await this.adapter.setProposal(id, { status: 'failed', failure: FAILURES.not_visible });
      return { kind: 'gone' };
    }
    if (!await this.adapter.claimProposal(id, userId, ['proposed', 'failed'], 'opening')) return { kind: 'busy' };
    void this.seatAndOpen(userId, row, context).catch(async (error) => {
      logger.error('Opening a proposal failed', { proposalId: id, error: String(error) });
      await this.adapter.setProposal(id, { status: 'failed', failure: FAILURES.not_opened });
    });
    return { kind: 'ok' };
  }

  /**
   * Open the pair as an intent-to-identity opportunity: the member's intent
   * on one side, the contact's ghost as a person on the other, reached only
   * through the introducer. The ghost is the one research recorded for the
   * email. A pair proposed before research existed may have none: an earlier
   * unclaimed seat is taken as it is (its intents stay, unused), and an email
   * never researched is researched now. Other pairs are left alone.
   */
  private async seatAndOpen(introducerUserId: string, row: ProposalRow, context: string): Promise<void> {
    const fail = (reason: keyof typeof FAILURES) => this.adapter.setProposal(row.id, { status: 'failed', failure: FAILURES[reason] });
    const email = row.contact.email;
    const existing = await this.adapter.accountByEmail(email);
    if (existing?.emailVerified && !existing.deleted) return fail('on_index');
    if (existing?.deleted) return fail('opted_out');

    let seatUserId = await this.adapter.foundSeatId(email);
    if (!seatUserId) {
      if (!existing && await this.adapter.researchStatus(email) === 'not_found') return fail('not_opened');
      const seat = existing ? await this.adoptAccount(email, existing) : await this.researchAndSeat(email, row.contact);
      // A third failed try would keep this email out of the research step: start the count over, as the step does.
      if (seat.kind === 'unavailable' && seat.attempts >= RESEARCH_ATTEMPTS) await this.adapter.resetResearchAttempts(email);
      if (seat.kind === 'on_index' || seat.kind === 'opted_out') return fail(seat.kind);
      if (seat.kind !== 'seated') return fail('not_opened');
      seatUserId = seat.userId;
    }

    // One negotiation per introducer: the ghost is reachable only through the introducer who holds its email.
    const pairKey = identityPairKeyOf(`via:${introducerUserId}`, row.member.intentId, seatUserId);
    await negotiationDatabaseAdapter.openCounterparties([{
      pairKey,
      networkId: row.networkId,
      intentA: row.member.intentId,
      intentB: null,
      userA: row.member.userId,
      userB: seatUserId,
      score: 100,
      reasoning: INTRODUCER_REASONING,
      evidence: [],
      detection: { source: 'introducer', createdBy: introducerUserId },
      introducer: { userId: introducerUserId, context },
      via: introducerUserId,
    }], decideNegotiationOpening);
    const opened = await negotiationDatabaseAdapter.findByPairKey(pairKey);
    if (!opened) return fail('not_opened');
    await this.adapter.markOpened(row.id, seatUserId, context, opened.opportunityId);
    logger.info('Proposal opened', { proposalId: row.id, opportunityId: opened.opportunityId });
  }

  // ─── after the agents ──────────────────────────────────────────────────────

  /** The member said yes: tell the contact, as the introducer, once. */
  private async outreach(): Promise<void> {
    for (const row of await this.adapter.outreachDue(20)) {
      try {
        const result = await executeSendEmail({ to: row.email, ...introEmail(row), userId: row.seatUserId }) as { skipped?: boolean };
        if (result.skipped) continue;
        await this.adapter.markOpportunity(row.opportunityId, 'introOutreachAt');
        logger.info('Introduced contact emailed', { opportunityId: row.opportunityId });
      } catch (error) {
        logger.error('Introduction email failed', { opportunityId: row.opportunityId, error: String(error) });
      }
    }
  }

  // ─── progress ──────────────────────────────────────────────────────────────

  async introductions(userId: string, opportunityId?: string): Promise<IntroductionProgress[]> {
    const rows = await this.adapter.introductions(userId, opportunityId);
    const [settings, reports] = await Promise.all([
      this.adapter.reportSettings([...new Set(rows.flatMap((row) => [row.a.userId, row.b.userId]))]),
      this.adapter.reports(rows.map((row) => row.opportunityId)),
    ]);
    return rows.map((row) => {
      const phase = phaseOf(row.status);
      // Talks in progress are no news: the introducer opened them. Where they
      // ended up is shared only if neither side turned that off.
      const hidden = phase !== 'talking' && (settings.get(row.a.userId) === 'none' || settings.get(row.b.userId) === 'none');
      return {
        opportunityId: row.opportunityId,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        context: row.context,
        a: row.a,
        b: row.b,
        phase: hidden ? 'private' : phase,
        reports: hidden ? [] : (reports.get(row.opportunityId) ?? []).map((r) => ({ note: r.note, at: r.at.toISOString() })),
      };
    });
  }

  // ─── reporting back ────────────────────────────────────────────────────────

  /**
   * File a seat's note to the introducer: an opportunity event of type
   * `report`. Once per seat, after its negotiation settled, and only when the
   * seat owner's `introducerReports` setting is `note`. The introducer never
   * learns which side sent it.
   *
   * @param opportunityId - The opportunity.
   * @param userId - The seat's owner.
   * @param data - The event's data: `{ note }`.
   */
  async fileReport(opportunityId: string, userId: string, data: Record<string, unknown> | null): Promise<ReportResult> {
    const target = await this.adapter.reportTarget(opportunityId);
    if (!target || !target.actorIds.includes(userId)) return { error: 'Opportunity not found', status: 404 };
    if (!target.introducerUserId) return { error: 'Nobody introduced this pair, so there is nobody to report to', status: 409 };
    if (target.status === 'negotiating') return { error: 'Report once the negotiation has settled', status: 409 };
    const note = typeof data?.note === 'string' ? data.note.replace(/\s+/g, ' ').trim() : '';
    if (!note) return { error: 'data.note is required: one short line for the person who introduced you', status: 400 };
    if (note.length > REPORT_NOTE_MAX) return { error: `data.note must be at most ${REPORT_NOTE_MAX} characters`, status: 400 };

    const setting = (await this.adapter.reportSettings([userId])).get(userId);
    if (setting !== 'note') {
      return {
        error: setting === 'none'
          ? 'Your settings keep introducers out of how it went. Change "people who introduce you" under Settings → notifications.'
          : 'Your settings share the status with introducers, not notes. Choose "that, and a short note" under Settings → notifications.',
        status: 403,
      };
    }
    if (await this.adapter.hasReported(opportunityId, userId)) {
      return { error: 'You already reported on this introduction', status: 409 };
    }

    let id: string;
    try {
      id = await appendClientOpportunityEvent(opportunityId, userId, { type: 'report', data: { note } });
    } catch (error) {
      // The one-report index caught a concurrent second report.
      if (String(error).includes('opportunity_events_one_report')) return { error: 'You already reported on this introduction', status: 409 };
      throw error;
    }
    void this.publishIntroduction(target.introducerUserId, opportunityId, 'introduction.report').catch((error) => {
      logger.error('Failed to publish introduction report', { opportunityId, error: String(error) });
    });
    return { id };
  }

  /**
   * Tell the introducer an introduction moved. Called on every status write
   * of every opportunity; anything not introduced is skipped.
   *
   * @param opportunityId - The opportunity whose status was written.
   */
  async publishTransition(opportunityId: string): Promise<void> {
    try {
      const target = await this.adapter.reportTarget(opportunityId);
      if (!target?.introducerUserId) return;
      await this.publishIntroduction(target.introducerUserId, opportunityId, 'introduction.status');
    } catch (error) {
      logger.error('Failed to publish introduction status', { opportunityId, error: String(error) });
    }
  }

  private async publishIntroduction(introducerId: string, opportunityId: string, type: 'introduction.status' | 'introduction.report'): Promise<void> {
    const [progress] = await this.introductions(introducerId, opportunityId);
    if (!progress) return;
    // Talks starting again are no news to the person who opened them.
    if (type === 'introduction.status' && progress.phase === 'talking') return;
    const note = progress.reports.at(-1)?.note;
    if (type === 'introduction.report' && !note) return;
    const pair = `${firstName(progress.a.name)} ⇄ ${firstName(progress.b.name)}`;
    const event: UserEvent = {
      type,
      id: opportunityId,
      title: type === 'introduction.report' ? `${pair} · a note back` : `${pair} · ${PHASE_LABEL[progress.phase]}`,
      body: type === 'introduction.report' ? note! : phaseLine(progress),
      link: INTRODUCE_URL,
      data: {
        opportunityId,
        phase: progress.phase,
        ...(type === 'introduction.report' ? { note } : {}),
      },
    };
    await publishUserEvent(introducerId, event);
  }
}

function toProposalView(row: ProposalRow): OpportunityProposalView {
  const detail = [row.contact.title, row.contact.organization].filter(Boolean).join(', ');
  return {
    id: row.id,
    status: row.status,
    failure: row.failure,
    detection: row.detection,
    actors: row.actors,
    interpretation: row.interpretation,
    context: row.context,
    confidence: row.confidence,
    opportunityId: row.opportunityId,
    networkTitle: row.networkTitle,
    member: { userId: row.member.userId, name: row.member.name, avatar: row.member.avatar, line: row.card.member, intentText: row.member.intentText },
    contact: { id: row.contact.id, name: contactName(row.contact), line: row.card.contact, detail: detail || null },
    draft: row.draft,
  };
}

function toContactView(row: ContactListRow): ContactView {
  const detail = [row.title, row.organization].filter(Boolean).join(', ');
  return {
    id: row.id,
    name: contactName(row),
    email: row.email,
    detail: detail || null,
    source: row.source === 'google_contacts' ? 'saved' : 'emailed',
    onIndex: row.onIndex,
    excluded: row.excluded,
    proposals: row.proposals,
  };
}

/** Research's name for someone, unless it reads like a label rather than a name ("Raj (Stripe guy)"). */
function publicName(name: string | undefined): string | null {
  const clean = name?.replace(/\s+/g, ' ').trim();
  if (!clean || clean.length > 80 || /[()[\]@\d]/.test(clean)) return null;
  return clean;
}

/**
 * A seat's name when research found none: the email's local part, tidied
 * (`raj.patel@` → "Raj Patel"). Never the introducer's address-book label.
 */
function nameFromEmail(email: string): string {
  const local = email.split('@')[0]!.split('+')[0]!;
  const words = local.split(/[._\-\s]+/).filter((w) => /[a-z]/i.test(w));
  const name = words.map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ');
  return name || local || email;
}

/** Public profile links research opened; personal sites included. */
function profileLinks(urls: string[]): { label: string; value: string }[] {
  const seen = new Set<string>();
  const rows: { label: string; value: string }[] = [];
  for (const raw of urls) {
    const value = raw.trim();
    if (!/^https?:\/\//i.test(value)) continue;
    const label = detectSocialLabel(value);
    const key = label === 'custom' ? value : label;
    if (seen.has(key)) continue;
    seen.add(key);
    rows.push({ label, value });
  }
  return rows;
}

/** The first email the contact gets: from the person who introduced them, after the member said yes. */
function introEmail(row: { introducerName: string; memberId: string; memberName: string; memberIntent: string; context: string; seatName: string | null }) {
  const oneLine = (s: string) => s.replace(/[\r\n\t\f\v\0]+/g, ' ').trim().slice(0, 120);
  const intro = oneLine(row.introducerName);
  const member = oneLine(row.memberName);
  // The seat's own name, from research or their email; never the introducer's label for them.
  const hello = row.seatName?.trim() ? `Hi ${firstName(row.seatName)},` : 'Hi,';
  // Sign-in that lands on the member, not the marketing page; the page names them.
  const link = `${WEB_APP_URL}/login?next=${encodeURIComponent(`/u/${row.memberId}`)}`;
  const url = escapeHtml(link);
  const work = row.memberIntent.trim() ? clip(row.memberIntent, 300) : '';
  const contextHtml = row.context ? `<blockquote style="margin: 12px 0; padding-left: 12px; border-left: 3px solid #ddd;">${escapeHtml(row.context)}</blockquote>` : '';
  return {
    subject: `${intro} introduced you to ${member}`,
    html: `<div style="font-family: Arial, sans-serif;">
  <p>${escapeHtml(hello)}</p>
  <p><strong>${escapeHtml(intro)}</strong> thinks you should meet <strong>${escapeHtml(member)}</strong>, and ${escapeHtml(firstName(member))} said yes.</p>
  ${contextHtml}
  ${work ? `<p>${escapeHtml(firstName(member))} is working on: ${escapeHtml(work)}</p>` : ''}
  <p><a href="${url}">Sign in with this email to see it and reply</a></p>
  <p style="color: #666; font-size: 12px;">Not interested? Reply "stop" and Index will delete it and never contact you again.</p>
</div>`,
    text: `${hello}

${intro} thinks you should meet ${member}, and ${firstName(member)} said yes.
${row.context ? `\n"${row.context}"\n` : ''}${work ? `\n${firstName(member)} is working on: ${work}` : ''}

Sign in with this email to see it and reply: ${link}

Not interested? Reply "stop" and Index will delete it and never contact you again.`,
  };
}

export const introducerService = new IntroducerService();
