# End-to-End Discovery Eval — Harness (Walking Skeleton) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a working end-to-end discovery eval in `backend/eval/discovery/` that seeds a small population's discovery inputs (profiles + premises + intents + user-contexts) with real embeddings, runs the REAL opportunity graph under both production triggers scoped to a dedicated eval network, asserts the true partner surfaces while distractors don't, and cleans up — runnable as `bun run eval:discovery`.

**Architecture:** This is the *walking skeleton* — the full machine proven on a 6-person fixture (2 ground-truth pairs + 2 background distractors). It wires the same adapters the production opportunity queues use (`ChatDatabaseAdapter`, `EmbedderAdapter`, `HydeGraphFactory`, `OpportunityGraphFactory`) against the `.env.test` Neon DB, seeds rows directly via Drizzle with explicit `runId`-prefixed ids, invokes the graph, reads opportunities back via `getOpportunitiesForUser`, and tears everything down. A **follow-up plan** scales the population to ~65 (15 real pairs + 35 background) and runs a calibration baseline.

**Tech Stack:** Bun, TypeScript (strict), Drizzle ORM + Postgres (pgvector, 2000-dim), `@indexnetwork/protocol` graph factories, real OpenRouter embeddings + HyDE + evaluator. Opt-in; NOT part of `bun test`.

**Spec:** `docs/superpowers/specs/2026-05-27-end-to-end-discovery-eval-design.md`

---

## Critical context for the implementer (verified, verbatim from `dev`)

**Graph wiring** (copy from `backend/src/queues/opportunity/from-intent.queue.ts:114-130` and `from-profile.queue.ts:54`):
```typescript
import { ChatDatabaseAdapter } from '../../src/adapters/database.adapter';
import { EmbedderAdapter } from '../../src/adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../src/adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
// graphDb is a ChatDatabaseAdapter cast to the graph's DB interface:
const graphDb = new ChatDatabaseAdapter() as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
const embedder = new EmbedderAdapter();
const cache = new RedisCacheAdapter();
const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, new LensInferrer(), new HydeGenerator()).createGraph();
// Omit negotiation + dispatcher + queueNegotiateExisting → candidates persist as-is (no negotiation side-effects):
const opportunityGraph = new OpportunityGraphFactory(graphDb, embedder, hydeGraph, undefined, undefined, undefined, undefined, undefined).createGraph();
```
> The exact import paths above are relative to `backend/eval/discovery/`. Confirm `OpportunityGraphDatabase`/`HydeGraphDatabase` are exported from `@indexnetwork/protocol`; the queue imports them — mirror that import. Do NOT guess; if an import differs, read the queue file and match it.

**Invoke shapes** (verbatim):
- per-intent: `{ userId, searchQuery: <intent payload>, operationMode: 'create', networkId: <evalNetworkId>, triggerIntentId: <intentId>, options: { initialStatus: 'latent' } }`
- no-intent (onboarding): `{ userId, operationMode: 'create', networkId: <evalNetworkId>, options: { initialStatus: 'latent' } }`
- `const result = await opportunityGraph.invoke(invokeOpts);` — the graph persists opportunities itself (via `persistOpportunities` → `createOpportunity`); created opportunities have `status: 'latent'`.

**Schema (Drizzle, `backend/src/schemas/database.schema.ts`)** — exact columns:
- `users`: `{ id, email, name, isGhost, ... }` (id is text; pass explicit id to override the default).
- `userProfiles`: `{ id, userId, identity: {name,bio,location}, narrative: {context}, attributes: {interests,skills} }`.
- `premises`: `{ id, userId, assertion: jsonb, provenance: jsonb, validity: jsonb, analysis?: jsonb, embedding: vector(2000), status: 'ACTIVE' }`.
- `userContexts`: `{ id, userId, networkId, text, embedding: vector(2000) }` (unique on (userId, networkId)).
- `intents`: `{ id, userId, payload, summary, embedding: vector(2000), status: 'ACTIVE' }`.
- `networks`: `{ id, title, prompt, isPersonal: false, type: 'community' }`.
- `networkMembers`: `{ networkId, userId, permissions: text[], autoAssign }` (PK = (networkId, userId)).
- `intentNetworks`: `{ intentId, networkId, relevancyScore }` (PK = (intentId, networkId)).
- `opportunities`: `{ id, detection, actors: OpportunityActor[], interpretation: {category,reasoning,confidence}, context, confidence, status }`. `OpportunityActor = { networkId, userId, role: string, intent?, premise?, ... }`.

**Drizzle client:** `import db from '../../src/lib/drizzle/drizzle';` — singleton; embeddings written as raw `number[]`. Insert idiom: `await db.insert(schema.table).values({...}).returning({ id: schema.table.id });`. Import schema: `import * as schema from '../../src/schemas/database.schema';`.

**Embedder:** `const v = await embedder.generate(text) as number[];` returns a 2000-dim `number[]` for a single string.

**Read-back:** `await graphDb.getOpportunitiesForUser(userId, { networkId, statuses: ['latent','draft','pending','negotiating'] })` → `OpportunityRow[]` with `actors` (find the actor whose `userId !== discovererId` = counterparty) and `interpretation.confidence`/`.reasoning`.

**Env/runner:** load env with `import '../../src/startup.env';` at the top of the CLI and any DB-touching spec. Run specs with `bun --env-file=.env.test test <path>`; the CLI runs via the `eval:discovery` script (Task 5).

