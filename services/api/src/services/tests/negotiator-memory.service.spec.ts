/**
 * IND-406 — NegotiatorMemoryWriteService anti-poisoning policy (pure unit
 * tests, all deps injected).
 *
 * Pins:
 * - flag off → zero writes (adapter never touched),
 * - per-kind caps: at cap, lowest-confidence (oldest first) rows are evicted,
 * - dossier upsert: one dossier per (agent, subject) — reinforce (confidence
 *   bump + provenance append), don't duplicate,
 * - ask_user answer → immediate high-confidence disclosure_rule,
 * - embedding failure degrades to an embeddingless row (content preserved),
 * - decay pass delegates to the adapter with the schedule constants.
 */
process.env.DATABASE_URL = process.env.DATABASE_URL ?? 'postgresql://unused:unused@localhost:5432/unused';
process.env.OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY ?? 'test-key';

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test';

import { NegotiatorMemoryWriteService, NEGOTIATOR_MEMORY_KIND_CAPS, isNegotiatorMemoryWriteEnabled } from '../negotiator-memory.service';
import type { NegotiatorMemory } from '../../schemas/database.schema';

const origFlag = process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED;

function mkRow(partial: Partial<NegotiatorMemory>): NegotiatorMemory {
  return {
    id: 'mem-1',
    agentId: 'agent-1',
    userId: 'u-1',
    kind: 'playbook',
    subjectUserId: null,
    content: 'x',
    embedding: null,
    sourceRefs: [],
    confidence: 0.5,
    createdAt: new Date('2026-01-01'),
    updatedAt: new Date('2026-01-01'),
    ...partial,
  } as NegotiatorMemory;
}

function mkService(overrides?: {
  listRows?: NegotiatorMemory[];
  embedding?: number[] | null;
  agentId?: string | null;
}) {
  const created: unknown[] = [];
  const updated: Array<{ id: string; patch: unknown }> = [];
  const deleted: string[] = [];
  const decayCalls: unknown[] = [];

  const memories = {
    create: mock(async (input: unknown) => { created.push(input); return mkRow({}); }),
    list: mock(async () => overrides?.listRows ?? []),
    update: mock(async (id: string, _userId: string, patch: unknown) => { updated.push({ id, patch }); return mkRow({ id }); }),
    delete: mock(async (id: string) => { deleted.push(id); return true; }),
    decayAll: mock(async (opts: unknown) => { decayCalls.push(opts); return { decayed: 2, deleted: 1 }; }),
  };

  const service = new NegotiatorMemoryWriteService({
    memories: memories as never,
    embed: async () => overrides?.embedding === undefined ? [0.1, 0.2] : overrides.embedding,
    resolveNegotiatorAgentId: async () => overrides?.agentId === undefined ? 'agent-1' : overrides.agentId,
  });

  return { service, memories, created, updated, deleted, decayCalls };
}

const playbookEntry = {
  kind: 'playbook' as const,
  content: 'Lead with the specific shared-interest angle.',
  confidence: 0.6,
  aboutCounterparty: false,
  turnIndexes: [0, 2],
};

const dossierEntry = {
  kind: 'counterparty_dossier' as const,
  content: 'Bob is CET-constrained and prefers async.',
  confidence: 0.7,
  aboutCounterparty: true,
  turnIndexes: [3],
};

