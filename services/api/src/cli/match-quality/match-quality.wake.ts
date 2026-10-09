/**
 * One ordinary first discovery wake per case, captured and scored.
 *
 * The principal's agent runs the real `wake()` with the real model over a
 * fresh signal: no conversation, no opportunities. Its searches go through the
 * real `HostedIndex.discover()` → `IntentService.discover()` path. Opening is
 * the one thing replaced: `createOpportunities` records the picks and answers
 * as Index would for new pairs, so nothing is opened, nothing is negotiated,
 * and no background agent starts. Every labelled member is then scored from
 * the same returned results the agent itself merged.
 */
import { wake, type Model, type WakeAction } from '@indexnetwork/agent';
import type { Counterparty, CounterpartyPick } from '@indexnetwork/client';
import { and, eq, inArray, isNull } from 'drizzle-orm';

import db from '../../lib/drizzle/drizzle';
import { HostedIndex } from '../../lib/agent/hosted.index';
import { intents, networks, users } from '../../schemas/database.schema';

import { fixtureFingerprint, type CaseMember, type MatchCase } from './match-quality.cases';
import { memberEmail, networkKey, type SeedStamp } from './match-quality.seed';

/** How long one wake may take, end to end. */
const WAKE_TIMEOUT_MS = 180_000;

/** One case as the seed left it in the database. */
export interface SeededCase {
  matchCase: MatchCase;
  stamp: SeedStamp;
  members: { member: CaseMember; userId: string; intentId: string; statement: string }[];
}

/** One discover() call the wake made, with exactly what it returned. */
export interface DiscoverCall {
  query: string;
  limit?: number;
  counterparties?: Counterparty[];
  error?: string;
}

/** Everything one wake did that matters here. */
export interface WakeCapture {
  caseId: string;
  run: number;
  durationMs: number;
  plans: string[];
  calls: DiscoverCall[];
  /** What the agent would have opened, in its own order. Nothing was opened. */
  picks: CounterpartyPick[][];
  actions: WakeAction['type'][];
  error?: string;
}

/** Where one member landed in one result list. Absent means not retrieved. */
export interface Placement {
  score: number;
  rank: number;
}

/** One query, with every labelled member placed from its results. */
export interface QueryScore {
  query: string;
  error?: string;
  returned: number;
  placements: Record<string, Placement | undefined>;
}

/** One run of one case, scored. */
export interface RunScore {
  caseId: string;
  run: number;
  /** `no query`: the wake never searched. `failed`: the wake or every search threw. */
  outcome: 'scored' | 'no query' | 'failed';
  error?: string;
  plans: string[];
  queries: QueryScore[];
  /** Each member's best score across this run's queries, ranked as the agent merges them. */
  best: Record<string, Placement | undefined>;
  /** Hard negatives that outrank the positive on best score, or are retrieved when it is not. */
  hardAbovePositive: string[];
  /** Per query: hard negatives that outrank the positive in that query's list. */
  hardAbovePositiveByQuery: string[][];
}

/**
 * Index for the principal, with opening replaced by a recording and every
 * other write refused. Searching is the real path.
 */
class DiscoveryRecorder extends HostedIndex {
  readonly calls: DiscoverCall[] = [];
  readonly picks: CounterpartyPick[][] = [];

  override async discover(intentId: string, query: string, limit?: number): Promise<Counterparty[]> {
    try {
      const counterparties = await super.discover(intentId, query, limit);
      this.calls.push({ query, limit, counterparties });
      return counterparties;
    } catch (error) {
      this.calls.push({ query, limit, error: error instanceof Error ? error.message : String(error) });
      throw error;
    }
  }

  /** Records the picks and reports each as a new opportunity, without opening any. */
  override async createOpportunities(_intentId: string, counterparties: CounterpartyPick[]): Promise<{ opportunityId: string }[]> {
    this.picks.push(counterparties);
    return counterparties.map((pick) => ({ opportunityId: `not-opened:${pick.intentId}` }));
  }

  override async acceptOpportunity(): Promise<never> {
    throw new Error('The match-quality evaluator does not accept opportunities.');
  }

  override async rejectOpportunity(): Promise<never> {
    throw new Error('The match-quality evaluator does not reject opportunities.');
  }

  override async submitTurn(): Promise<never> {
    throw new Error('The match-quality evaluator does not negotiate.');
  }

  override async sendPrincipal(): Promise<never> {
    throw new Error('The match-quality evaluator does not message principals.');
  }
}

/**
 * Read one case back from the database and check it is the frozen, admitted roster.
 *
 * @throws When the case was not seeded from these fixtures, or a signal is missing.
 */