---

## File Structure

All under `backend/eval/discovery/`:
- `discovery.types.ts` — `SeedPerson`, `SeedPair`, `Population`, `SeededWorld`, `DiscoveryCaseResult`.
- `discovery.fixture.ts` — the 6-person walking-skeleton `Population` (2 pairs + 2 background).
- `discovery.seed.ts` — `seedPopulation(pop): Promise<SeededWorld>` (real embeddings, prefixed ids).
- `discovery.cleanup.ts` — `cleanupWorld(world): Promise<void>` (FK-ordered deletes).
- `discovery.runner.ts` — `runDiscovery(world, discovererKey, trigger): Promise<void>` (real graph) + `readOpportunities(world, discovererKey)`.
- `discovery.scorer.ts` — `scorePair(world, pair, opps): DiscoveryCaseResult` (two-level).
- `discovery.reporter.ts` — `formatScorecard(results): string`.
- `discovery.eval.ts` — CLI entry.
- `tests/discovery.fixture.spec.ts` — deterministic structural test (no DB).
- `tests/discovery.scorer.spec.ts` — deterministic unit test (fabricated opps, no DB).
- `tests/discovery.seed.spec.ts` — integration smoke (real DB + embedder).
- `tests/discovery.runner.spec.ts` — integration smoke (real DB + embedder + LLM).
- `README.md` — how to run.

---

## Task 1: Scaffold, types, and the fixture (deterministic TDD)

**Files:**
- Create: `backend/eval/discovery/discovery.types.ts`
- Create: `backend/eval/discovery/discovery.fixture.ts`
- Test: `backend/eval/discovery/tests/discovery.fixture.spec.ts`

- [ ] **Step 1: Write the failing structural test**

Create `backend/eval/discovery/tests/discovery.fixture.spec.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { FIXTURE } from '../discovery.fixture';

describe('discovery fixture', () => {
  it('has 6 people and 2 ground-truth pairs', () => {
    expect(FIXTURE.people.length).toBe(6);
    expect(FIXTURE.pairs.length).toBe(2);
  });

  it('every person has a profile, >=2 premises, and a context paragraph', () => {
    for (const p of FIXTURE.people) {
      expect(p.profile.bio.length).toBeGreaterThan(0);
      expect(p.premises.length).toBeGreaterThanOrEqual(2);
      expect(p.contextText.length).toBeGreaterThan(0);
    }
  });

  it('every pair references a discoverer (with intent) and a partner that exist in people', () => {
    const byKey = new Map(FIXTURE.people.map((p) => [p.key, p]));
    for (const pair of FIXTURE.pairs) {
      const disc = byKey.get(pair.discovererKey);
      const partner = byKey.get(pair.partnerKey);
      expect(disc).toBeDefined();
      expect(partner).toBeDefined();
      expect(disc!.intent && disc!.intent.length > 0).toBe(true);
    }
  });

  it('person keys are unique', () => {
    const keys = FIXTURE.people.map((p) => p.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && bun test eval/discovery/tests/discovery.fixture.spec.ts`
Expected: FAIL — `Cannot find module '../discovery.fixture'`.

- [ ] **Step 3: Write the types**

Create `backend/eval/discovery/discovery.types.ts`:
```typescript
/** One seeded person: their discovery inputs (profile + premises + context, optional intent). */
export interface SeedPerson {
  /** Stable handle used to build runId-prefixed ids and cross-reference pairs. */
  key: string;
  profile: {
    name: string;
    bio: string;
    location: string;
    interests: string[];
    skills: string[];
    /** profile.narrative.context */
    context: string;
  };
  /** Assertion texts; each is embedded and stored as a premise row. */
  premises: string[];
  /** Seeking intent payload; only discoverers have one. Embedded + stored + linked to the eval network. */
  intent?: string;
  /** Network-scoped user-context paragraph; embedded and stored. */
  contextText: string;
}

/** A documented ground-truth pair: the discoverer's eventual partner must surface; nobody else should. */
export interface SeedPair {
  /** Case id, e.g. "pair/builder-operator". */
  id: string;
  discovererKey: string;
  partnerKey: string;
}

export interface Population {
  people: SeedPerson[];
  pairs: SeedPair[];
}

/** Handles returned by the seeder; used by runner, scorer, and cleanup. */
export interface SeededWorld {
  runId: string;
  networkId: string;
  /** key -> seeded userId */
  userIdByKey: Record<string, string>;
  /** key -> seeded intentId (only for people with an intent) */
  intentIdByKey: Record<string, string>;
  population: Population;
  /** Opportunity ids created during runs; filled by the runner, deleted by cleanup. */
  createdOpportunityIds: string[];
}

export interface DiscoveryCaseResult {
  pairId: string;
  /** True partner survived retrieval into the evaluated candidate set / surfaced as an opportunity. */
  retrieved: boolean;
  /** An opportunity pairs discoverer<->partner. */
  matched: boolean;
  /** Score (interpretation.confidence * 100) of the partner opportunity, or null if none. */
  partnerScore: number | null;
  /** keys of any non-partner people who wrongly surfaced as opportunities for this discoverer. */
  falsePositiveKeys: string[];
  passed: boolean;
}
```

- [ ] **Step 4: Write the fixture**

