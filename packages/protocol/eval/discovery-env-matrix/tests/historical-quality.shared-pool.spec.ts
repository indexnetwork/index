import { describe, expect, it } from "bun:test";

import { HISTORICAL_QUALITY_CASES } from "../../matching/matching.historical.js";
import { fingerprintCanonicalJson } from "../../shared/index.js";
import type { HistoricalQualityCase } from "../historical-quality.corpus.js";
import { HistoricalSharedPoolApprovalReceiptSchema, admitHistoricalSharedPool, buildHistoricalSharedPoolPlan, historicalRetrievalDocumentFingerprint, historicalSharedPoolPlanFingerprint, historicalSharedPoolSeedFingerprint, stableQualityId, verifyHistoricalSharedPoolApprovalReceipt, type HistoricalSharedPoolApprovalReceipt, type HistoricalSharedPoolFixture } from "../historical-quality.shared-pool.js";

const sortedCases = [...HISTORICAL_QUALITY_CASES].sort((left, right) => left.id.localeCompare(right.id));
const entityById = new Map(sortedCases.flatMap((historicalCase) => historicalCase.input.entities.map((entity) => [entity.userId, entity] as const)));

function syntheticFixture(): HistoricalSharedPoolFixture {
  const enrichmentRows = [...entityById].map(([participantId, entity]) => {
    const historicalCase = sortedCases.find((candidate) => candidate.input.entities.some((row) => row.userId === participantId))!;
    const source = historicalCase.input.discovererId === participantId;
    const premises = source
      ? historicalCase.historicalQuality.triggerInputs.enrichment.premises
      : [entity.intents![0]!.payload];
    const userContext = source
      ? historicalCase.historicalQuality.triggerInputs.enrichment.userContext
      : `Synthetic context for ${participantId}`;
    return {
      participantId,
      premises: [...premises],
      premiseSourcePaths: premises.map((_, index) => `case:${historicalCase.id}/participant:${participantId}/premise:${index}`),
      userContext,
      contextSourcePaths: [`case:${historicalCase.id}/participant:${participantId}/context`],
    };
  });

  const retrievalDocuments = enrichmentRows.flatMap((row) => [
    ...row.premises.map((premise, index) => ({
      documentId: stableQualityId("document", `${row.participantId}:premise:${index}`),
      participantId: row.participantId,
      sourceRowId: stableQualityId("premise", `${row.participantId}:${row.premiseSourcePaths[index]!}`),
      sourceType: "premise" as const,
      strategy: "historical-quality-fixture",
      targetCorpus: "premise",
      targetFrame: "discovery",
      text: premise,
      sourcePaths: [row.premiseSourcePaths[index]!],
      contentFingerprint: fingerprintCanonicalJson(premise),
    })),
    {
      documentId: stableQualityId("document", `${row.participantId}:context`),
      participantId: row.participantId,
      sourceRowId: stableQualityId("context", row.participantId),
      sourceType: "context" as const,
      strategy: "historical-quality-fixture",
      targetCorpus: "context",
      targetFrame: "discovery",
      text: row.userContext,
      sourcePaths: [...row.contextSourcePaths],
      contentFingerprint: fingerprintCanonicalJson(row.userContext),
    },
  ]);

  return {
    corpusVersion: "historical-shared-pool-test-v1",
    network: {
      id: stableQualityId("network", "shared-pool-test-v1"),
      title: "Synthetic contract-test network",
      prompt: "A provider-free deterministic test network.",
    },
    enrichmentRows,
    retrievalDocuments,
    approval: {
      status: "pending",
      authorId: "fixture-author@example.test",
      corpusVersion: "historical-shared-pool-test-v1",
      planFingerprint: "0".repeat(64),
      seedProjectionFingerprint: "1".repeat(64),
      retrievalDocumentFingerprint: "2".repeat(64),
    },
  };
}

function cloneCases(): HistoricalQualityCase[] {
  return [...structuredClone(HISTORICAL_QUALITY_CASES)];
}

