# Single-Path Opportunities Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Collapse opportunity creation to one path — discovery writes *candidates*, and the `opportunities` row is INSERTed only when a PersonalAgent actually kicks off a negotiation — then delete the five other creation paths and every trace of them.

**Architecture:** The OpportunityGraph's terminal `persist` node is replaced by `emitCandidates`, which upserts one `discovery_match_candidates` row per *pair* (unique on `pairKey`). A `PersonalAgentMatch` carries a discriminated `ref` (`candidate` | `opportunity`) instead of a bare `opportunityId`, so exactly one site branches: `runKickoff` calls `createAndOpen` to materialize the row under an advisory lock immediately before opening the negotiation. The pair-unique constraint replaces ~600 lines of persist-time dedup.

**Tech Stack:** Bun monorepo, TypeScript, LangGraph (`@langchain/langgraph`), Drizzle ORM + Postgres (Neon), BullMQ, `bun test`.

**Spec:** `docs/design/single-path-opportunities.md`

## Global Constraints

- **One PR.** Tasks 1–12 land on `feat/single-path-opportunities` and merge together. Merging a prefix leaves `dev` with discovery no longer creating opportunities and kickoff not yet creating them.
- **No legacy, no dead code.** No `legacy*`/`v2` twins, no deprecated re-exports, no compat paths. Delete what a change makes dead, tests included, in the same task.
- **Protocol layering.** `packages/protocol` must not import `drizzle-orm`, `bullmq`, `ioredis`, `pg`, `redis`. It defines interfaces; `services/api/src/adapters/` implements them. Verify with `cd packages/protocol && bun run architecture:check`.
- **Protocol exports.** `packages/protocol/src/index.ts` is the only entry point; every export explicit, no wildcards.
- **Pair key, verbatim:** `pairKey = (networkId, min(intentA, intentB), max(intentA, intentB))`.
- **Opportunities are born `negotiating`.** `latent` and `draft` are deleted. `pending` is untouched by this program.
- **Advisory locks use the existing idiom:** `pg_advisory_xact_lock(hashtextextended(<string key>, 0))` inside a Drizzle transaction. See `services/api/src/adapters/intent-scope.atomic.ts`.

## Test commands

| Scope | Command |
|---|---|
| One protocol spec | `cd packages/protocol && bun test src/path/to/file.spec.ts` |
| All protocol shared | `cd packages/protocol && bun run test:shared` |
| Protocol architecture | `cd packages/protocol && bun run architecture:check` |
| One API spec | `cd services/api && NODE_ENV=test bun test src/path/to/file.spec.ts` |
| API isolated (needs DB) | `cd services/api && bun run test:isolated` |
| Write a migration | By hand in `services/api/drizzle/NNNN_name.sql` + a `drizzle/meta/_journal.json` entry. **Not** `db:generate` — see below. |
| Apply to test DB | `cd services/api && bun run db:migrate:test` |

**Migrations are hand-written in this repo.** The newest drizzle snapshot is `0128` but migrations run to `0153`; everything since is hand-authored and journal-registered. `db:generate` diffs against that stale snapshot, sees 25 migrations of drift, and blocks on an interactive rename prompt that needs a TTY. Write the `.sql` and append the `_journal.json` entry (`idx`, `version: '7'`, `when` = previous + 1, `tag`, `breakpoints: true`) directly.

**Verifying against the test DB.** The app's Drizzle client refuses to connect unless `TEST_DATABASE_SAFE=1` is loaded (`set -a; . ../../.env.test; set +a`), and it additionally fails a schema-currency check on a pre-existing missing index unrelated to this work. For ad-hoc verification, connect with `new SQL(process.env.DATABASE_URL)` from `bun` and query `information_schema` directly.

**Two known-noise traps — do not chase these:**
1. `packages/protocol`'s `bun run test` runner *excludes* seven live-model spec files. A green run there does not prove those pass.
2. `services/api` fails a stable set of specs on `dev` regardless of your diff. Before blaming your change, stash nothing — instead run the same spec file on a clean `origin/dev` checkout and compare.

## Sequencing rationale

Consumer side first, producer side last. Tasks 1–6 add the candidates table, the `ref` type, the union read, and `createAndOpen` while discovery still persists opportunities as it does today — every one of them is independently green. **Task 7 is the single moment behavior flips.** Tasks 8–12 delete what the flip made dead.

## File structure

| File | Responsibility | Task |
|---|---|---|
| `services/api/src/schemas/database.schema.ts` | `discoveryMatchCandidates` table + `pairKey` unique index | 1 |
| `services/api/drizzle/0154_*.sql` | Create table (generated) | 1 |
| `services/api/src/adapters/discovery-candidate.database.adapter.ts` | **Create.** Candidate upsert / list-by-intent / mark-opened / create-and-open | 1, 5 |
| `packages/protocol/src/internal/opportunities/opportunity.candidates.ts` | **Create.** `DiscoveryMatchCandidate` type + `pairKeyOf()` | 1 |
| `packages/protocol/src/platform/database/opportunity-queries.ts` | Candidate port methods on the database interface | 1 |
| `packages/protocol/src/internal/agents/personal-agent/agent.types.ts` | `PersonalAgentMatch.ref`, `createAndOpen` on the opportunity port | 2, 5 |
| `packages/protocol/src/internal/agents/personal-agent/agent.graph.ts` | `ref` readers; `runKickoff` resolve; `compensateFailedOpen` | 2, 6 |
| `services/api/src/lib/agent/negotiator-verdict.host.ts` | `readSignalMatches` union; status constants | 3, 10 |
| `packages/protocol/src/internal/opportunities/opportunity.graph.emit-candidates.ts` | **Create.** Replaces `persist` node | 7 |
| `packages/protocol/src/internal/opportunities/opportunity.graph.matches-ready.ts` | Derive intents from candidates | 7 |
| `packages/protocol/src/internal/opportunities/opportunity.graph.ts` | Wire `emitCandidates`; drop persist wiring | 7 |
| `packages/protocol/src/internal/opportunities/opportunity.graph.modes.ts` | Drop intro/send modes | 8 |
| `services/api/src/controllers/opportunity.controller.ts` | Drop manual-create route | 8 |
| `packages/protocol/src/internal/maintenance/` | **Delete.** | 9 |
| `services/api/drizzle/0155_*.sql` | Data migration + enum/role drops | 10 |
| `packages/protocol/src/index.ts`, `CHANGELOG.md`, `package.json` | Major bump | 12 |

---

## Task 1: Candidates table and adapter

**Files:**
- Create: `packages/protocol/src/internal/opportunities/opportunity.candidates.ts`
- Create: `services/api/src/adapters/discovery-candidate.database.adapter.ts`
- Modify: `services/api/src/schemas/database.schema.ts` (append after `opportunities`, ~line 449)
- Modify: `packages/protocol/src/platform/database/opportunity-queries.ts`
- Test: `packages/protocol/src/internal/opportunities/tests/opportunity.candidates.spec.ts`

**Interfaces:**
- Produces: `pairKeyOf(networkId, intentA, intentB): string`; `DiscoveryMatchCandidate`; `CreateDiscoveryMatchCandidateData`; database port methods `upsertDiscoveryMatchCandidates`, `listPendingCandidatesForIntent`, `markCandidateOpened`.

- [ ] **Step 1: Write the failing test for `pairKeyOf`**

```ts
// packages/protocol/src/internal/opportunities/tests/opportunity.candidates.spec.ts
import { describe, expect, it } from 'bun:test';
import { pairKeyOf } from '../opportunity.candidates.js';

describe('pairKeyOf', () => {
  it('is order-independent in the intent pair', () => {
    expect(pairKeyOf('net-1', 'intent-b', 'intent-a'))
      .toBe(pairKeyOf('net-1', 'intent-a', 'intent-b'));
  });

  it('separates the same intent pair in different networks', () => {
    expect(pairKeyOf('net-1', 'intent-a', 'intent-b'))
      .not.toBe(pairKeyOf('net-2', 'intent-a', 'intent-b'));
  });

  it('does not collide when an id contains the separator', () => {
    expect(pairKeyOf('net-1', 'a:b', 'c'))
      .not.toBe(pairKeyOf('net-1', 'a', 'b:c'));
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/protocol && bun test src/internal/opportunities/tests/opportunity.candidates.spec.ts`
Expected: FAIL — `Cannot find module '../opportunity.candidates.js'`