Create `backend/eval/discovery/discovery.fixture.ts`. Two pairs reuse the Tier-3 collaborations (anonymized; real names only in comments), each person gets premises + a context paragraph; two background personas add false-positive pressure.
```typescript
import type { Population } from './discovery.types';

// Anonymized; real identities in comments only, never in data.
// Pair 1 (builder+operator) — Real: Wozniak + Jobs. Pair 2 (investor+founder) — Real: an early angel + the founder they backed.
export const FIXTURE: Population = {
  people: [
    // ── Pair 1: operator (discoverer) + hardware builder (partner) ──
    {
      key: 'bo-a',
      profile: {
        name: 'Alex Mercer',
        bio: 'Commercial operator running a small electronics resale side business; convinced affordable personal computers can be sold to individuals. Persuasive, not an engineer.',
        location: 'Bay Area',
        interests: ['personal computing', 'consumer electronics', 'selling'],
        skills: ['sales', 'deal-making', 'sourcing parts'],
        context: 'A commercially-minded operator who wants to turn hobbyist computing into a product people can buy.',
      },
      premises: [
        'I run a small electronics resale business and know how to sell hardware to individuals.',
        'I believe affordable personal computers can reach ordinary people, not just companies.',
      ],
      intent: 'Find a brilliant hardware engineer to build an affordable personal-computer product I can sell to hobbyists and individuals.',
      contextText: 'A persuasive commercial operator in the personal-computing scene seeking a technical co-builder to turn a hobbyist machine into a sellable product.',
    },
    {
      key: 'bo-b',
      profile: {
        name: 'Daniel Reyes',
        bio: 'Self-taught hardware engineer who designs elegant computer circuit boards for fun and shares schematics at his hobby club. Cares about the craft, not money.',
        location: 'Bay Area',
        interests: ['circuit design', 'personal computers', 'electronics'],
        skills: ['digital hardware design', 'circuit boards', 'microprocessors'],
        context: 'A gifted hardware engineer building personal-computer boards from scratch for the love of it.',
      },
      premises: [
        'I design and build personal-computer circuit boards from individual components.',
        'I share my hardware schematics openly at a hobbyist computer club.',
      ],
      contextText: 'A self-taught hardware engineer who designs personal-computer boards and shares them at a hobbyist club.',
    },
    // ── Pair 2: technical founder (discoverer) + first-check investor (partner) ──
    {
      key: 'fi-a',
      profile: {
        name: 'Sam Okonkwo',
        bio: 'Technical founder with a working prototype out of a university spinout scene. Strong engineering, no business network, no money.',
        location: 'Stanford area',
        interests: ['systems software', 'startups', 'search infrastructure'],
        skills: ['engineering', 'systems design', 'prototyping'],
        context: 'A technical founder with a prototype seeking a first believer to fund and guide it into a company.',
      },
      premises: [
        'I built a working prototype of systems software out of a university spinout.',
        'I have no business network or capital and need a first backer.',
      ],
      intent: 'Find a first-check investor in my domain and stage who will fund the prototype and give early guidance.',
      contextText: 'A technical founder with a working prototype seeking a first-check investor and early guidance.',
    },
    {
      key: 'fi-b',
      profile: {
        name: 'Walter Hsu',
        bio: 'Experienced angel who writes first checks into early technical teams in this exact domain and stage; rolls up his sleeves with founders.',
        location: 'Stanford area',
        interests: ['early-stage investing', 'deep tech', 'founder mentorship'],
        skills: ['first-check investing', 'technical diligence', 'founder coaching'],
        context: 'A hands-on first-check angel who backs early technical founders before anyone else.',
      },
      premises: [
        'I write first checks into pre-traction technical founders in deep tech.',
        'I work hands-on with founders right after their first prototype.',
      ],
      contextText: 'A hands-on first-check angel investor who backs early technical founders in deep tech.',
    },
    // ── Background personas (no true partner; pure false-positive pressure) ──
    {
      key: 'bg-1',
      profile: {
        name: 'Marina Vogel',
        bio: 'Classically trained cellist and music teacher; performs chamber recitals and teaches conservatory students.',
        location: 'Bay Area',
        interests: ['classical music', 'chamber music', 'teaching'],
        skills: ['cello', 'music theory', 'performance'],
        context: 'A classical musician and teacher with no connection to technology or startups.',
      },
      premises: [
        'I perform and teach classical chamber music.',
        'I train conservatory-level cello students.',
      ],
      contextText: 'A classical cellist and music teacher focused on chamber performance and instruction.',
    },
    {
      key: 'bg-2',
      profile: {
        name: 'Priya Anand',
        bio: 'Hospital operations manager focused on staffing and logistics for a regional clinic network.',
        location: 'Austin, TX',
        interests: ['healthcare operations', 'logistics', 'staffing'],
        skills: ['operations management', 'scheduling', 'process improvement'],
        context: 'A healthcare operations manager handling staffing and logistics for clinics.',
      },
      premises: [
        'I manage staffing and logistics for a network of regional clinics.',
        'I improve operational processes in healthcare settings.',
      ],
      contextText: 'A healthcare operations manager handling clinic staffing, logistics, and process improvement.',
    },
  ],
  pairs: [
    { id: 'pair/builder-operator', discovererKey: 'bo-a', partnerKey: 'bo-b' },
    { id: 'pair/investor-founder', discovererKey: 'fi-a', partnerKey: 'fi-b' },
  ],
};
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && bun test eval/discovery/tests/discovery.fixture.spec.ts`
Expected: PASS (4 tests).