export async function loadSeededCase(matchCase: MatchCase): Promise<SeededCase> {
  const [network] = await db.select({ metadata: networks.metadata }).from(networks)
    .where(eq(networks.key, networkKey(matchCase.id)));
  const stamp = network?.metadata.matchQuality as SeedStamp | undefined;
  if (!stamp) throw new Error(`${matchCase.id} is not seeded with every signal admitted. Run seed first.`);
  if (stamp.fixtureFingerprint !== fixtureFingerprint()) {
    throw new Error(`${matchCase.id} was seeded from different fixtures (${stamp.fixtureFingerprint.slice(0, 12)}). Run seed again.`);
  }

  const emails = matchCase.members.map((member) => memberEmail(matchCase.id, member.key));
  const rows = await db.select({ email: users.email, userId: users.id, intentId: intents.id, statement: intents.payload })
    .from(users)
    .innerJoin(intents, and(eq(intents.userId, users.id), isNull(intents.archivedAt)))
    .where(inArray(users.email, emails));

  const members = matchCase.members.map((member) => {
    const held = rows.filter((row) => row.email === memberEmail(matchCase.id, member.key));
    if (held.length !== 1) throw new Error(`${matchCase.id}/${member.key} holds ${held.length} signals, expected 1.`);
    if (held[0].statement !== member.signal) throw new Error(`${matchCase.id}/${member.key} was stored differently from its fixture.`);
    return { member, userId: held[0].userId, intentId: held[0].intentId, statement: held[0].statement };
  });
  return { matchCase, stamp, members };
}

/**
 * Run the principal's first wake once, on the case's cutoff date.
 *
 * @param seeded - The case, read back from the database.
 * @param run - Which repetition this is, for the report.
 * @param model - The live model.
 * @returns What the wake searched for and what came back. A failure is captured, not thrown.
 */
export async function captureDiscoveryWake(seeded: SeededCase, run: number, model: Model): Promise<WakeCapture> {
  const principal = seeded.members.find(({ member }) => member.role === 'principal')!;
  const index = new DiscoveryRecorder(principal.userId);
  const plans: string[] = [];
  const started = Date.now();
  const capture = (fields: { actions: WakeAction['type'][]; error?: string }): WakeCapture => ({
    caseId: seeded.matchCase.id,
    run,
    durationMs: Date.now() - started,
    plans,
    calls: index.calls,
    picks: index.picks,
    ...fields,
  });

  try {
    const result = await wake({
      user: await index.me(),
      intent: { id: principal.intentId, statement: principal.statement },
      principalConversation: [],
      opportunities: [],
      model,
      client: index,
      now: () => new Date(`${seeded.matchCase.cutoff}T12:00:00Z`),
      signal: AbortSignal.timeout(WAKE_TIMEOUT_MS),
      onProgress: (text) => {
        if (!text.startsWith('{')) return;
        const progress = JSON.parse(text) as { plan?: string };
        if (progress.plan) plans.push(progress.plan);
      },
    });
    return capture({ actions: result.actions.map((action) => action.type) });
  } catch (error) {
    return capture({ actions: [], error: error instanceof Error ? error.message : String(error) });
  }
}

/**
 * Place every labelled member in every query's results, then merge the
 * queries the way the wake does: each person keeps their best score.
 *
 * @param seeded - The case, with each member's signal id.
 * @param capture - One captured wake.
 * @returns The run's scores. Nothing is thresholded.
 */
export function scoreRun(seeded: SeededCase, capture: WakeCapture): RunScore {
  const labelled = seeded.members.filter(({ member }) => member.role !== 'principal');
  const positive = labelled.find(({ member }) => member.role === 'positive')!;
  const hard = labelled.filter(({ member }) => member.role === 'hard_negative');

  const queries: QueryScore[] = capture.calls.map((call) => {
    const placements: QueryScore['placements'] = {};
    for (const { member, intentId } of labelled) {
      const index = call.counterparties?.findIndex((counterparty) => counterparty.intentId === intentId) ?? -1;
      placements[member.key] = index < 0 ? undefined : { score: call.counterparties![index].score, rank: index + 1 };
    }
    return { query: call.query, error: call.error, returned: call.counterparties?.length ?? 0, placements };
  });

  const merged = new Map<string, Counterparty>();
  for (const counterparty of capture.calls.flatMap((call) => call.counterparties ?? [])) {
    const seen = merged.get(counterparty.userId);
    if (!seen || counterparty.score > seen.score) merged.set(counterparty.userId, counterparty);
  }
  const order = [...merged.values()].sort((left, right) => right.score - left.score);
  const best: RunScore['best'] = {};
  for (const { member, intentId } of labelled) {
    const index = order.findIndex((counterparty) => counterparty.intentId === intentId);
    best[member.key] = index < 0 ? undefined : { score: order[index].score, rank: index + 1 };
  }

  const outranks = (placements: Record<string, Placement | undefined>) => hard
    .filter(({ member }) => {
      const mine = placements[member.key];
      const theirs = placements[positive.member.key];
      return mine !== undefined && (theirs === undefined || mine.score > theirs.score);
    })
    .map(({ member }) => member.key);

  const searched = capture.calls.some((call) => call.counterparties);
  const outcome: RunScore['outcome'] = capture.calls.length === 0 && !capture.error
    ? 'no query'
    : searched ? 'scored' : 'failed';
  return {
    caseId: capture.caseId,
    run: capture.run,
    outcome,
    error: capture.error,
    plans: capture.plans,
    queries,
    best,
    hardAbovePositive: searched ? outranks(best) : [],
    hardAbovePositiveByQuery: queries.map((query) => outranks(query.placements)),
  };
}