function planAndFixture() {
  const fixture = syntheticFixture();
  const plan = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture });
  return { fixture, plan };
}

const current = {
  authorId: "fixture-author@example.test",
  contentRevision: "a".repeat(40),
  corpusVersion: "historical-shared-pool-test-v1",
  planFingerprint: "b".repeat(64),
  seedProjectionFingerprint: "c".repeat(64),
  retrievalDocumentFingerprint: "d".repeat(64),
};

const receipt = (): HistoricalSharedPoolApprovalReceipt => ({
  status: "approved",
  authorId: current.authorId,
  reviewerId: "independent-reviewer@example.test",
  contentRevision: current.contentRevision,
  reviewedAt: "2026-08-07T10:30:00+00:00",
  decision: "approved",
  independenceAttested: true,
  recognizability: "medium",
  rationale: "Independently checked the exact deterministic corpus projection.",
  corpusVersion: current.corpusVersion,
  planFingerprint: current.planFingerprint,
  seedProjectionFingerprint: current.seedProjectionFingerprint,
  retrievalDocumentFingerprint: current.retrievalDocumentFingerprint,
});

describe("historical shared-pool contract", () => {
  it("derives the fixed 25-participant pool and direct 1/3/20 candidate roles", () => {
    const { plan } = planAndFixture();
    const expectedIds = Array.from({ length: 5 }, (_, caseIndex) =>
      ["a", "b", "c", "d", "e"].map((suffix) => `h${caseIndex + 1}-${suffix}`),
    ).flat();

    expect(plan.participants.map((row) => row.participantId)).toEqual(expectedIds);
    expect(new Set(plan.participants.map((row) => row.participantId)).size).toBe(25);
    expect(plan.cases).toHaveLength(5);

    const numberByCaseId = new Map(HISTORICAL_QUALITY_CASES.map((historicalCase) => [historicalCase.id, historicalCase.input.discovererId.slice(1, 2)]));
    for (const row of plan.cases) {
      const number = numberByCaseId.get(row.caseId)!;
      expect(row.sourceParticipantId).toBe(`h${number}-a`);
      expect(row.targetParticipantId).toBe(`h${number}-b`);
      expect(row.candidates).toHaveLength(24);
      expect(row.candidates.filter((candidate) => candidate.role === "target").map((candidate) => candidate.participantId)).toEqual([`h${number}-b`]);
      expect(row.candidates.filter((candidate) => candidate.role === "semantic-negative").map((candidate) => candidate.participantId)).toEqual([
        `h${number}-c`, `h${number}-d`, `h${number}-e`,
      ]);
      expect(row.candidates.filter((candidate) => candidate.role === "background")).toHaveLength(20);
    }
  });

  it("uses only the fixed namespace and stable source identities for IDs", () => {
    expect(stableQualityId("network", "shared-pool-v1")).toBe("eval-discovery-quality-network-310020cd64cd30dec68d1945");
    expect(stableQualityId("user", "h1-a")).toMatch(/^eval-discovery-quality-user-[a-f0-9]{24}$/);
    expect(stableQualityId("user", "h1-a")).toBe(stableQualityId("user", "h1-a"));
    expect(stableQualityId("user", "h1-a")).not.toBe(stableQualityId("user", "h1-b"));
  });

  it("canonicalizes cases, participants, expectations, fixture rows, documents, and source paths", () => {
    const cases = cloneCases().reverse();
    for (const historicalCase of cases) {
      const participantByOldIndex = historicalCase.input.entities.map((entity) => entity.userId);
      historicalCase.input.entities.reverse();
      historicalCase.expect.reverse();
      historicalCase.historicalQuality.claimProvenance = Object.fromEntries(
        Object.entries(historicalCase.historicalQuality.claimProvenance).map(([path, claimIds]) => {
          const match = /^\/input\/entities\/(\d+)(\/.*)?$/.exec(path);
          if (!match) return [path, claimIds];
          const participantId = participantByOldIndex[Number(match[1])]!;
          const newIndex = historicalCase.input.entities.findIndex((entity) => entity.userId === participantId);
          return [`/input/entities/${newIndex}${match[2] ?? ""}`, claimIds];
        }),
      );
    }
    const originalFixture = syntheticFixture();
    const fixture: HistoricalSharedPoolFixture = {
      ...originalFixture,
      enrichmentRows: [...originalFixture.enrichmentRows].reverse().map((row) => ({
        ...row,
        premises: [...row.premises].reverse(),
        premiseSourcePaths: [...row.premiseSourcePaths].reverse(),
        contextSourcePaths: [...row.contextSourcePaths].reverse(),
      })),
      retrievalDocuments: [...originalFixture.retrievalDocuments].reverse().map((document) => ({
        ...document,
        sourcePaths: [...document.sourcePaths].reverse(),
      })),
    };

    const canonical = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture: syntheticFixture() });
    const shuffled = buildHistoricalSharedPoolPlan({ cases, fixture });
    expect(shuffled).toEqual(canonical);
    expect(shuffled.seedProjection).toEqual(canonical.seedProjection);
    expect(historicalSharedPoolPlanFingerprint(shuffled)).toBe(historicalSharedPoolPlanFingerprint(canonical));
    expect(historicalSharedPoolSeedFingerprint(shuffled.seedProjection)).toBe(historicalSharedPoolSeedFingerprint(canonical.seedProjection));
    expect(historicalRetrievalDocumentFingerprint(shuffled.seedProjection.documents)).toBe(historicalRetrievalDocumentFingerprint(canonical.seedProjection.documents));
  });

  it("keeps the seed projection model-safe and fingerprints three independent canonical domains", () => {
    const { plan } = planAndFixture();
    const serialized = JSON.stringify(plan.seedProjection);
    for (const forbidden of ["reportNames", "citations", "cutoff", "semanticNegatives", "approval", "reviewerId", "rationale", "reasonId"]) {
      expect(serialized).not.toContain(forbidden);
    }
    const fingerprints = new Set([
      historicalSharedPoolPlanFingerprint(plan),
      historicalSharedPoolSeedFingerprint(plan.seedProjection),
      historicalRetrievalDocumentFingerprint(plan.seedProjection.documents),
    ]);
    expect(fingerprints.size).toBe(3);
    expect(plan.seedProjection.users).toHaveLength(25);
    expect(plan.seedProjection.networks).toHaveLength(1);
    expect(plan.seedProjection.memberships).toHaveLength(25);
    expect(plan.seedProjection.intents).toHaveLength(25);
    expect(plan.seedProjection.intentNetworkAssignments).toHaveLength(25);
    expect(plan.seedProjection.contexts).toHaveLength(25);
    expect(plan.seedProjection.documents).toHaveLength(plan.seedProjection.premises.length + 25);
  });

  it("rejects wrong corpus cardinality, duplicate participants, missing fixture rows, and bad negative coverage", () => {
    expect(() => buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES.slice(0, 4), fixture: syntheticFixture() })).toThrow(/exactly five cases/);
    expect(() => buildHistoricalSharedPoolPlan({ cases: [...HISTORICAL_QUALITY_CASES, HISTORICAL_QUALITY_CASES[0]!], fixture: syntheticFixture() })).toThrow(/exactly five cases/);

    const duplicate = cloneCases();
    duplicate[1]!.input.entities[0] = structuredClone(duplicate[0]!.input.entities[0]!);
    expect(() => buildHistoricalSharedPoolPlan({ cases: duplicate, fixture: syntheticFixture() })).toThrow(/duplicate participant h1-a/);

    const inconsistent = cloneCases();
    inconsistent[1]!.input.entities[0]!.userId = "h1-a";
    expect(() => buildHistoricalSharedPoolPlan({ cases: inconsistent, fixture: syntheticFixture() })).toThrow(/inconsistent duplicate participant h1-a/);

    const completeFixture = syntheticFixture();
    const missingRow: HistoricalSharedPoolFixture = { ...completeFixture, enrichmentRows: completeFixture.enrichmentRows.slice(1) };
    expect(() => buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture: missingRow })).toThrow(/missing enrichment row/);

    const invalidNegatives = cloneCases();
    delete invalidNegatives[0]!.historicalQuality.semanticNegatives["h1-c"];
    expect(() => buildHistoricalSharedPoolPlan({ cases: invalidNegatives, fixture: syntheticFixture() })).toThrow(/semantic negatives must exactly cover/);

    const validFixture = syntheticFixture();
    const invalidDocumentId: HistoricalSharedPoolFixture = {
      ...validFixture,
      retrievalDocuments: validFixture.retrievalDocuments.map((document, index) => index === 0
        ? { ...document, documentId: stableQualityId("document", "wrong-source") }
        : document),
    };
    expect(() => buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture: invalidDocumentId })).toThrow(/document ID does not match/);
  });

  it("strictly parses approved receipts and rejects every malformed receipt mutation", () => {
    expect(HistoricalSharedPoolApprovalReceiptSchema.parse(receipt())).toEqual(receipt());
    const mutations: unknown[] = [
      { ...receipt(), unknown: true },
      (({ rationale: _omitted, ...rest }) => rest)(receipt()),
      { ...receipt(), independenceAttested: false },
      { ...receipt(), reviewedAt: "not-a-date" },
      { ...receipt(), contentRevision: "abc" },
      { ...receipt(), decision: "pending" },
      { ...receipt(), recognizability: "high" },
      { ...receipt(), rationale: "   " },
    ];
    for (const mutation of mutations) expect(() => HistoricalSharedPoolApprovalReceiptSchema.parse(mutation)).toThrow();
  });

  it("verifies author independence and exact revision/corpus/fingerprint bindings", () => {
    expect(() => verifyHistoricalSharedPoolApprovalReceipt(receipt(), current)).not.toThrow();
    expect(() => verifyHistoricalSharedPoolApprovalReceipt({ ...receipt(), authorId: "wrong@example.test" }, current)).toThrow(/author/);
    expect(() => verifyHistoricalSharedPoolApprovalReceipt({ ...receipt(), reviewerId: current.authorId }, current)).toThrow(/independent/);
    const staleValues = {
      contentRevision: "f".repeat(40),
      corpusVersion: "stale-corpus-v1",
      planFingerprint: "e".repeat(64),
      seedProjectionFingerprint: "e".repeat(64),
      retrievalDocumentFingerprint: "e".repeat(64),
    } as const;
    for (const field of Object.keys(staleValues) as Array<keyof typeof staleValues>) {
      const stale = { ...receipt(), [field]: staleValues[field] };
      expect(() => verifyHistoricalSharedPoolApprovalReceipt(stale, current)).toThrow();
    }
  });

  it("refuses pending admission and admits only an exact approved receipt", () => {
    const fixture = syntheticFixture();
    expect(() => admitHistoricalSharedPool({ cases: HISTORICAL_QUALITY_CASES, fixture, current: { authorId: fixture.approval.authorId, contentRevision: "a".repeat(40) } })).toThrow(/pending approval/);

    const plan = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture });
    const approvedFixture: HistoricalSharedPoolFixture = {
      ...fixture,
      approval: {
        ...receipt(),
        corpusVersion: fixture.corpusVersion,
        planFingerprint: historicalSharedPoolPlanFingerprint(plan),
        seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(plan.seedProjection),
        retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(plan.seedProjection.documents),
      },
    };
    expect(admitHistoricalSharedPool({ cases: HISTORICAL_QUALITY_CASES, fixture: approvedFixture, current: { authorId: receipt().authorId, contentRevision: receipt().contentRevision } })).toEqual(plan);
  });
});