- [ ] **Step 6: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**
```bash
git add backend/eval/discovery/discovery.types.ts backend/eval/discovery/discovery.fixture.ts backend/eval/discovery/tests/discovery.fixture.spec.ts
git commit -m "feat(eval): scaffold end-to-end discovery eval types + walking-skeleton fixture"
```

---

## Task 2: Seeder + cleanup (integration against the test DB)

**Files:**
- Create: `backend/eval/discovery/discovery.seed.ts`
- Create: `backend/eval/discovery/discovery.cleanup.ts`
- Test: `backend/eval/discovery/tests/discovery.seed.spec.ts`

This task hits the real `.env.test` DB and the real embedder. The "test" is an integration smoke check (seed → assert rows → cleanup → assert gone), not a pure unit test.

- [ ] **Step 1: Write the seeder**

Create `backend/eval/discovery/discovery.seed.ts`:
```typescript
import db from '../../src/lib/drizzle/drizzle';
import * as schema from '../../src/schemas/database.schema';
import { EmbedderAdapter } from '../../src/adapters/embedder.adapter';
import type { Population, SeededWorld } from './discovery.types';

const embedder = new EmbedderAdapter();
const embed = async (text: string): Promise<number[]> => (await embedder.generate(text)) as number[];

/** Seed a population into a dedicated eval network with real embeddings. All ids are runId-prefixed. */
export async function seedPopulation(pop: Population): Promise<SeededWorld> {
  const runId = `eval-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  const networkId = `${runId}-net`;
  const userIdByKey: Record<string, string> = {};
  const intentIdByKey: Record<string, string> = {};

  // 1. Eval network (community, not personal).
  await db.insert(schema.networks).values({
    id: networkId,
    title: `Eval network ${runId}`,
    prompt: 'A closed evaluation community used by the end-to-end discovery eval.',
    isPersonal: false,
    type: 'community',
  });

  // 2. Per person: user, profile, premises, intent, context, membership.
  for (const person of pop.people) {
    const userId = `${runId}-u-${person.key}`;
    userIdByKey[person.key] = userId;

    await db.insert(schema.users).values({
      id: userId,
      email: `${userId}@eval.invalid`,
      name: person.profile.name,
      isGhost: false,
    });

    await db.insert(schema.userProfiles).values({
      id: `${runId}-prof-${person.key}`,
      userId,
      identity: { name: person.profile.name, bio: person.profile.bio, location: person.profile.location },
      narrative: { context: person.profile.context },
      attributes: { interests: person.profile.interests, skills: person.profile.skills },
    });

    let pi = 0;
    for (const assertion of person.premises) {
      await db.insert(schema.premises).values({
        id: `${runId}-prem-${person.key}-${pi++}`,
        userId,
        assertion: { text: assertion, tier: 'assertive' },
        provenance: { source: 'onboarding', confidence: 1, timestamp: new Date().toISOString() },
        validity: { volatile: false },
        embedding: await embed(assertion),
        status: 'ACTIVE',
      });
    }

    await db.insert(schema.userContexts).values({
      id: `${runId}-ctx-${person.key}`,
      userId,
      networkId,
      text: person.contextText,
      embedding: await embed(person.contextText),
    });

    await db.insert(schema.networkMembers).values({
      networkId,
      userId,
      permissions: ['member'],
      autoAssign: false,
    });

    if (person.intent) {
      const intentId = `${runId}-int-${person.key}`;
      intentIdByKey[person.key] = intentId;
      await db.insert(schema.intents).values({
        id: intentId,
        userId,
        payload: person.intent,
        summary: person.intent,
        embedding: await embed(person.intent),
        status: 'ACTIVE',
      });
      await db.insert(schema.intentNetworks).values({
        intentId,
        networkId,
        relevancyScore: '1.0',
      });
    }
  }

  return { runId, networkId, userIdByKey, intentIdByKey, population: pop, createdOpportunityIds: [] };
}
```
> If any insert is rejected for a missing NOT-NULL column the schema requires, read that table in `backend/src/schemas/database.schema.ts` and supply it — do not invent values; use the schema default semantics (e.g. empty object/array). Report it as a concern.

- [ ] **Step 2: Write the cleanup**

Create `backend/eval/discovery/discovery.cleanup.ts`:
```typescript
import { inArray, eq, like } from 'drizzle-orm';
import db from '../../src/lib/drizzle/drizzle';
import * as schema from '../../src/schemas/database.schema';
import type { SeededWorld } from './discovery.types';

/** Delete everything created for a seeded world, in FK-safe order. Safe to call on partial worlds. */
export async function cleanupWorld(world: SeededWorld): Promise<void> {
  const userIds = Object.values(world.userIdByKey);
  const intentIds = Object.values(world.intentIdByKey);

  if (world.createdOpportunityIds.length > 0) {
    await db.delete(schema.opportunities).where(inArray(schema.opportunities.id, world.createdOpportunityIds));
  }
  if (intentIds.length > 0) {
    await db.delete(schema.intentNetworks).where(inArray(schema.intentNetworks.intentId, intentIds));
    await db.delete(schema.intents).where(inArray(schema.intents.id, intentIds));
  }
  if (userIds.length > 0) {
    await db.delete(schema.userContexts).where(inArray(schema.userContexts.userId, userIds));
    await db.delete(schema.premises).where(inArray(schema.premises.userId, userIds));
    await db.delete(schema.networkMembers).where(inArray(schema.networkMembers.userId, userIds));
    await db.delete(schema.userProfiles).where(inArray(schema.userProfiles.userId, userIds));
  }
  await db.delete(schema.networks).where(eq(schema.networks.id, world.networkId));
  if (userIds.length > 0) {
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }
}