describe('NegotiatorMemoryWriteService', () => {
  beforeEach(() => {
    process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED = 'true';
  });

  afterEach(() => {
    if (origFlag === undefined) delete process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED;
    else process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED = origFlag;
  });

  it('flag off → zero writes, adapter never touched', async () => {
    delete process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED;
    expect(isNegotiatorMemoryWriteEnabled()).toBe(false);

    const { service, memories } = mkService();
    const result = await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [playbookEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(result).toEqual({ written: 0, skipped: 1 });
    expect(memories.create).not.toHaveBeenCalled();
    expect(memories.list).not.toHaveBeenCalled();
  });

  it('writes an entry with embedding and provenance (turnIndexes merged into the ref)', async () => {
    const { service, created } = mkService();
    const result = await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [playbookEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(result).toEqual({ written: 1, skipped: 0 });
    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({
      agentId: 'agent-1',
      userId: 'u-1',
      kind: 'playbook',
      confidence: 0.6,
      embedding: [0.1, 0.2],
      sourceRefs: [{ type: 'negotiation', id: 'neg-1', turnIndexes: [0, 2] }],
    });
  });

  it('embedding failure degrades to an embeddingless row (content preserved)', async () => {
    const { service, created } = mkService({ embedding: null });
    await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [playbookEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(created.length).toBe(1);
    expect((created[0] as { embedding?: unknown }).embedding).toBeUndefined();
    expect((created[0] as { content: string }).content).toBe(playbookEntry.content);
  });

  it('no personal negotiator agent → all entries skipped', async () => {
    const { service, memories } = mkService({ agentId: null });
    const result = await service.writeDistilledMemories({
      userId: 'u-ghost',
      entries: [playbookEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(result).toEqual({ written: 0, skipped: 1 });
    expect(memories.create).not.toHaveBeenCalled();
  });

  it('dossier without counterpartyUserId is skipped (no subject to attribute)', async () => {
    const { service, memories } = mkService();
    const result = await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [dossierEntry],
      sourceRef: { type: 'chat', id: 'sess-1' },
    });

    expect(result).toEqual({ written: 0, skipped: 1 });
    expect(memories.create).not.toHaveBeenCalled();
  });

  it('dossier upsert: existing dossier is reinforced, not duplicated', async () => {
    const existing = mkRow({
      id: 'dossier-1',
      kind: 'counterparty_dossier',
      subjectUserId: 'u-bob',
      confidence: 0.5,
      sourceRefs: [{ type: 'negotiation', id: 'neg-0' }],
    });
    const { service, memories, created, updated } = mkService({ listRows: [existing] });

    const result = await service.writeDistilledMemories({
      userId: 'u-1',
      counterpartyUserId: 'u-bob',
      entries: [dossierEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(result).toEqual({ written: 1, skipped: 0 });
    expect(memories.create).not.toHaveBeenCalled();
    expect(updated.length).toBe(1);
    expect(updated[0].id).toBe('dossier-1');
    const patch = updated[0].patch as { confidence: number; sourceRefs: unknown[]; content: string };
    // reinforce: max(existing 0.5, entry 0.7) + 0.1
    expect(patch.confidence).toBeCloseTo(0.8);
    expect(patch.content).toBe(dossierEntry.content);
    expect(patch.sourceRefs).toEqual([
      { type: 'negotiation', id: 'neg-0' },
      { type: 'negotiation', id: 'neg-1', turnIndexes: [3] },
    ]);
    expect(created.length).toBe(0);
  });

  it('fresh dossier (no existing row for subject) is created with the subject', async () => {
    const { service, created } = mkService({ listRows: [] });
    await service.writeDistilledMemories({
      userId: 'u-1',
      counterpartyUserId: 'u-bob',
      entries: [dossierEntry],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({ kind: 'counterparty_dossier', subjectUserId: 'u-bob' });
  });

  it('kind cap: at cap, the lowest-confidence oldest row is evicted to make room', async () => {
    const cap = NEGOTIATOR_MEMORY_KIND_CAPS.threshold;
    const rows = Array.from({ length: cap }, (_, i) => mkRow({
      id: `thr-${i}`,
      kind: 'threshold',
      confidence: i === 3 ? 0.1 : 0.5 + (i % 4) * 0.1,
      createdAt: new Date(2026, 0, 1 + i),
    }));
    const { service, deleted, created } = mkService({ listRows: rows });

    await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [{ ...playbookEntry, kind: 'threshold' as const }],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(deleted).toEqual(['thr-3']); // lowest confidence
    expect(created.length).toBe(1);
  });

  it('under cap → no eviction', async () => {
    const rows = [mkRow({ id: 'thr-0', kind: 'threshold' })];
    const { service, deleted, created } = mkService({ listRows: rows });

    await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [{ ...playbookEntry, kind: 'threshold' as const }],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(deleted).toEqual([]);
    expect(created.length).toBe(1);
  });

  it('one failing entry does not sink the batch', async () => {
    const { service, created, memories } = mkService();
    let call = 0;
    memories.create.mockImplementation(async (input: unknown) => {
      call++;
      if (call === 1) throw new Error('db hiccup');
      created.push(input);
      return mkRow({});
    });

    const result = await service.writeDistilledMemories({
      userId: 'u-1',
      entries: [playbookEntry, { ...playbookEntry, content: 'second' }],
      sourceRef: { type: 'negotiation', id: 'neg-1' },
    });

    expect(result).toEqual({ written: 1, skipped: 1 });
    expect(created.length).toBe(1);
  });

  it('recordDisclosureRuleFromAnswer → immediate high-confidence disclosure_rule', async () => {
    const { service, created } = mkService();
    await service.recordDisclosureRuleFromAnswer({
      userId: 'u-1',
      questionId: 'q-1',
      questionPrompt: 'Share your day rate with Bob?',
      selectedOptions: ['Yes, share it'],
      freeText: 'but only the range',
    });

    expect(created.length).toBe(1);
    expect(created[0]).toMatchObject({
      kind: 'disclosure_rule',
      confidence: 0.9,
      sourceRefs: [{ type: 'question_answer', id: 'q-1' }],
    });
    const content = (created[0] as { content: string }).content;
    expect(content).toContain('Share your day rate with Bob?');
    expect(content).toContain('Yes, share it');
    expect(content).toContain('but only the range');
  });

  it('recordDisclosureRuleFromAnswer no-ops when the flag is off', async () => {
    delete process.env.NEGOTIATOR_MEMORY_WRITE_ENABLED;
    const { service, memories } = mkService();
    await service.recordDisclosureRuleFromAnswer({
      userId: 'u-1',
      questionId: 'q-1',
      selectedOptions: ['Yes'],
    });
    expect(memories.create).not.toHaveBeenCalled();
  });

  it('recordDisclosureRuleFromAnswer no-ops on an empty answer', async () => {
    const { service, memories } = mkService();
    await service.recordDisclosureRuleFromAnswer({
      userId: 'u-1',
      questionId: 'q-1',
      selectedOptions: [],
    });
    expect(memories.create).not.toHaveBeenCalled();
  });

  it('runConfidenceDecay delegates to the adapter with the schedule constants', async () => {
    const { service, decayCalls } = mkService();
    const result = await service.runConfidenceDecay();

    expect(result).toEqual({ decayed: 2, deleted: 1 });
    expect(decayCalls.length).toBe(1);
    expect(decayCalls[0]).toMatchObject({
      factor: 0.99,
      olderThanMs: 7 * 24 * 60 * 60 * 1000,
      deleteBelow: 0.05,
    });
  });
});
