/**
 * Integration tests for NegotiatorMemoryDatabaseAdapter (IND-405).
 *
 * Requires a live database connection (.env.test). Covers: CRUD, agent/owner
 * scoping (agentId must be the caller's own active personal negotiator),
 * top-k embedding similarity, confidence update, and FK cascades (agent
 * deletion and subject-user deletion both remove memories).
 */

import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { describe, it, expect, beforeAll, afterAll } from 'bun:test';
import { randomUUID } from 'crypto';
import { NegotiatorMemoryDatabaseAdapter, NegotiatorAgentScopeError } from '../negotiator-memory.database.adapter';
import db from '../../lib/drizzle/drizzle';
import * as schema from '../../schemas/database.schema';
import { eq, inArray } from 'drizzle-orm/sql';

const DIMS = 2000;

/** Unit vector with a 1 at `hot` — cosine similarity 1 against itself, 0 against a disjoint basis vector. */
function basisVector(hot: number): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[hot] = 1;
  return v;
}

/** Mostly e0 with a small e1 component — similar to e0 but not identical. */
function nearVector(): number[] {
  const v = new Array<number>(DIMS).fill(0);
  v[0] = 0.9;
  v[1] = 0.1;
  return v;
}

describe('NegotiatorMemoryDatabaseAdapter', () => {
  const adapter = new NegotiatorMemoryDatabaseAdapter();
  const run = randomUUID().slice(0, 8);

  let ownerId: string;
  let strangerId: string;
  let subjectId: string;
  let agentId: string;
  let strangerAgentId: string;
  let externalAgentId: string;
  const userIds: string[] = [];

  async function createUser(label: string): Promise<string> {
    const [user] = await db.insert(schema.users).values({
      email: `negomem-${label}-${run}@test.local`,
      name: `NegoMem ${label}`,
    }).returning({ id: schema.users.id });
    userIds.push(user.id);
    return user.id;
  }

  async function createAgent(owner: string, type: 'personal' | 'external'): Promise<string> {
    const [agent] = await db.insert(schema.agents).values({
      ownerId: owner,
      name: `NegoMem ${type} agent ${run}`,
      type,
    }).returning({ id: schema.agents.id });
    return agent.id;
  }

  beforeAll(async () => {
    ownerId = await createUser('owner');
    strangerId = await createUser('stranger');
    subjectId = await createUser('subject');
    agentId = await createAgent(ownerId, 'personal');
    strangerAgentId = await createAgent(strangerId, 'personal');
    externalAgentId = await createAgent(ownerId, 'external');
  });

  afterAll(async () => {
    // Users cascade to agents, which cascade to memories.
    await db.delete(schema.users).where(inArray(schema.users.id, userIds));
  });

  it('creates, reads, updates and deletes a memory (CRUD)', async () => {
    const created = await adapter.create({
      agentId,
      userId: ownerId,
      kind: 'playbook',
      content: 'Open with scope questions before discussing price.',
      sourceRefs: [{ type: 'negotiation', id: randomUUID() }],
    });
    expect(created.id).toBeTruthy();
    expect(created.kind).toBe('playbook');
    expect(created.confidence).toBeCloseTo(0.5); // DB default
    expect(created.sourceRefs).toHaveLength(1);

    const fetched = await adapter.getById(created.id, ownerId);
    expect(fetched?.content).toContain('scope questions');

    const updated = await adapter.update(created.id, ownerId, {
      content: 'Open with scope questions; never lead with price.',
    });
    expect(updated?.content).toContain('never lead with price');
    expect(updated!.updatedAt.getTime()).toBeGreaterThanOrEqual(created.updatedAt.getTime());

    expect(await adapter.delete(created.id, ownerId)).toBe(true);
    expect(await adapter.getById(created.id, ownerId)).toBeNull();
  });

  it('updates confidence', async () => {
    const created = await adapter.create({
      agentId,
      userId: ownerId,
      kind: 'threshold',
      content: 'Client will not commit more than 5 hours/week.',
      confidence: 0.3,
    });
    expect(created.confidence).toBeCloseTo(0.3);

    const updated = await adapter.update(created.id, ownerId, { confidence: 0.9 });
    expect(updated?.confidence).toBeCloseTo(0.9);
    // Content untouched by a confidence-only patch.
    expect(updated?.content).toBe(created.content);

    await adapter.delete(created.id, ownerId);
  });

  it('rejects create when the agent is not owned by the user', async () => {
    expect(
      adapter.create({
        agentId: strangerAgentId,
        userId: ownerId,
        kind: 'playbook',
        content: 'should never be written',
      }),
    ).rejects.toThrow(NegotiatorAgentScopeError);
  });

  it('rejects create against a non-personal agent row', async () => {
    expect(
      adapter.create({
        agentId: externalAgentId,
        userId: ownerId,
        kind: 'playbook',
        content: 'should never be written',
      }),
    ).rejects.toThrow(NegotiatorAgentScopeError);
  });

  it('scopes reads to the owner — no cross-user leaks, no existence oracle', async () => {
    const created = await adapter.create({
      agentId,
      userId: ownerId,
      kind: 'disclosure_rule',
      content: 'Never share compensation expectations unprompted.',
    });

    // Stranger sees null / empty / no-op — identical to "does not exist".
    expect(await adapter.getById(created.id, strangerId)).toBeNull();
    expect(await adapter.list(agentId, strangerId)).toHaveLength(0);
    expect(await adapter.update(created.id, strangerId, { confidence: 1 })).toBeNull();
    expect(await adapter.delete(created.id, strangerId)).toBe(false);

    // Row is intact for the owner.
    const intact = await adapter.getById(created.id, ownerId);
    expect(intact?.confidence).toBeCloseTo(0.5);

    await adapter.delete(created.id, ownerId);
  });

  it('lists with kind and subject filters, newest first', async () => {
    const a = await adapter.create({
      agentId, userId: ownerId, kind: 'counterparty_dossier',
      subjectUserId: subjectId, content: 'Responds fastest in the morning.',
    });
    const b = await adapter.create({
      agentId, userId: ownerId, kind: 'playbook',
      content: 'Summarize agreements at the end of each turn.',
    });

    const dossiers = await adapter.list(agentId, ownerId, { kind: 'counterparty_dossier' });
    expect(dossiers.map((m) => m.id)).toContain(a.id);
    expect(dossiers.map((m) => m.id)).not.toContain(b.id);

    const aboutSubject = await adapter.list(agentId, ownerId, { subjectUserId: subjectId });
    expect(aboutSubject.map((m) => m.id)).toEqual([a.id]);

    const all = await adapter.list(agentId, ownerId);
    expect(all.length).toBeGreaterThanOrEqual(2);
    // Newest first.
    const ids = all.map((m) => m.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));

    await adapter.delete(a.id, ownerId);
    await adapter.delete(b.id, ownerId);
  }, 15000);

  it('returns top-k by cosine similarity, scoped to the agent', async () => {
    const exact = await adapter.create({
      agentId, userId: ownerId, kind: 'playbook',
      content: 'exact match', embedding: basisVector(0),
    });
    const near = await adapter.create({
      agentId, userId: ownerId, kind: 'playbook',
      content: 'near match', embedding: nearVector(),
    });
    const far = await adapter.create({
      agentId, userId: ownerId, kind: 'threshold',
      content: 'unrelated', embedding: basisVector(1999),
    });
    const noEmbedding = await adapter.create({
      agentId, userId: ownerId, kind: 'playbook',
      content: 'no embedding yet',
    });
    // Same vector on the stranger's agent — must never surface.
    const strangerRow = await adapter.create({
      agentId: strangerAgentId, userId: strangerId, kind: 'playbook',
      content: 'stranger exact match', embedding: basisVector(0),
    });

    const results = await adapter.searchSimilar({
      agentId, userId: ownerId, embedding: basisVector(0), limit: 2,
    });
    expect(results.map((r) => r.id)).toEqual([exact.id, near.id]);
    expect(results[0].similarity).toBeCloseTo(1, 5);
    expect(results[1].similarity).toBeGreaterThan(0.9);
    expect(results.map((r) => r.id)).not.toContain(strangerRow.id);
    expect(results.map((r) => r.id)).not.toContain(noEmbedding.id);

    // minScore floor excludes the orthogonal row even with a generous limit.
    const floored = await adapter.searchSimilar({
      agentId, userId: ownerId, embedding: basisVector(0), limit: 10, minScore: 0.5,
    });
    expect(floored.map((r) => r.id)).not.toContain(far.id);

    // Kind filter.
    const thresholdsOnly = await adapter.searchSimilar({
      agentId, userId: ownerId, embedding: basisVector(0), limit: 10, kind: 'threshold',
    });
    expect(thresholdsOnly.map((r) => r.id)).toEqual([far.id]);

    for (const row of [exact, near, far, noEmbedding]) await adapter.delete(row.id, ownerId);
    await adapter.delete(strangerRow.id, strangerId);
  }, 30000); // 5 creates + 3 searches + 5 deletes over a remote Neon connection

  it('cascades: deleting the negotiator agent row removes its memories', async () => {
    const tempOwner = await createUser('cascade');
    const tempAgent = await createAgent(tempOwner, 'personal');
    const memory = await adapter.create({
      agentId: tempAgent, userId: tempOwner, kind: 'playbook', content: 'dies with the agent',
    });

    await db.delete(schema.agents).where(eq(schema.agents.id, tempAgent));

    const [orphan] = await db.select().from(schema.negotiatorMemories)
      .where(eq(schema.negotiatorMemories.id, memory.id));
    expect(orphan).toBeUndefined();
  });

  it('cascades: deleting the subject user removes dossiers about them', async () => {
    const tempSubject = await createUser('subject-cascade');
    const dossier = await adapter.create({
      agentId, userId: ownerId, kind: 'counterparty_dossier',
      subjectUserId: tempSubject, content: 'dies with the subject',
    });

    await db.delete(schema.users).where(eq(schema.users.id, tempSubject));

    const [orphan] = await db.select().from(schema.negotiatorMemories)
      .where(eq(schema.negotiatorMemories.id, dossier.id));
    expect(orphan).toBeUndefined();
  });
});