/** Safety sweep: delete stale eval rows from prior aborted runs (networks whose id starts with "eval-"). */
export async function sweepStaleEvalNetworks(): Promise<void> {
  await db.delete(schema.networks).where(like(schema.networks.id, 'eval-%'));
}
```
> Note: `sweepStaleEvalNetworks` only removes stale eval networks (cheap best-effort). Per-run cleanup via `cleanupWorld` is authoritative. If FK constraints reject a delete order, reorder per the actual constraints in the schema and report it.

- [ ] **Step 3: Write the integration smoke test**

Create `backend/eval/discovery/tests/discovery.seed.spec.ts`:
```typescript
import '../../../src/startup.env';
import { describe, it, expect, afterAll } from 'bun:test';
import { eq } from 'drizzle-orm';
import db from '../../../src/lib/drizzle/drizzle';
import * as schema from '../../../src/schemas/database.schema';
import { FIXTURE } from '../discovery.fixture';
import { seedPopulation } from '../discovery.seed';
import { cleanupWorld } from '../discovery.cleanup';
import type { SeededWorld } from '../discovery.types';

let world: SeededWorld;

describe('discovery seeder (integration)', () => {
  it('seeds users, profiles, premises (embedded), intents (embedded), contexts (embedded), members', async () => {
    world = await seedPopulation(FIXTURE);

    const users = await db.select().from(schema.users).where(eq(schema.users.id, world.userIdByKey['bo-a']));
    expect(users.length).toBe(1);

    const premises = await db.select().from(schema.premises).where(eq(schema.premises.userId, world.userIdByKey['bo-b']));
    expect(premises.length).toBeGreaterThanOrEqual(2);
    expect(premises[0].embedding && premises[0].embedding.length).toBe(2000);

    const intents = await db.select().from(schema.intents).where(eq(schema.intents.userId, world.userIdByKey['bo-a']));
    expect(intents.length).toBe(1);
    expect(intents[0].embedding && intents[0].embedding.length).toBe(2000);

    const ctx = await db.select().from(schema.userContexts).where(eq(schema.userContexts.userId, world.userIdByKey['fi-b']));
    expect(ctx.length).toBe(1);
    expect(ctx[0].embedding && ctx[0].embedding.length).toBe(2000);
  }, 120_000);

  afterAll(async () => {
    if (world) await cleanupWorld(world);
    // verify cleanup removed the network
    const net = await db.select().from(schema.networks).where(eq(schema.networks.id, world.networkId));
    expect(net.length).toBe(0);
  });
});
```

- [ ] **Step 4: Run the smoke test (real DB + embedder)**

Run: `cd backend && bun --env-file=.env.test test eval/discovery/tests/discovery.seed.spec.ts`
Expected: PASS. Embeddings have length 2000; afterAll cleanup leaves no eval network. (Requires `DATABASE_URL` + `OPENROUTER_API_KEY` from `.env.test`.)

- [ ] **Step 5: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**
```bash
git add backend/eval/discovery/discovery.seed.ts backend/eval/discovery/discovery.cleanup.ts backend/eval/discovery/tests/discovery.seed.spec.ts
git commit -m "feat(eval): seed discovery population with real embeddings + FK-safe cleanup"
```

---

## Task 3: Runner — the real opportunity graph, both triggers (integration)

**Files:**
- Create: `backend/eval/discovery/discovery.runner.ts`
- Test: `backend/eval/discovery/tests/discovery.runner.spec.ts`

- [ ] **Step 1: Write the runner**

Create `backend/eval/discovery/discovery.runner.ts`. Wire the graph exactly as `from-intent.queue.ts:114-130`; invoke per the two verbatim shapes; collect created opportunity ids onto the world for cleanup.
```typescript
import { ChatDatabaseAdapter } from '../../src/adapters/database.adapter';
import { EmbedderAdapter } from '../../src/adapters/embedder.adapter';
import { RedisCacheAdapter } from '../../src/adapters/cache.adapter';
import { OpportunityGraphFactory, HydeGraphFactory, HydeGenerator, LensInferrer } from '@indexnetwork/protocol';
import type { OpportunityGraphDatabase, HydeGraphDatabase } from '@indexnetwork/protocol';
import type { SeededWorld } from './discovery.types';

export type Trigger = 'intent' | 'profile';

/** Build the real opportunity graph + the graph DB adapter (negotiation/dispatcher omitted). */
function buildGraph() {
  const graphDb = new ChatDatabaseAdapter() as unknown as OpportunityGraphDatabase & HydeGraphDatabase;
  const embedder = new EmbedderAdapter();
  const cache = new RedisCacheAdapter();
  const hydeGraph = new HydeGraphFactory(graphDb, embedder, cache, new LensInferrer(), new HydeGenerator()).createGraph();
  const opportunityGraph = new OpportunityGraphFactory(graphDb, embedder, hydeGraph, undefined, undefined, undefined, undefined, undefined).createGraph();
  return { graphDb, opportunityGraph };
}

