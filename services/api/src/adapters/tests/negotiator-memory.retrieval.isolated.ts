/**
 * Integration tests for NegotiatorMemoryRetrievalAdapter (IND-407, P5.3 read
 * path). Requires a live database connection (.env.test).
 *
 * Covers: the NEGOTIATOR_MEMORY_INJECT flag gate, disclosure rules always
 * included regardless of similarity, dossier lookup by counterparty subject,
 * the similarity leg for playbooks/thresholds (deterministic injected embed
 * fn — no live embedding provider), cross-user isolation, failure → [], and
 * the chat surface shape.
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import { NegotiatorMemoryRetrievalAdapter } from '../negotiator-memory.retrieval.adapter';
import { NegotiatorMemoryDatabaseAdapter } from '../negotiator-memory.database.adapter';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { inArray } from 'drizzle-orm/sql';

const DIMS = 2000;

function basisVector(hot: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[hot] = 1;
  return v;
}

describe('NegotiatorMemoryRetrievalAdapter', () => {
  const memoryAdapter = new NegotiatorMemoryDatabaseAdapter();
  // Deterministic embed: every query embeds to e0, so rows stored at e0 are
  // similarity 1 and rows at e1 are similarity 0 (below any floor).
  const retrieval = new NegotiatorMemoryRetrievalAdapter(async () => basisVector(0));
  const run = randomUUID().slice(0, 8);

  let ownerId: string;
  let counterpartyId: string;
  let otherSubjectId: string;
  let strangerId: string;
  let agentId: string;
  const userIds: string[] = [];
  const origFlag = process.env.NEGOTIATOR_MEMORY_INJECT;

  beforeAll(async () => {
    process.env.NEGOTIATOR_MEMORY_INJECT = 'true';
    const users = await db.insert(schema.users).values(
      ['owner', 'counterparty', 'othersubject', 'stranger'].map((label) => ({
        email: `negoret-${label}-${run}@test.local`,
        name: `NegoRet ${label}`,
      })),
    ).returning({ id: schema.users.id });
    [ownerId, counterpartyId, otherSubjectId, strangerId] = users.map((u) => u.id);
    userIds.push(...users.map((u) => u.id));

    const [agent] = await db.insert(schema.agents).values({
      ownerId,
      name: `NegoRet personal agent ${run}`,
      type: 'personal',
    }).returning({ id: schema.agents.id });
    agentId = agent.id;

    await Promise.all([
      // Disclosure rule with a deliberately IRRELEVANT embedding (e1) — must
      // still always be retrieved (hard constraints don't ride similarity).
      memoryAdapter.create({
        agentId, userId: ownerId, kind: 'disclosure_rule',
        content: `${run} never disclose the budget`,
        embedding: basisVector(1),
      }),
      // Dossier about THIS counterparty and about someone else.
      memoryAdapter.create({
        agentId, userId: ownerId, kind: 'counterparty_dossier',
        content: `${run} counterparty prefers async`,
        subjectUserId: counterpartyId,
      }),
      memoryAdapter.create({
        agentId, userId: ownerId, kind: 'counterparty_dossier',
        content: `${run} other subject note`,
        subjectUserId: otherSubjectId,
      }),
      // Relevant playbook (e0 — similarity 1) and irrelevant threshold (e1 — similarity 0).
      memoryAdapter.create({
        agentId, userId: ownerId, kind: 'playbook',
        content: `${run} lead with the client's track record`,
        embedding: basisVector(0),
      }),
      memoryAdapter.create({
        agentId, userId: ownerId, kind: 'threshold',
        content: `${run} irrelevant threshold`,
        embedding: basisVector(1),
      }),
    ]);
  }, 30_000);

  afterAll(async () => {
    if (origFlag === undefined) delete process.env.NEGOTIATOR_MEMORY_INJECT;
    else process.env.NEGOTIATOR_MEMORY_INJECT = origFlag;
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  }, 30_000);

  const query = () => ({
    userId: ownerId,
    counterpartyUserId: counterpartyId,
    queryText: 'seed reasoning about the match',
    scope: 'turn' as const,
  });

  it('returns [] when NEGOTIATOR_MEMORY_INJECT is off', async () => {
    process.env.NEGOTIATOR_MEMORY_INJECT = 'false';
    try {
      expect(await retrieval.retrieveForNegotiation(query())).toEqual([]);
      expect(await retrieval.retrieveForChat(ownerId)).toEqual([]);
    } finally {
      process.env.NEGOTIATOR_MEMORY_INJECT = 'true';
    }
  });

  it('always includes disclosure rules, even with an irrelevant embedding', async () => {
    const entries = await retrieval.retrieveForNegotiation(query());
    const rules = entries.filter((e) => e.kind === 'disclosure_rule');
    expect(rules.map((r) => r.content)).toContain(`${run} never disclose the budget`);
  });

  it('includes dossier notes for the counterparty only — not other subjects', async () => {
    const entries = await retrieval.retrieveForNegotiation(query());
    const dossiers = entries.filter((e) => e.kind === 'counterparty_dossier');
    expect(dossiers.map((d) => d.content)).toContain(`${run} counterparty prefers async`);
    expect(dossiers.map((d) => d.content)).not.toContain(`${run} other subject note`);
  });

  it('similarity leg surfaces relevant playbooks and drops below-floor rows', async () => {
    const entries = await retrieval.retrieveForNegotiation(query());
    const contents = entries.map((e) => e.content);
    expect(contents).toContain(`${run} lead with the client's track record`);
    // e1 row: similarity 0 < floor — excluded from the advisory leg.
    expect(contents).not.toContain(`${run} irrelevant threshold`);
  });

  it('a failing embed costs only the advisory leg — hard constraints survive', async () => {
    const brokenEmbed = new NegotiatorMemoryRetrievalAdapter(async () => {
      throw new Error('embedding provider down');
    });
    const entries = await brokenEmbed.retrieveForNegotiation(query());
    expect(entries.filter((e) => e.kind === 'disclosure_rule').length).toBeGreaterThan(0);
    expect(entries.filter((e) => e.kind === 'playbook').length).toBe(0);
  });

  it('cross-user isolation: a stranger retrieves nothing of the owner', async () => {
    const entries = await retrieval.retrieveForNegotiation({
      ...query(),
      userId: strangerId,
      counterpartyUserId: ownerId,
    });
    // ensureNegotiatorAgent provisions the stranger their own (empty) agent —
    // the owner's rows are unreachable by construction.
    expect(entries.filter((e) => e.content.includes(run))).toEqual([]);
  });

  it('retrieveForChat returns recency-ordered rules/playbooks/thresholds without dossiers', async () => {
    const entries = await retrieval.retrieveForChat(ownerId);
    const kinds = new Set(entries.map((e) => e.kind));
    expect(kinds.has('counterparty_dossier')).toBe(false);
    const contents = entries.map((e) => e.content);
    expect(contents).toContain(`${run} never disclose the budget`);
    expect(contents).toContain(`${run} lead with the client's track record`);
    expect(contents).toContain(`${run} irrelevant threshold`); // no similarity leg in chat
  });

  it('entries never carry ids, embeddings, or provenance', async () => {
    const entries = await retrieval.retrieveForNegotiation(query());
    expect(entries.length).toBeGreaterThan(0);
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual(['confidence', 'content', 'kind']);
    }
  });
});