- [ ] **Step 3: Write `opportunity.candidates.ts`**

```ts
/**
 * A pair discovery found and has not yet opened.
 *
 * Discovery does not create opportunities. It records the pair, once, keyed by
 * {@link pairKeyOf} — and the PersonalAgent that decides to reach out is what
 * turns a candidate into a row. The pair key IS the dedup: both principals'
 * discovery runs converge on the same candidate instead of racing to persist
 * two opportunities between the same two people.
 */
import type { Id } from '../../platform/database.js';
import type { OpportunityEvidence } from './opportunity.state.js';

/**
 * Stable identity of a two-intent pair within a network, independent of which
 * side's discovery run found it.
 *
 * Ids are length-prefixed rather than joined on a separator: an id containing
 * the separator would otherwise let two different pairs produce one key, and
 * this key is a uniqueness constraint.
 */
export function pairKeyOf(networkId: string, intentA: string, intentB: string): string {
  const [low, high] = intentA <= intentB ? [intentA, intentB] : [intentB, intentA];
  return [networkId, low, high].map((part) => `${part.length}:${part}`).join('');
}

export type DiscoveryMatchCandidateStatus = 'pending' | 'opened' | 'superseded' | 'expired';

export interface CreateDiscoveryMatchCandidateData {
  pairKey: string;
  networkId: Id<'networks'>;
  intentA: Id<'intents'>;
  intentB: Id<'intents'>;
  userA: Id<'users'>;
  userB: Id<'users'>;
  score: number;
  reasoning: string;
  evidence: OpportunityEvidence[];
}

export interface DiscoveryMatchCandidate extends CreateDiscoveryMatchCandidateData {
  id: string;
  status: DiscoveryMatchCandidateStatus;
  createdAt: Date;
  /** Resolved for the reader: the party on the other side of the pair. */
  counterpartName?: string;
}

/**
 * What materializing a candidate reports back.
 *
 * There is no error case because there is no throw: this is called below the
 * kickoff round bump, where a throw would be retried into a second strategy
 * message and a second round.
 */
export type CreateAndOpenResult =
  | { status: 'created' | 'existing'; opportunityId: string }
  | { status: 'raced' | 'failed'; reason: string };
```

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd packages/protocol && bun test src/internal/opportunities/tests/opportunity.candidates.spec.ts`
Expected: PASS, 3 tests

- [ ] **Step 5: Add the port methods**

In `packages/protocol/src/platform/database/opportunity-queries.ts`, alongside the existing `createOpportunity(data: CreateOpportunityData): Promise<Opportunity>;`:

```ts
  /** Upsert on `pairKey`: a pair both sides discovered stays one row. */
  upsertDiscoveryMatchCandidates(
    items: CreateDiscoveryMatchCandidateData[],
  ): Promise<DiscoveryMatchCandidate[]>;

  /**
   * This signal's not-yet-opened pairs, oldest first, each carrying the name
   * of the OTHER party — the caller renders these to a principal, and a row
   * that names nobody cannot be numbered in a prompt.
   */
  listPendingCandidatesForIntent(
    userId: string,
    intentId: string,
  ): Promise<DiscoveryMatchCandidate[]>;
```

Import the types from `../../internal/opportunities/opportunity.candidates.js` and re-export both plus `pairKeyOf` from `packages/protocol/src/index.ts`.

- [ ] **Step 6: Add the Drizzle table**

In `services/api/src/schemas/database.schema.ts`, directly after the `opportunities` table:

```ts
export const discoveryMatchCandidateStatusEnum = pgEnum('discovery_match_candidate_status', [
  'pending', 'opened', 'superseded', 'expired',
]);

/**
 * A pair discovery found, before anyone reached out. One row per pair — the
 * unique `pair_key` is what stops both principals' discovery runs from
 * producing two opportunities between the same two people.
 */