/**
 * Run real discovery for one discoverer, scoped to the eval network, then record any created
 * opportunity ids on the world (for cleanup). `trigger: 'intent'` uses the seeking intent;
 * `trigger: 'profile'` is the no-intent/onboarding path.
 */
export async function runDiscovery(world: SeededWorld, discovererKey: string, trigger: Trigger): Promise<void> {
  const { graphDb, opportunityGraph } = buildGraph();
  const userId = world.userIdByKey[discovererKey];

  const before = await graphDb.getOpportunitiesForUser(userId, { networkId: world.networkId });
  const beforeIds = new Set(before.map((o: { id: string }) => o.id));

  if (trigger === 'intent') {
    const person = world.population.people.find((p) => p.key === discovererKey)!;
    await opportunityGraph.invoke({
      userId,
      searchQuery: person.intent!,
      operationMode: 'create',
      networkId: world.networkId,
      triggerIntentId: world.intentIdByKey[discovererKey],
      options: { initialStatus: 'latent' },
    });
  } else {
    await opportunityGraph.invoke({
      userId,
      operationMode: 'create',
      networkId: world.networkId,
      options: { initialStatus: 'latent' },
    });
  }

  const after = await graphDb.getOpportunitiesForUser(userId, { networkId: world.networkId });
  for (const o of after) if (!beforeIds.has(o.id)) world.createdOpportunityIds.push(o.id);
}

/** Read all opportunities for a discoverer in the eval network. */
export async function readOpportunities(world: SeededWorld, discovererKey: string) {
  const { graphDb } = buildGraph();
  return graphDb.getOpportunitiesForUser(world.userIdByKey[discovererKey], { networkId: world.networkId });
}
```
> The graph `invoke` arg types come from `@indexnetwork/protocol`. If TS rejects the inline object, import the graph's invoke-input type and match it; do NOT loosen with `any`. If `getOpportunitiesForUser`'s option keys differ, read `backend/src/adapters/database.adapter.ts:2989` and match them.

- [ ] **Step 2: Write the integration smoke test**

Create `backend/eval/discovery/tests/discovery.runner.spec.ts`:
```typescript
import '../../../src/startup.env';
import { describe, it, expect, afterAll } from 'bun:test';
import { FIXTURE } from '../discovery.fixture';
import { seedPopulation } from '../discovery.seed';
import { cleanupWorld } from '../discovery.cleanup';
import { runDiscovery, readOpportunities } from '../discovery.runner';
import type { SeededWorld } from '../discovery.types';

let world: SeededWorld;

describe('discovery runner (integration, real graph)', () => {
  it('per-intent discovery for the operator surfaces the hardware builder as an opportunity', async () => {
    world = await seedPopulation(FIXTURE);
    await runDiscovery(world, 'bo-a', 'intent');

    const opps = await readOpportunities(world, 'bo-a');
    const partnerId = world.userIdByKey['bo-b'];
    const partnerOpp = opps.find((o) =>
      o.actors.some((a: { userId: string }) => a.userId === partnerId),
    );
    expect(partnerOpp).toBeDefined();

    // No opportunity should pair the operator with an unrelated background persona.
    const bg1 = world.userIdByKey['bg-1'];
    const bgOpp = opps.find((o) => o.actors.some((a: { userId: string }) => a.userId === bg1));
    expect(bgOpp).toBeUndefined();
  }, 180_000);

  afterAll(async () => {
    if (world) await cleanupWorld(world);
  });
});
```

- [ ] **Step 3: Run the smoke test (real DB + embedder + LLM)**

Run: `cd backend && bun --env-file=.env.test test eval/discovery/tests/discovery.runner.spec.ts`
Expected: PASS — the builder surfaces as an opportunity for the operator; the classical-musician background persona does not. This is the walking skeleton proving the real graph runs end-to-end against the seeded population. (Slow: real HyDE + evaluator. If it flakes on the background assertion, that is a *finding*, not necessarily a bug — note it and proceed; the partner-surfaces assertion is the gate.)

- [ ] **Step 4: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**
```bash
git add backend/eval/discovery/discovery.runner.ts backend/eval/discovery/tests/discovery.runner.spec.ts
git commit -m "feat(eval): run the real opportunity graph end-to-end over seeded population"
```

---

## Task 4: Scorer — two-level assertions (deterministic TDD)

**Files:**
- Create: `backend/eval/discovery/discovery.scorer.ts`
- Test: `backend/eval/discovery/tests/discovery.scorer.spec.ts`

The scorer is pure logic over an opportunity list + a pair — unit-testable with fabricated opportunities (no DB).

- [ ] **Step 1: Write the failing unit test**

Create `backend/eval/discovery/tests/discovery.scorer.spec.ts`:
```typescript
import { describe, it, expect } from 'bun:test';
import { scorePair } from '../discovery.scorer';
import type { SeededWorld, SeedPair } from '../discovery.types';

const world = {
  runId: 'eval-test',
  networkId: 'eval-test-net',
  userIdByKey: { 'bo-a': 'u-a', 'bo-b': 'u-b', 'bg-1': 'u-bg1' },
  intentIdByKey: { 'bo-a': 'i-a' },
  population: { people: [], pairs: [] },
  createdOpportunityIds: [],
} as unknown as SeededWorld;
const pair: SeedPair = { id: 'pair/builder-operator', discovererKey: 'bo-a', partnerKey: 'bo-b' };

const oppWith = (counterpartyId: string, confidence: number) => ({
  id: `o-${counterpartyId}`,
  actors: [{ userId: 'u-a', role: 'patient' }, { userId: counterpartyId, role: 'agent' }],
  interpretation: { category: 'x', reasoning: 'r', confidence },
  status: 'latent',
});

describe('scorePair', () => {
  it('passes when the partner surfaces and no distractor does', () => {
    const r = scorePair(world, pair, [oppWith('u-b', 0.9)]);
    expect(r.retrieved).toBe(true);
    expect(r.matched).toBe(true);
    expect(r.partnerScore).toBe(90);
    expect(r.falsePositiveKeys).toEqual([]);
    expect(r.passed).toBe(true);
  });

  it('fails (false positive) when a distractor surfaces', () => {
    const r = scorePair(world, pair, [oppWith('u-b', 0.9), oppWith('u-bg1', 0.7)]);
    expect(r.falsePositiveKeys).toContain('bg-1');
    expect(r.passed).toBe(false);
  });

  it('fails (miss) when the partner does not surface', () => {
    const r = scorePair(world, pair, []);
    expect(r.retrieved).toBe(false);
    expect(r.matched).toBe(false);
    expect(r.partnerScore).toBeNull();
    expect(r.passed).toBe(false);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && bun test eval/discovery/tests/discovery.scorer.spec.ts`
Expected: FAIL — `Cannot find module '../discovery.scorer'`.

- [ ] **Step 3: Write the scorer**

Create `backend/eval/discovery/discovery.scorer.ts`:
```typescript
import type { SeededWorld, SeedPair, DiscoveryCaseResult } from './discovery.types';

interface OppLike {
  id: string;
  actors: Array<{ userId: string; role: string }>;
  interpretation: { confidence: number };
  status: string;
}

/**
 * Two-level scoring for one ground-truth pair:
 *  - retrieved/matched: an opportunity pairs the discoverer with the true partner.
 *  - falsePositiveKeys: any other seeded person who surfaced as an opportunity for this discoverer.
 * Passes iff the partner surfaced and no other seeded person did.
 */
export function scorePair(world: SeededWorld, pair: SeedPair, opps: OppLike[]): DiscoveryCaseResult {
  const discovererId = world.userIdByKey[pair.discovererKey];
  const partnerId = world.userIdByKey[pair.partnerKey];
  const keyByUserId = new Map(Object.entries(world.userIdByKey).map(([k, id]) => [id, k]));

  let partnerScore: number | null = null;
  const falsePositiveKeys: string[] = [];

  for (const o of opps) {
    const counterparty = o.actors.find((a) => a.userId !== discovererId);
    if (!counterparty) continue;
    if (counterparty.userId === partnerId) {
      partnerScore = Math.round(o.interpretation.confidence * 100);
    } else {
      const k = keyByUserId.get(counterparty.userId);
      if (k) falsePositiveKeys.push(k);
    }
  }

  const matched = partnerScore !== null;
  return {
    pairId: pair.id,
    retrieved: matched,
    matched,
    partnerScore,
    falsePositiveKeys,
    passed: matched && falsePositiveKeys.length === 0,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && bun test eval/discovery/tests/discovery.scorer.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 6: Commit**
```bash
git add backend/eval/discovery/discovery.scorer.ts backend/eval/discovery/tests/discovery.scorer.spec.ts
git commit -m "feat(eval): two-level discovery scorer (partner surfaces, no false positives)"
```

---

## Task 5: Reporter + CLI + script (end-to-end run)

**Files:**
- Create: `backend/eval/discovery/discovery.reporter.ts`
- Create: `backend/eval/discovery/discovery.eval.ts`
- Create: `backend/eval/discovery/README.md`
- Modify: `backend/package.json` (add `eval:discovery` script)

- [ ] **Step 1: Write the reporter**

Create `backend/eval/discovery/discovery.reporter.ts`:
```typescript
import type { DiscoveryCaseResult } from './discovery.types';

export function formatScorecard(results: DiscoveryCaseResult[]): string {
  const passed = results.filter((r) => r.passed).length;
  const lines: string[] = [];
  lines.push('=== Discovery Eval Scorecard ===');
  lines.push(`pairs=${results.length}  passed=${passed}  pass-rate=${results.length ? Math.round((passed / results.length) * 100) : 0}%`);
  lines.push('');
  for (const r of results) {
    const fp = r.falsePositiveKeys.length ? ` falsePositives=[${r.falsePositiveKeys.join(', ')}]` : '';
    const score = r.partnerScore == null ? 'partner NOT surfaced' : `partner=${r.partnerScore}`;
    lines.push(`  ${r.passed ? 'PASS' : 'FAIL'}  ${r.pairId}  (${score})${fp}`);
  }
  return lines.join('\n');
}
```

- [ ] **Step 2: Write the CLI**

Create `backend/eval/discovery/discovery.eval.ts`:
```typescript
import '../../src/startup.env';
import { FIXTURE } from './discovery.fixture';
import { seedPopulation } from './discovery.seed';
import { cleanupWorld } from './discovery.cleanup';
import { runDiscovery, readOpportunities } from './discovery.runner';
import { scorePair } from './discovery.scorer';
import { formatScorecard } from './discovery.reporter';
import type { DiscoveryCaseResult } from './discovery.types';

function has(flag: string): boolean {
  return process.argv.includes(flag);
}

async function main(): Promise<void> {
  const trigger = has('--profile') ? 'profile' : 'intent';
  const keep = has('--keep');
  const world = await seedPopulation(FIXTURE);
  const results: DiscoveryCaseResult[] = [];
  try {
    for (const pair of FIXTURE.pairs) {
      await runDiscovery(world, pair.discovererKey, trigger);
      const opps = await readOpportunities(world, pair.discovererKey);
      results.push(scorePair(world, pair, opps));
    }
    console.log(formatScorecard(results));
  } finally {
    if (!keep) await cleanupWorld(world);
  }
  process.exit(results.every((r) => r.passed) ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(2);
});
```
> `--profile` runs the no-intent/onboarding trigger; default is per-intent. `--keep` skips cleanup for debugging (leaves `eval-<runId>-` rows — run `sweepStaleEvalNetworks` later to clear). The graph's persistence is naturally scoped to the eval network, so the run is isolated.

- [ ] **Step 3: Add the package.json script**

In `backend/package.json`, add to `"scripts"`:
```json
"eval:discovery": "bun --env-file=.env.test ./eval/discovery/discovery.eval.ts"
```
Run: `cd backend && grep eval:discovery package.json`
Expected: prints the new script line.

- [ ] **Step 4: Write the README**

Create `backend/eval/discovery/README.md`:
```markdown
# End-to-End Discovery Eval

Runs the REAL opportunity discovery graph against a seeded population in a dedicated eval
network, and asserts the true partner surfaces while distractors do not. Opt-in; NOT part of
`bun test`. Needs `DATABASE_URL` + `OPENROUTER_API_KEY` + `REDIS_URL` from `.env.test`.

## Run

```bash
# from backend/
bun run eval:discovery            # per-intent trigger, then cleans up
bun run eval:discovery -- --profile   # no-intent / onboarding trigger
bun run eval:discovery -- --keep      # skip cleanup (debugging)
```

## How it works
- `discovery.fixture.ts` — the seeded population (people + ground-truth pairs).
- `discovery.seed.ts` / `discovery.cleanup.ts` — seed rows with real embeddings; FK-safe teardown.
- `discovery.runner.ts` — wires the real `OpportunityGraphFactory` (as the opportunity queues do) and invokes both triggers, scoped to the eval network.
- `discovery.scorer.ts` — two-level: partner surfaces (retrieval+match) and no distractor does (false positives).
- This is the walking skeleton (6-person fixture). Scaling to the full ~65-person population is a follow-up.
```

- [ ] **Step 5: Run the full eval end-to-end**

Run: `cd backend && bun run eval:discovery`
Expected: prints a scorecard; both pairs PASS (partner surfaces, no false positives) and exit 0. Then run `bun run eval:discovery -- --profile` and confirm the no-intent trigger also produces a scorecard (record the result — the profile path may behave differently; note findings). Confirm no `eval-` network remains afterward (cleanup ran).

- [ ] **Step 6: Type-check**

Run: `cd backend && bunx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 7: Commit**
```bash
git add backend/eval/discovery/discovery.reporter.ts backend/eval/discovery/discovery.eval.ts backend/eval/discovery/README.md backend/package.json
git commit -m "feat(eval): discovery eval reporter + CLI (eval:discovery), end-to-end on the fixture"
```

---

## After all tasks

- The walking skeleton is complete: `bun run eval:discovery` seeds a 6-person population, runs the real graph under both triggers, scores partner-surfacing + false positives, and cleans up.
- **Follow-up plan (separate):** author the full ~65-person population (15 anonymized real collaboration pairs + 35 background personas) into `discovery.fixture.ts` (or a `discovery.population.ts`), add `--runs` for stability, and do a calibration baseline run that records findings (mirroring the matching eval's baseline discipline). Also upgrade the scorer to true **retrieval-vs-scoring attribution**: the skeleton's `scorePair` only sees *persisted* opportunities, so `retrieved` and `matched` collapse to the same signal (it cannot tell "never retrieved" from "retrieved then scored too low"). Distinguishing them needs the graph's candidate/debug output (`DiscoverResult.debugSteps` or the evaluated-candidate set), which this skeleton does not capture. That plan is written only after this harness is proven.
- No package-version bump: `backend/` is not a published package, and no `@indexnetwork/protocol`/`cli` source changed (the eval only imports protocol).
- Update the `project_matching_eval_harness` memory note to record the new end-to-end harness (finishing step).

## Notes on test realism

Tasks 2, 3, and 5 hit the real `.env.test` DB + real embeddings + real HyDE/evaluator, so they are integration smoke checks, not deterministic unit tests; their "expected" outcomes describe observations, and an LLM-driven assertion that flakes is a *finding* to record, not necessarily a bug (the partner-surfaces assertion is the gate). Tasks 1 and 4 are deterministic and follow strict RED→GREEN. Never weaken the partner-surfaces or no-false-positive gates to force a pass.