export const discoveryMatchCandidates = pgTable('discovery_match_candidates', {
  id: text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  pairKey: text('pair_key').notNull(),
  networkId: text('network_id').notNull().references(() => networks.id, { onDelete: 'cascade' }),
  intentA: text('intent_a').notNull().references(() => intents.id, { onDelete: 'cascade' }),
  intentB: text('intent_b').notNull().references(() => intents.id, { onDelete: 'cascade' }),
  userA: text('user_a').notNull().references(() => users.id, { onDelete: 'cascade' }),
  userB: text('user_b').notNull().references(() => users.id, { onDelete: 'cascade' }),
  score: numeric('score').notNull(),
  reasoning: text('reasoning').notNull(),
  evidence: jsonb('evidence').$type<unknown[]>().notNull().default([]),
  status: discoveryMatchCandidateStatusEnum('status').notNull().default('pending'),
  /** Set when this candidate became a row, by `createAndOpen` (Task 4). */
  openedOpportunityId: text('opened_opportunity_id').references(() => opportunities.id, { onDelete: 'set null' }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
}, (table) => ({
  pairKeyIdx: uniqueIndex('discovery_match_candidates_pair_key_idx').on(table.pairKey),
  intentAIdx: index('discovery_match_candidates_intent_a_idx').on(table.intentA),
  intentBIdx: index('discovery_match_candidates_intent_b_idx').on(table.intentB),
}));
```

Add `uniqueIndex` to the `drizzle-orm/pg-core` import at the top of the file if it is not already there.

- [ ] **Step 7: Write the adapter**

Create `services/api/src/adapters/discovery-candidate.database.adapter.ts`:

```ts
import { and, asc, eq, inArray, or, sql } from 'drizzle-orm';

import { db } from '../lib/drizzle/drizzle';
import { discoveryMatchCandidates, opportunities, users } from '../schemas/database.schema';

type CandidateRow = typeof discoveryMatchCandidates.$inferSelect;

function toCandidate(row: CandidateRow) {
  return { ...row, score: Number(row.score), evidence: (row.evidence ?? []) as unknown[] };
}

export class DiscoveryCandidateDatabaseAdapter {
  /**
   * Upsert on `pair_key`. A pair rediscovered with a better read updates in
   * place; a pair already opened is left alone — reopening it is the
   * PersonalAgent's decision, not discovery's.
   */
  async upsertDiscoveryMatchCandidates(items: Array<Record<string, unknown>>) {
    if (items.length === 0) return [];
    const rows = await db
      .insert(discoveryMatchCandidates)
      .values(items.map((item) => ({ ...item, score: String(item.score) })) as never)
      .onConflictDoUpdate({
        target: discoveryMatchCandidates.pairKey,
        set: {
          score: sql`excluded.score`,
          reasoning: sql`excluded.reasoning`,
          evidence: sql`excluded.evidence`,
          updatedAt: new Date(),
        },
        where: eq(discoveryMatchCandidates.status, 'pending'),
      })
      .returning();
    return rows.map(toCandidate);
  }

  async listPendingCandidatesForIntent(userId: string, intentId: string) {
    const rows = await db
      .select()
      .from(discoveryMatchCandidates)
      .where(and(
        eq(discoveryMatchCandidates.status, 'pending'),
        or(
          eq(discoveryMatchCandidates.intentA, intentId),
          eq(discoveryMatchCandidates.intentB, intentId),
        ),
      ))
      .orderBy(asc(discoveryMatchCandidates.createdAt), asc(discoveryMatchCandidates.id));

    // The counterparty is whichever side is not the caller. Resolved in one
    // lookup rather than per row.
    const otherIds = [...new Set(rows.map((row) => row.userA === userId ? row.userB : row.userA))];
    const names = otherIds.length === 0 ? [] : await db
      .select({ id: users.id, name: users.name })
      .from(users)
      .where(inArray(users.id, otherIds));
    const nameById = new Map(names.map((row) => [row.id, row.name ?? undefined]));

    return rows.map((row) => ({
      ...toCandidate(row),
      counterpartName: nameById.get(row.userA === userId ? row.userB : row.userA),
    }));
  }
}

export const discoveryCandidateAdapter = new DiscoveryCandidateDatabaseAdapter();
```

Wire both methods through `services/api/src/adapters/database.adapter.ts` the same way `createOpportunity` is wired there (delegate to `discoveryCandidateAdapter`).

- [ ] **Step 8: Write and apply the migration**

Hand-write `services/api/drizzle/0154_discovery_match_candidates.sql` and append its `_journal.json` entry.

Run: `cd services/api && bun run db:migrate:test`
Expected: applies cleanly.

- [ ] **Step 9: Run the protocol architecture check**

Run: `cd packages/protocol && bun run architecture:check`
Expected: PASS — confirms `opportunity.candidates.ts` pulled in no host dependency.

- [ ] **Step 10: Commit**

```bash
git add packages/protocol/src/internal/opportunities/opportunity.candidates.ts \
        packages/protocol/src/internal/opportunities/tests/opportunity.candidates.spec.ts \
        packages/protocol/src/platform/database/opportunity-queries.ts \
        packages/protocol/src/index.ts \
        services/api/src/schemas/database.schema.ts \
        services/api/src/adapters/discovery-candidate.database.adapter.ts \
        services/api/src/adapters/database.adapter.ts \
        services/api/drizzle
git commit -m "feat: add discovery_match_candidates, keyed by pair"
```

---

## Task 2: `PersonalAgentMatch.ref`

Pure type change. Every match is still an `opportunity` ref — no candidate exists yet. Behavior must be identical; that is what makes this task independently verifiable.

**Files:**
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.types.ts:226-237`
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.graph.ts` (~lines 252-292, 556, 371-388)
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.judgment.ts`
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.prompt.ts`
- Modify: `services/api/src/lib/agent/negotiator-verdict.host.ts:180-196`
- Modify: `packages/protocol/src/capabilities/tests/personal-agent.e2e.spec.ts:81`
- Test: `packages/protocol/src/internal/agents/personal-agent/tests/agent.match-ref.spec.ts`

**Interfaces:**
- Consumes: nothing from Task 1.
- Produces: `PersonalAgentMatch { ref: { kind: 'candidate' | 'opportunity'; id: string }; label: string; status: string; awaitingIntroducerApproval?: boolean }` — `opportunityId` is gone; `matchRefId(match)` and `opportunityRef(id)` are exported from the protocol barrel.

**`awaitingIntroducerApproval` stays until Task 8.** It gates kickoff eligibility at `agent.graph.ts:262` — dropping it here would make unapproved introductions kickoff-eligible, a behavior change in the one task whose entire claim is that behavior is unchanged. It dies with the introducer role in Task 8.

**The `ActionableCounterparty` → `PersonalAgentMatch` seam is in `services/api/src/lib/negotiation/negotiation-graph.ts`**, not in `negotiator-verdict.host.ts`. `readSignalMatches` keeps returning `ActionableCounterparty[]` with its own real-row `opportunityId`; the `readMatches` adapter there projects it to a ref. That is the only host site Task 2 changes.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/internal/agents/personal-agent/tests/agent.match-ref.spec.ts
import { describe, expect, it } from 'bun:test';
import { matchRefId, opportunityRef } from '../agent.types.js';

describe('match refs', () => {
  it('reads one id regardless of kind', () => {
    expect(matchRefId({ ref: { kind: 'opportunity', id: 'opp-1' }, label: 'A', status: 'negotiating' }))
      .toBe('opp-1');
    expect(matchRefId({ ref: { kind: 'candidate', id: 'cand-1' }, label: 'B', status: 'found' }))
      .toBe('cand-1');
  });

  it('opportunityRef builds an opportunity-kind ref', () => {
    expect(opportunityRef('opp-2')).toEqual({ kind: 'opportunity', id: 'opp-2' });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/protocol && bun test src/internal/agents/personal-agent/tests/agent.match-ref.spec.ts`
Expected: FAIL — `matchRefId` is not exported

- [ ] **Step 3: Change the type**

Replace `PersonalAgentMatch` in `agent.types.ts` (currently lines 225-237, including its `awaitingIntroducerApproval` field and doc comment):

```ts
/**
 * What a match is addressed by for the whole turn.
 *
 * `opportunityId` used to be this identifier, but a match discovery has only
 * found has no row yet. A second optional id would have made every dedup and
 * re-check site ask "which one is this?"; one discriminated ref keeps them all
 * reading a single value, and puts the only branch at the moment of open.
 */
export type PersonalAgentMatchRef =
  | { kind: 'candidate'; id: string }
  | { kind: 'opportunity'; id: string };

/** One of this signal's matches, as the prompt numbers it. */
export interface PersonalAgentMatch {
  ref: PersonalAgentMatchRef;
  /** One line the model may read and repeat: counterparty + state. */
  label: string;
  status: string;
}

/** The id every dedup, re-check and ledger site keys on. */
export function matchRefId(match: PersonalAgentMatch): string {
  return match.ref.id;
}

export function opportunityRef(id: string): PersonalAgentMatchRef {
  return { kind: 'opportunity', id };
}
```

Export `PersonalAgentMatchRef`, `matchRefId` and `opportunityRef` from `packages/protocol/src/index.ts`.

- [ ] **Step 4: Update every reader**

Run: `rg -n 'opportunityId' packages/protocol/src/internal/agents/personal-agent/ services/api/src/lib/agent/negotiator-verdict.host.ts`

For each hit that reads a `PersonalAgentMatch`, replace `match.opportunityId` with `matchRefId(match)`. The specific sites:

- `agent.graph.ts` `resolvedHere` filter — `.map((act) => act.opportunityId)` stays (acts carry a real opportunity id, not a match ref).
- `agent.graph.ts:556` — `context.kickoffTargets.filter((match) => !resolvedHere.has(matchRefId(match)))`
- `agent.graph.ts` `knownMatchIds` — `matches.map(matchRefId)`
- `agent.graph.ts` `threadByOpportunity.get(...)` — `threadByOpportunity.get(matchRefId(match))`
- `negotiator-verdict.host.ts` `.map((row, index) => ...)` — return `ref: opportunityRef(row.id)` in place of `opportunityId: row.id`, and drop the `awaitingIntroducerApproval` field.

`ActionableCounterparty` keeps its own `opportunityId` — it is the verdict lane's own type over real rows, not a `PersonalAgentMatch`. Do not change it.

- [ ] **Step 5: Run the full personal-agent suite**

Run: `cd packages/protocol && bun test src/internal/agents/personal-agent/ src/capabilities/tests/personal-agent.e2e.spec.ts`
Expected: PASS. Behavior is unchanged; only the identifier's shape moved.

- [ ] **Step 6: Run the API side**

Run: `cd services/api && NODE_ENV=test bun test src/lib/agent/tests/signal-matches.host.spec.ts src/lib/negotiation/`
Expected: PASS unchanged. This spec asserts on `ActionableCounterparty`, which Task 2 does not touch, so it needs no edits.

- [ ] **Step 7: Commit**

```bash
git add packages/protocol/src/internal/agents/personal-agent packages/protocol/src/index.ts \
        packages/protocol/src/capabilities/tests/personal-agent.e2e.spec.ts \
        services/api/src/lib/agent
git commit -m "refactor: address PersonalAgent matches by discriminated ref"
```

---

## Task 3: `readSignalMatches` returns candidates too

**Files:**
- Modify: `services/api/src/lib/agent/negotiator-verdict.host.ts:153-196`
- Test: `services/api/src/lib/agent/tests/signal-matches.host.spec.ts`

**Interfaces:**
- Consumes: `listPendingCandidatesForIntent` (Task 1), `opportunityRef` / `PersonalAgentMatchRef` (Task 2).
- Produces: `readSignalMatches` returning candidate refs and opportunity refs in one oldest-first list.

- [ ] **Step 1: Write the failing test**

```ts
// append to services/api/src/lib/agent/tests/signal-matches.host.spec.ts
describe('readSignalMatches with candidates', () => {
  const deps = {
    listOpportunities: async () => [{
      id: 'opp-1', status: 'negotiating', createdAt: new Date('2026-08-02'),
      counterpartName: 'Bea', actors: [],
    }],
    listPendingCandidates: async (_userId: string, _intentId: string) => [{
      id: 'cand-1', createdAt: new Date('2026-08-01'),
      counterpartName: 'Ali', score: 71,
    }],
  };

  it('interleaves candidates and opportunities oldest-first', async () => {
    const matches = await readSignalMatches('alice', 'intent-1', deps, PERSONAL_AGENT_MATCH_STATUSES);
    expect(matches.map((m) => m.ref)).toEqual([
      { kind: 'candidate', id: 'cand-1' },
      { kind: 'opportunity', id: 'opp-1' },
    ]);
  });

  it('gives a candidate the not-contacted-yet state line', async () => {
    const [first] = await readSignalMatches('alice', 'intent-1', deps, PERSONAL_AGENT_MATCH_STATUSES);
    expect(first!.label).toBe('Ali — found, not contacted yet');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd services/api && NODE_ENV=test bun test src/lib/agent/tests/signal-matches.host.spec.ts`
Expected: FAIL — candidates are not read; the list has one entry.

- [ ] **Step 3: Implement the union**

In `negotiator-verdict.host.ts`, add `listPendingCandidates(userId, intentId)` to `NegotiatorVerdictHostDeps` (defaulting to `discoveryCandidateAdapter.listPendingCandidatesForIntent`), then read both sources and merge before the existing sort:

```ts
  const [rows, candidates] = await Promise.all([
    list(userId, { statuses, scopeType: 'intent', scopeId: intentId }) as Promise<ListedOpportunity[]>,
    readCandidates(userId, intentId),
  ]);

  const fromCandidates = candidates.map((candidate) => ({
    ref: { kind: 'candidate' as const, id: candidate.id },
    createdAt: candidate.createdAt,
    sortId: candidate.id,
    name: candidate.counterpartName?.trim() || 'An unnamed match',
    status: 'found',
  }));
```

Map opportunity rows into the same intermediate shape, concatenate, then apply the existing
`.sort((a, b) => asTime(a.createdAt) - asTime(b.createdAt) || a.sortId.localeCompare(b.sortId))`
and the existing `position: index + 1` numbering. Add `found: 'found, not contacted yet'` to `STATE_LINE`.

**The oldest-first ordering is a contract, not a preference** — the prompt renders this list numbered and the tool resolves by number, so a new arrival must append rather than renumber. Keep the sort exactly as it is.

- [ ] **Step 4: Run the test and watch it pass**

Run: `cd services/api && NODE_ENV=test bun test src/lib/agent/tests/signal-matches.host.spec.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add services/api/src/lib/agent
git commit -m "feat: readSignalMatches unions pending candidates with open opportunities"
```

---

## Task 4: `createAndOpen` adapter

The write that replaces persist-time dedup. Runs in one transaction under an advisory lock on the pair key.

**Files:**
- Modify: `services/api/src/adapters/discovery-candidate.database.adapter.ts`
- Test: `services/api/src/adapters/tests/create-and-open.contract.spec.ts`

**Interfaces:**
- Produces: `createAndOpen(candidateId: string): Promise<CreateAndOpenResult>` where
  `type CreateAndOpenResult = { status: 'created' | 'existing'; opportunityId: string } | { status: 'raced' | 'failed'; reason: string }`

- [ ] **Step 1: Write the failing contract test**

This mirrors `services/api/src/adapters/tests/intent-scope-lock.contract.spec.ts`, which asserts lock ordering by reading the source — the same technique, because the ordering is the invariant:

```ts
// services/api/src/adapters/tests/create-and-open.contract.spec.ts
import { describe, expect, it } from 'bun:test';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  new URL('../discovery-candidate.database.adapter.ts', import.meta.url), 'utf8',
);

describe('createAndOpen lock contract', () => {
  const body = source.slice(source.indexOf('async createAndOpen('));

  it('takes the pair advisory lock before reading or writing', () => {
    const lock = body.indexOf('pg_advisory_xact_lock');
    const read = body.indexOf('.select(');
    const insert = body.indexOf('.insert(opportunities)');
    expect(lock).toBeGreaterThanOrEqual(0);
    expect(read).toBeGreaterThan(lock);
    expect(insert).toBeGreaterThan(lock);
  });

  it('never throws out of the transaction', () => {
    expect(body).toContain("status: 'failed'");
    expect(body.slice(0, body.indexOf('\n  }\n'))).not.toMatch(/\bthrow new Error\b/);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/create-and-open.contract.spec.ts`
Expected: FAIL — `createAndOpen` is not in the file, so `body` is empty

- [ ] **Step 3: Implement it**

Append to `DiscoveryCandidateDatabaseAdapter`:

```ts
  /**
   * Turn a candidate into an opportunity and hand back its id.
   *
   * RETURNS, NEVER THROWS. This runs below the kickoff round bump, where the
   * turn has already written a principal-visible strategy message and opened a
   * round — a throw here would be retried into a second of each. The caller
   * compensates on `failed`.
   *
   * The advisory lock is on the pair, not the candidate: both principals'
   * agents can reach this for the same pair at the same time, and the second
   * one through must find the first one's row rather than write its own.
   */
  async createAndOpen(candidateId: string): Promise<CreateAndOpenResult> {
    try {
      return await db.transaction(async (tx) => {
        const [candidate] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (!candidate) return { status: 'failed', reason: 'candidate_not_found' } as const;

        await tx.execute(sql`
          SELECT pg_advisory_xact_lock(
            hashtextextended(${`opportunity-pair:${candidate.pairKey}`}, 0)
          )
        `);

        // Re-read under the lock: the other side may have opened this pair
        // between our read and our lock.
        const [locked] = await tx.select().from(discoveryMatchCandidates)
          .where(eq(discoveryMatchCandidates.id, candidateId)).limit(1);
        if (locked?.status === 'opened') {
          const existingId = (locked.openedOpportunityId ?? null) as string | null;
          return existingId
            ? { status: 'existing', opportunityId: existingId } as const
            : { status: 'raced', reason: 'pair_opened_without_row' } as const;
        }

        const [row] = await tx.insert(opportunities).values({
          detection: {
            source: 'opportunity_graph',
            createdBy: 'agent-opportunity-finder',
            timestamp: new Date().toISOString(),
          },
          actors: [
            { networkId: candidate.networkId, userId: candidate.userA, role: 'party', intent: candidate.intentA },
            { networkId: candidate.networkId, userId: candidate.userB, role: 'party', intent: candidate.intentB },
          ],
          interpretation: {
            category: 'collaboration',
            reasoning: candidate.reasoning,
            confidence: Number(candidate.score) / 100,
            signals: [{ type: 'intent_match', weight: Number(candidate.score) / 100, detail: 'Match explainer' }],
          },
          context: { networkId: candidate.networkId },
          confidence: String(Number(candidate.score) / 100),
          status: 'negotiating',
          updatedAt: new Date(),
          metadata: { evidence: candidate.evidence ?? [] },
        }).returning();
        if (!row) return { status: 'failed', reason: 'insert_returned_no_row' } as const;

        await tx.update(discoveryMatchCandidates)
          .set({ status: 'opened', openedOpportunityId: row.id, updatedAt: new Date() })
          .where(eq(discoveryMatchCandidates.id, candidateId));

        return { status: 'created', opportunityId: row.id } as const;
      });
    } catch (error) {
      return { status: 'failed', reason: error instanceof Error ? error.message : String(error) };
    }
  }
```

`openedOpportunityId` already exists on the table from Task 1 — no new migration is needed here.

- [ ] **Step 4: Run the contract test**

Run: `cd services/api && NODE_ENV=test bun test src/adapters/tests/create-and-open.contract.spec.ts`
Expected: PASS, 2 tests

- [ ] **Step 5: Write the real concurrency test**

The contract test proves the lock is *taken first*. It cannot prove the lock *works* — that needs two live transactions, so this one runs against the test database as an isolated spec.

```ts
// services/api/src/adapters/tests/create-and-open.isolated.ts
import { describe, expect, it } from 'bun:test';
import { discoveryCandidateAdapter } from '../discovery-candidate.database.adapter';
import { seedPairCandidate } from './helpers/seed-candidate';

describe('createAndOpen under concurrent kickoff', () => {
  it('two agents racing one pair produce exactly one opportunity', async () => {
    const candidateId = await seedPairCandidate();

    // Both principals' PersonalAgents wake on the same candidate and open it.
    const [a, b] = await Promise.all([
      discoveryCandidateAdapter.createAndOpen(candidateId),
      discoveryCandidateAdapter.createAndOpen(candidateId),
    ]);

    const outcomes = [a.status, b.status].sort();
    expect(outcomes).toEqual(['created', 'existing']);
    expect((a as { opportunityId: string }).opportunityId)
      .toBe((b as { opportunityId: string }).opportunityId);
  });
});
```

Write `seedPairCandidate` in `services/api/src/adapters/tests/helpers/seed-candidate.ts`: insert two users, a network, two intents, and one `discovery_match_candidates` row via `upsertDiscoveryMatchCandidates`, returning the candidate id. Follow the setup idiom in `services/api/src/adapters/tests/database.adapter.isolated.ts`.

- [ ] **Step 6: Run the concurrency test**

Run: `cd services/api && bun run test:isolated`
Expected: PASS. This is the spec's Verification row *"Parallel kickoff on one pair → one row"* — if it fails with two `created` results, the advisory lock key is wrong (check it is on `pairKey`, not on the candidate id).

- [ ] **Step 7: Commit**

```bash
git add services/api/src/adapters services/api/src/schemas/database.schema.ts services/api/drizzle
git commit -m "feat: createAndOpen materializes a candidate under a pair advisory lock"
```

---

## Task 5: `createAndOpen` on the protocol port

**Files:**
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.types.ts:242-247` (`PersonalAgentOpportunityPort`)
- Modify: `services/api/src/queues/personal-agent.queue.ts` (port wiring)
- Modify: `packages/protocol/src/capabilities/tests/negotiation-host.fixture.ts` (fake host)

**Interfaces:**
- Consumes: Task 4's adapter method.
- Produces: `PersonalAgentOpportunityPort.createAndOpen(userId, input): Promise<CreateAndOpenResult>`.

- [ ] **Step 1: Extend the port**

```ts
export interface PersonalAgentOpportunityPort {
  readMatches(userId: string, intentId: string): Promise<PersonalAgentMatch[]>;
  /**
   * Materialize a candidate as an opportunity, immediately before opening its
   * negotiation. Returns rather than throws — see the adapter's note on D54.
   */
  createAndOpen(
    userId: string,
    input: { intentId: string; candidateId: string },
  ): Promise<CreateAndOpenResult>;
  accept(
    userId: string,
    input: { intentId: string; opportunityId: string; reason?: string },
  ): Promise<{ status: string; counterparty?: string }>;
}
```

Export `CreateAndOpenResult` from `packages/protocol/src/index.ts`.

- [ ] **Step 2: Wire the host**

In `services/api/src/queues/personal-agent.queue.ts`, where the `opportunities` port object is built, add:

```ts
    createAndOpen: (_userId, input) => discoveryCandidateAdapter.createAndOpen(input.candidateId),
```

- [ ] **Step 3: Wire the test fixture**

In `packages/protocol/src/capabilities/tests/fixtures/negotiation-host.fixture.ts`, add a `createAndOpen` that returns `{ status: 'created', opportunityId: \`opp-from-${input.candidateId}\` }` and records the call, so Task 6's test can assert on it.

- [ ] **Step 4: Typecheck both packages**

Run: `cd packages/protocol && bun run architecture:check && bunx tsc --noEmit`
Run: `cd services/api && bunx tsc --noEmit`
Expected: no errors. Any implementer of `PersonalAgentOpportunityPort` that does not yet have `createAndOpen` will surface here — fix each one; do not add an optional marker to the interface.

- [ ] **Step 5: Commit**

```bash
git add packages/protocol/src/internal/agents/personal-agent/agent.types.ts \
        packages/protocol/src/index.ts \
        packages/protocol/src/capabilities/tests/fixtures/negotiation-host.fixture.ts \
        services/api/src/queues/personal-agent.queue.ts
git commit -m "feat: add createAndOpen to the PersonalAgent opportunity port"
```

---

## Task 6: `runKickoff` resolves candidate refs

**Files:**
- Modify: `packages/protocol/src/internal/agents/personal-agent/agent.graph.ts` (~lines 610-625, and `compensateFailedOpen`)
- Test: `packages/protocol/src/internal/agents/personal-agent/tests/agent.kickoff-candidate.spec.ts`

**Interfaces:**
- Consumes: `CreateAndOpenResult` (Task 5), `matchRefId` (Task 2).

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/internal/agents/personal-agent/tests/agent.kickoff-candidate.spec.ts
import { describe, expect, it } from 'bun:test';
import { resolveMatchToOpportunity } from '../agent.graph.js';

describe('resolveMatchToOpportunity', () => {
  const port = {
    createAndOpen: async () => ({ status: 'created' as const, opportunityId: 'opp-9' }),
  };

  it('passes an opportunity ref through without a write', async () => {
    let called = false;
    const result = await resolveMatchToOpportunity(
      { createAndOpen: async () => { called = true; return { status: 'failed' as const, reason: 'x' }; } },
      'alice', 'intent-1',
      { ref: { kind: 'opportunity', id: 'opp-1' }, label: 'A', status: 'negotiating' },
    );
    expect(result).toEqual({ status: 'existing', opportunityId: 'opp-1' });
    expect(called).toBe(false);
  });

  it('materializes a candidate ref', async () => {
    const result = await resolveMatchToOpportunity(
      port, 'alice', 'intent-1',
      { ref: { kind: 'candidate', id: 'cand-1' }, label: 'B', status: 'found' },
    );
    expect(result).toEqual({ status: 'created', opportunityId: 'opp-9' });
  });

  it('returns failed rather than throwing when the write fails', async () => {
    const result = await resolveMatchToOpportunity(
      { createAndOpen: async () => ({ status: 'failed' as const, reason: 'deadlock' }) },
      'alice', 'intent-1',
      { ref: { kind: 'candidate', id: 'cand-2' }, label: 'C', status: 'found' },
    );
    expect(result.status).toBe('failed');
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/protocol && bun test src/internal/agents/personal-agent/tests/agent.kickoff-candidate.spec.ts`
Expected: FAIL — `resolveMatchToOpportunity` is not exported

- [ ] **Step 3: Implement and wire it**

Add to `agent.graph.ts` and export it:

```ts
/**
 * One match → one opportunity id, resolved at the moment of open.
 *
 * This is the ONLY place a candidate becomes a row. Everything above it
 * addresses matches by ref, and everything below it needs a real id.
 */
export async function resolveMatchToOpportunity(
  opportunities: Pick<PersonalAgentOpportunityPort, 'createAndOpen'>,
  userId: string,
  intentId: string,
  match: PersonalAgentMatch,
): Promise<CreateAndOpenResult> {
  if (match.ref.kind === 'opportunity') {
    return { status: 'existing', opportunityId: match.ref.id };
  }
  return opportunities.createAndOpen(userId, { intentId, candidateId: match.ref.id });
}
```

Then in `runKickoff`'s `mapWithConcurrency` body, resolve before briefing:

```ts
  const opens = await mapWithConcurrency(matches, kickoffConcurrency(), async (match) => {
    const resolved = await resolveMatchToOpportunity(deps.opportunities, context.userId, context.intentId, match);
    if (resolved.status === 'failed' || resolved.status === 'raced') {
      return { status: 'rejected' as const, reason: resolved.reason };
    }
    const brief = await judgment.brief(kickoffContext, {
      match,
      strategy,
      thread: threadByOpportunity.get(matchRefId(match)) ?? [],
    });
    const result = await deps.negotiations.invoke({
      opportunityId: resolved.opportunityId,
      brief,
      intentId: context.intentId,
      round,
    });
    if (result.status === "error") throw new Error(result.error ?? "Negotiation open failed");
    return result;
  });
```

The existing loop below already routes `status === 'rejected'` into `compensateFailedOpen`, so a create-but-not-open and a create-that-failed both land there. In `compensateFailedOpen`, the negotiation-task lookup must tolerate a match whose row was never created — guard the lookup on `match.ref.kind === 'opportunity'` and log-and-return otherwise, since there is no task to compensate.

- [ ] **Step 4: Run the test and the suite**

Run: `cd packages/protocol && bun test src/internal/agents/personal-agent/`
Expected: PASS

- [ ] **Step 5: Run the e2e**

Run: `cd packages/protocol && bun test src/capabilities/tests/personal-agent.e2e.spec.ts`
Expected: PASS — the fixture's `createAndOpen` from Task 5 supplies the id.

- [ ] **Step 6: Commit**

```bash
git add packages/protocol/src/internal/agents/personal-agent
git commit -m "feat: kickoff materializes candidate matches before opening"
```

---

## Task 7: Discovery emits candidates instead of persisting

**This is the flip.** Everything before it was additive.

**Files:**
- Create: `packages/protocol/src/internal/opportunities/opportunity.graph.emit-candidates.ts`
- Delete: `packages/protocol/src/internal/opportunities/opportunity.graph.persist-node.ts`
- Delete: `packages/protocol/src/internal/opportunities/opportunity.persist.ts`
- Delete: `packages/protocol/src/internal/opportunities/opportunity.enricher.ts`
- Delete: `packages/protocol/src/internal/opportunities/opportunity.newborn-stamping.ts`
- Delete: `packages/protocol/src/internal/opportunities/opportunity.persistence-admission.ts` (keep `admitOpportunityPersistence`'s network-eligibility filter — move it into `emit-candidates.ts` if `emitCandidatesNode` still needs the allowed-network check)
- Delete: `packages/protocol/src/internal/opportunities/tests/opportunity.persist.spec.ts`, `tests/opportunity.persistence-admission.spec.ts`
- Modify: `packages/protocol/src/internal/opportunities/opportunity.graph.ts`
- Modify: `packages/protocol/src/internal/opportunities/opportunity.graph.matches-ready.ts`
- Modify: `packages/protocol/src/internal/opportunities/opportunity.state.ts`
- Modify: `packages/protocol/src/internal/opportunities/opportunity.graph.shared.ts` (drop `DEDUP_WINDOW_MS`, `belongsToOwnedIntent`, `triggerForOwner`, `isActiveNegotiationTaskFresh`, `persistDedupLog`, `persistPathLog` if unused elsewhere — check with rg first)
- Test: `packages/protocol/src/internal/opportunities/tests/opportunity.graph.emit-candidates.spec.ts`

**Interfaces:**
- Consumes: `pairKeyOf`, `CreateDiscoveryMatchCandidateData` (Task 1).
- Produces: `emitCandidatesNode(state, deps)` returning `{ candidatesEmitted: DiscoveryMatchCandidate[]; trace: [...] }`.

- [ ] **Step 1: Write the failing test**

```ts
// packages/protocol/src/internal/opportunities/tests/opportunity.graph.emit-candidates.spec.ts
import { describe, expect, it } from 'bun:test';
import { emitCandidatesNode } from '../opportunity.graph.emit-candidates.js';
import { pairKeyOf } from '../opportunity.candidates.js';

const baseState = {
  userId: 'alice',
  networkId: 'net-1',
  triggerIntentId: 'intent-a',
  resolvedTriggerIntentId: 'intent-a',
  evaluatedOpportunities: [{
    actors: [
      { userId: 'alice', networkId: 'net-1', role: 'party', intentId: 'intent-a' },
      { userId: 'bob', networkId: 'net-1', role: 'party', intentId: 'intent-b' },
    ],
    score: 74,
    reasoning: 'Both are building agent infrastructure.',
    evidence: [],
  }],
} as never;

describe('emitCandidatesNode', () => {
  it('writes candidates and never creates an opportunity', async () => {
    const upserted: unknown[][] = [];
    const deps = {
      database: {
        upsertDiscoveryMatchCandidates: async (items: unknown[]) => { upserted.push(items); return items; },
        createOpportunity: () => { throw new Error('discovery must not create opportunities'); },
      },
    } as never;

    await emitCandidatesNode(baseState, deps);
    expect(upserted).toHaveLength(1);
    expect(upserted[0]).toHaveLength(1);
  });

  it('keys the candidate by the order-independent pair key', async () => {
    let seen: { pairKey: string } | undefined;
    const deps = {
      database: {
        upsertDiscoveryMatchCandidates: async (items: Array<{ pairKey: string }>) => { seen = items[0]; return items; },
      },
    } as never;

    await emitCandidatesNode(baseState, deps);
    expect(seen!.pairKey).toBe(pairKeyOf('net-1', 'intent-a', 'intent-b'));
  });

  it('emits nothing when the evaluator returned nothing', async () => {
    let called = false;
    const deps = {
      database: { upsertDiscoveryMatchCandidates: async () => { called = true; return []; } },
    } as never;

    await emitCandidatesNode({ ...baseState, evaluatedOpportunities: [] } as never, deps);
    expect(called).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `cd packages/protocol && bun test src/internal/opportunities/tests/opportunity.graph.emit-candidates.spec.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write `emit-candidates.ts`**

```ts
/**
 * Discovery pipeline, terminal stage: emit candidates.
 *
 * Replaces the persist node. Discovery no longer creates opportunities — it
 * records the pairs it found, keyed by `pairKey`, and the PersonalAgent that
 * decides to reach out is what turns one into a row.
 *
 * There is no dedup here, deliberately. The ~600 lines that used to live in
 * the persist node — the 30-day window, same-intent-pair suppression, latent
 * upgrades, orphan healing — existed because two discovery runs could each
 * INSERT a row for one pair. They cannot any more: the pair key is unique.
 */
import { timed } from '../shared/observability/performance.js';
import { pairKeyOf, type CreateDiscoveryMatchCandidateData } from './opportunity.candidates.js';
import { persistLog, type OpportunityGraphDeps, type OpportunityState } from './opportunity.graph.shared.js';

export async function emitCandidatesNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  return timed('OpportunityGraph.emitCandidates', async () => {
    if (state.evaluatedOpportunities.length === 0) {
      persistLog.verbose('No candidates to emit', { triggerIntentId: state.triggerIntentId });
      return { candidatesEmitted: [] };
    }

    const items: CreateDiscoveryMatchCandidateData[] = [];
    for (const evaluated of state.evaluatedOpportunities) {
      const own = evaluated.actors.find((actor) => actor.userId === state.userId);
      const other = evaluated.actors.find((actor) => actor.userId !== state.userId);
      const networkId = (state.networkId ?? own?.networkId ?? other?.networkId) as string | undefined;
      // A pair is two seated intents in one network. Anything else is not a
      // pair this model can open, so it is dropped rather than half-recorded.
      if (!own?.intentId || !other?.intentId || !networkId) {
        persistLog.warn('Dropping a match without two seated intents', {
          triggerIntentId: state.triggerIntentId,
          ownIntent: own?.intentId, otherIntent: other?.intentId, networkId,
        });
        continue;
      }
      items.push({
        pairKey: pairKeyOf(networkId, own.intentId, other.intentId),
        networkId, intentA: own.intentId, intentB: other.intentId,
        userA: own.userId, userB: other.userId,
        score: evaluated.score,
        reasoning: evaluated.reasoning,
        evidence: evaluated.evidence ?? [],
      } as CreateDiscoveryMatchCandidateData);
    }

    if (items.length === 0) return { candidatesEmitted: [] };
    const candidatesEmitted = await deps.database.upsertDiscoveryMatchCandidates(items);
    persistLog.info('Emitted discovery candidates', {
      triggerIntentId: state.triggerIntentId, count: candidatesEmitted.length,
    });
    return {
      candidatesEmitted,
      trace: [{
        node: 'emit_candidates',
        detail: `Emitted ${candidatesEmitted.length} candidate(s)`,
        data: { count: candidatesEmitted.length },
      }],
    };
  });
}
```

- [ ] **Step 4: Rewire the graph**

In `opportunity.graph.ts`: replace the `persist` node with `emitCandidates`, `ranking → emitCandidates`, and change the conditional edge to route on `state.candidatesEmitted?.length`. Delete the `persistNode`/`persistTraceSummary` import, the `stampNewbornOpportunities` constructor parameter and its `deps` field, and the `StampNewbornOpportunitiesFn` re-exports.

In `opportunity.state.ts`: add `candidatesEmitted` as an overwrite Annotation defaulting to `[]`; delete the `opportunities`, `existingBetweenActors` and `persistenceOutcome` Annotations and the `OpportunityPersistenceOutcome` interface.

In `opportunity.graph.matches-ready.ts`: derive the intent set from candidates. The whole introducer-filtering block goes:

```ts
export async function matchesReadyNode(state: OpportunityState, deps: OpportunityGraphDeps) {
  if (!deps.matchesReady) return {};
  const candidates = state.candidatesEmitted ?? [];
  if (candidates.length === 0) return {};

  // Both sides of every pair, not just the discovering user's: a candidate is
  // one row shared by two signals, and each one's agent decides for itself.
  const seats = new Map<string, { userId: string; intentId: string }>();
  for (const candidate of candidates) {
    seats.set(candidate.intentA, { userId: candidate.userA, intentId: candidate.intentA });
    seats.set(candidate.intentB, { userId: candidate.userB, intentId: candidate.intentB });
  }

  // Keep the existing allSettled + throw-on-any-failure block below verbatim:
  // a swallowed failure here is a batch that landed and an agent never woken.
  const emitted = await Promise.allSettled(
    [...seats.values()].map((seat) => deps.matchesReady!(seat)),
  );
  const failed = emitted.filter((result) => result.status === 'rejected');
  if (failed.length > 0) {
    matchesReadyLog.error('Failed to emit matches_ready', {
      seats: seats.size, failed: failed.length,
      error: (failed[0] as PromiseRejectedResult).reason,
    });
    throw new Error(`Could not wake ${failed.length} of ${seats.size} signal(s) for their new matches`);
  }
  return {
    trace: [{
      node: 'matches_ready',
      detail: `${seats.size} signal(s) notified for ${candidates.length} candidate(s)`,
      data: { candidateCount: candidates.length, seats: seats.size },
    }],
  };
}
```

Note this widens the wake from one side to both — which is correct and is what makes the pair advisory lock load-bearing. Each wake needs the *owning* user of that intent, which is why seats are emitted as `{ userId, intentId }` pairs rather than deriving `userId` from `state`.

- [ ] **Step 5: Delete the dedup modules**

```bash
cd /Users/yanek/Projects/index/.worktrees/feat-single-path-opportunities
git rm packages/protocol/src/internal/opportunities/opportunity.graph.persist-node.ts \
       packages/protocol/src/internal/opportunities/opportunity.persist.ts \
       packages/protocol/src/internal/opportunities/opportunity.enricher.ts \
       packages/protocol/src/internal/opportunities/opportunity.newborn-stamping.ts \
       packages/protocol/src/internal/opportunities/tests/opportunity.persist.spec.ts
rg -n 'persistNode|persistOpportunities|stampNewborn|DEDUP_WINDOW_MS|opportunity\.enricher' packages services apps
```

Every remaining hit is a delete target. Work through them until the rg is empty.

- [ ] **Step 6: Run the opportunity suite**

Run: `cd packages/protocol && bun test src/internal/opportunities/`
Expected: PASS. Two specs in this directory flake only on whole-directory runs — if one fails, re-run that file alone before treating it as yours.

- [ ] **Step 7: Assert discovery creates nothing**

Run: `cd services/api && NODE_ENV=test bun test src/queues/tests/`
Expected: PASS, with the from-intent queue test asserting zero `createOpportunity` calls. If no such assertion exists, add it.

- [ ] **Step 8: Commit**

```bash
git add -A packages/protocol/src/internal/opportunities services/api/src/queues
git commit -m "feat: discovery emits candidates; delete persist-time dedup"
```

---

## Task 8: Delete manual (#3), introduction (#4) and send

**Files:**
- Modify: `services/api/src/controllers/opportunity.controller.ts`, `services/api/src/services/opportunity.service.ts`
- Modify: `packages/protocol/src/internal/opportunities/opportunity.graph.modes.ts`, `opportunity.lifecycle.ts`, `opportunity.utils.ts`, `opportunity.actor.ts`
- Modify: `apps/web/src/components/.../OpportunityCardInChat.tsx`, `apps/web/src/hooks/useOpportunityActions.tsx`

- [ ] **Step 1: Find every call site**

```bash
cd /Users/yanek/Projects/index/.worktrees/feat-single-path-opportunities
rg -n 'createManualOpportunity|createIntroduction|approveIntroduction|approve_introduction|create_introduction|sendOpportunity|evaluateIntroduction|validateIntroduction|introductionContext' packages services apps
```

- [ ] **Step 2: Delete the route and service method**

Remove `POST /networks/:networkId/opportunities` from `opportunity.controller.ts` and `createManualOpportunity` from `opportunity.service.ts`, plus their zod schemas.

- [ ] **Step 3: Delete the graph modes**

From `opportunity.graph.modes.ts`, delete `createIntroduction`, `approveIntroduction`, `sendOpportunity`, `evaluateIntroduction`, `validateIntroduction`, `buildIntroductionOpportunity` and the `IntroductionRequest` type. From `opportunity.graph.ts`, delete the matching `OpportunityGraphFactory` delegating methods and re-exports. From `opportunity.lifecycle.ts`, delete `approveOpportunityIntroduction` and `sendOpportunityLifecycle`.

- [ ] **Step 4: Delete the introducer role**

```bash
rg -n "introducer" packages/protocol/src services/api/src apps/web/src
```

Every branch guarding on `role === 'introducer'`, every `withIntroducerActor`, every `approved` field on an actor, and the `'introducer'` member of the actor role union. In `negotiator-verdict.host.ts` the two introducer filters in `readSignalMatches` go, and `PERSONAL_AGENT_MATCH_STATUSES` becomes `['negotiating', 'stalled', 'pending']` — `latent` and `draft` no longer exist. Delete `STATE_LINE.latent` and `STATE_LINE.draft`; keep the `found` line added in Task 3.

- [ ] **Step 5: Delete the web surfaces**

Remove the introducer approval affordance from `OpportunityCardInChat.tsx` and the `approveIntroduction` / `sendOpportunity` mutations from `useOpportunityActions.tsx`, plus their service-client methods in `apps/web/src/services/`.

- [ ] **Step 6: Verify and commit**

Run: `cd packages/protocol && bunx tsc --noEmit && bun run test:shared`
Run: `cd services/api && bunx tsc --noEmit`
Run: `cd apps/web && bunx tsc --noEmit`
Expected: no errors.

```bash
git add -A && git commit -m "feat: delete manual, introduction and send opportunity paths"
```

---

## Task 9: Delete maintenance (#2), enrichment (#5) and discover-tool traces (#6)

**Files:**
- Delete: `packages/protocol/src/internal/maintenance/`
- Modify: `services/api/src/main.ts`, `services/api/src/events/intent.event.ts`, `packages/protocol/src/internal/opportunities/radar/radar.graph.ts`
- Delete: the doc files listed in the spec's "Docs to delete"

- [ ] **Step 1: Find every trace**

```bash
cd /Users/yanek/Projects/index/.worktrees/feat-single-path-opportunities
rg -n 'triggerMaintenance|MaintenanceGraph|maintenanceGraph|rediscovery|from-enrichment|from-introducer|connector-flow|discover_opportunities|get_discovery_run|cancel_discovery_run|premise-similarity|context-similarity|context-to-intent|introducer_discovery' packages services apps docs
```

- [ ] **Step 2: Delete the maintenance module and its hooks**

```bash
git rm -r packages/protocol/src/internal/maintenance
```

Remove its exports from `packages/protocol/src/index.ts`, the `triggerMaintenance` calls from `intent.event.ts`, and any maintenance queue/worker registration in `main.ts`.

- [ ] **Step 3: Delete the non-HyDE discovery legs**

In `opportunity.graph.discovery-strategies.ts`, delete the `premise-similarity`, `context-similarity` and `context-to-intent` strategies, leaving HyDE `query` as the only one. Delete the `discoverySource` discriminator if `'intent'` becomes its only value.

- [ ] **Step 4: Delete the `connector-flow` radar category**

In `radar/radar.graph.ts` and its types, remove the category and any branch producing it.

- [ ] **Step 5: Delete the stale docs**

```bash
git rm docs/handoffs/refactor-discover-opportunities-rename.md \
       docs/specs/2026-05-12-discover-opportunities-rename-design.md \
       docs/specs/2026-05-06-expose-introducer-opportunities-to-pollers-design.md \
       docs/rollout/background-only-discovery-release-1.md
```

Rewrite `docs/domain/opportunities.md`'s Discovery Triggers section to intent-only, and delete the maintenance half of `docs/domain/radar-and-maintenance.md` (renaming the file to `docs/domain/radar.md`).

- [ ] **Step 6: Verify and commit**

Run: `cd packages/protocol && bun run architecture:check && bunx tsc --noEmit`
Run: `cd services/api && bunx tsc --noEmit`

```bash
git add -A && git commit -m "feat: delete maintenance, enrichment and discover-tool paths"
```

---

## Task 10: Data migration

**Files:**
- Create: `services/api/drizzle/0156_single_path_opportunities.sql` (hand-written; drizzle-kit does not generate enum-value drops)
- Modify: `services/api/src/schemas/database.schema.ts:12`

- [ ] **Step 1: Narrow the enum in the schema**

```ts
export const opportunityStatusEnum = pgEnum('opportunity_status', ['negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired']);
```

- [ ] **Step 2: Write the migration by hand**

Postgres cannot drop a value from an enum in place; the type is rebuilt.

```sql
-- Rows from the deleted creation paths. No archive: the spec's policy is
-- delete-and-migrate, not dual-read.
DELETE FROM opportunities
WHERE status IN ('latent', 'draft')
   OR detection->>'source' IN ('manual', 'enrichment', 'introducer_discovery')
   OR actors @> '[{"role": "introducer"}]';

-- Strip the introducer role from any surviving mixed-actor row.
UPDATE opportunities
SET actors = (
  SELECT COALESCE(jsonb_agg(actor - 'approved'), '[]'::jsonb)
  FROM jsonb_array_elements(actors) AS actor
  WHERE actor->>'role' <> 'introducer'
);

-- Rebuild opportunity_status without 'latent' and 'draft'.
ALTER TYPE opportunity_status RENAME TO opportunity_status_old;
CREATE TYPE opportunity_status AS ENUM ('negotiating', 'pending', 'stalled', 'accepted', 'rejected', 'expired');
ALTER TABLE opportunities
  ALTER COLUMN status DROP DEFAULT,
  ALTER COLUMN status TYPE opportunity_status USING status::text::opportunity_status,
  ALTER COLUMN status SET DEFAULT 'pending';
DROP TYPE opportunity_status_old;

-- One live opportunity per pair. Partial: a concluded pair may be reopened later.
CREATE UNIQUE INDEX opportunities_active_pair_idx
  ON opportunities ((context->>'networkId'), (actors->0->>'intent'), (actors->1->>'intent'))
  WHERE status IN ('negotiating', 'pending', 'stalled');
```

**Read this before applying:** the partial unique index above assumes `actors[0]` and `actors[1]` are in a stable order. `createAndOpen` (Task 4) writes them in candidate order (`userA`/`intentA` first), which is derived from `pairKeyOf`'s sort — so the order IS stable for rows this program creates. Confirm no surviving pre-migration row violates it before adding the index:

```sql
SELECT COUNT(*) FROM (
  SELECT context->>'networkId', actors->0->>'intent', actors->1->>'intent'
  FROM opportunities WHERE status IN ('negotiating', 'pending', 'stalled')
  GROUP BY 1, 2, 3 HAVING COUNT(*) > 1
) dupes;
```

If that returns non-zero, resolve the duplicates in the migration (keep the newest per group, expire the rest) before the `CREATE UNIQUE INDEX`.

- [ ] **Step 3: Apply to the test database**

Run: `cd services/api && bun run db:migrate:test`
Expected: applies cleanly.

- [ ] **Step 4: Verify the enum**

Run: `cd services/api && NODE_ENV=test bun run db:studio` — or query directly:
```sql
SELECT enumlabel FROM pg_enum
JOIN pg_type ON pg_type.oid = pg_enum.enumtypid
WHERE typname = 'opportunity_status' ORDER BY enumsortorder;
```
Expected: exactly six labels, no `latent`, no `draft`.

- [ ] **Step 5: Commit**

```bash
git add services/api/drizzle services/api/src/schemas/database.schema.ts
git commit -m "feat: migrate off latent, draft and introducer"
```

---

## Task 11: Trace audit to zero

- [ ] **Step 1: Run the full banned-token sweep**

```bash
cd /Users/yanek/Projects/index/.worktrees/feat-single-path-opportunities
rg -n 'createManualOpportunity|createIntroduction|approveIntroduction|approve_introduction|create_introduction|triggerMaintenance|[Mm]aintenanceGraph|discover_opportunities|get_discovery_run|cancel_discovery_run|introducer_discovery|connector-flow|sendOpportunity|premise-similarity|context-similarity|context-to-intent|from-enrichment|from-introducer|rediscovery|introducer' \
  packages/protocol/src services/api/src apps/web/src docs --glob '!CHANGELOG.md' --glob '!docs/design/single-path-opportunities.md' --glob '!docs/plans/2026-08-27-single-path-opportunities.md'
```

Expected at the start of this task: a shrinking remainder from Tasks 8–9. Expected at the end: **zero hits.**

- [ ] **Step 2: Check file names**

```bash
fd -I 'introducer|maintenance|rediscovery|enricher|newborn' packages services apps
```
Expected: no results.

- [ ] **Step 3: Check the status literals are gone**

```bash
rg -n "'latent'|'draft'|\"latent\"|\"draft\"" packages/protocol/src services/api/src apps/web/src
```
Expected: no results.

- [ ] **Step 4: Commit any stragglers**

```bash
git add -A && git commit -m "chore: clear remaining single-path trace hits"
```

---

## Task 12: Protocol major bump

**Files:**
- Modify: `packages/protocol/package.json`, `packages/protocol/CHANGELOG.md`, `packages/protocol/src/index.ts`

- [ ] **Step 1: Bump the major**

Increment the major in `packages/protocol/package.json`. Check `bun run check:subtree-parity` requirements: `protocol`, `cli`, `claude-plugin`, `hermes-plugin` dependency versions must be pinned exactly.

- [ ] **Step 2: Write the CHANGELOG entry**

```markdown
## <new major>.0.0

### Breaking

- `PersonalAgentMatch.opportunityId` replaced by `ref: { kind: 'candidate' | 'opportunity'; id: string }`. Use `matchRefId(match)` where you read the id.
- `PersonalAgentOpportunityPort` requires `createAndOpen`.
- Removed: `MaintenanceGraphFactory`, `createIntroduction`, `approveIntroduction`, `sendOpportunity`, `evaluateIntroduction`, `validateIntroduction`, `StampNewbornOpportunitiesFn`, `OpportunityPersistenceOutcome`, `IntroductionRequest`.
- `OpportunityStatus` no longer includes `latent` or `draft`.
- The `introducer` actor role is removed.
- Discovery no longer creates opportunities. It writes `discovery_match_candidates`; a host must implement `upsertDiscoveryMatchCandidates` and `listPendingCandidatesForIntent`.

### Added

- `pairKeyOf`, `DiscoveryMatchCandidate`, `CreateDiscoveryMatchCandidateData`, `CreateAndOpenResult`, `matchRefId`, `opportunityRef`.
```

- [ ] **Step 3: Update `IMPLEMENTATION.md`**

Add the two candidate methods to the required-interface list and remove any maintenance/introduction entries.

- [ ] **Step 4: Full verification**

Run: `cd packages/protocol && bun run architecture:check && bun run test:shared`
Run: `cd services/api && bunx tsc --noEmit && NODE_ENV=test bun test`
Run: `cd apps/web && bunx tsc --noEmit`
Run: `bun run check:subtree-parity`

For the API suite, compare the failure set against a clean `origin/dev` run before treating any of it as caused by this branch.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "feat!: protocol major — single-path opportunities"
```

---

## Deferred to PR B

Not in this plan, per the spec:
- CI grep gate (spec §Phase 5) — add it once PR A has soaked, so a red gate cannot block the change that makes it green.
- Floor lab alignment (spec §Phase 6).
- `packages/edge-city/agentvillage/skills/` `discover_opportunities` references (spec §Open questions).
- The `pending`-after-negotiation audit (spec §Non-goals).
