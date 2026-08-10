import { describe, expect, it } from "bun:test";
import { fileURLToPath } from "node:url";

import { HISTORICAL_QUALITY_CASES } from "../../matching/matching.historical.js";
import { fingerprintCanonicalJson } from "../../shared/index.js";
import type { HistoricalQualityCase } from "../historical-quality.corpus.js";
import { HISTORICAL_SHARED_NETWORK, HISTORICAL_SHARED_POOL_APPROVAL_RECORD, HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS, HISTORICAL_SHARED_POOL_FIXTURE, HISTORICAL_SHARED_POOL_PLAN, HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS, HISTORICAL_SHARED_POOL_SEED_PROJECTION } from "../historical-quality.shared-pool.fixture.js";
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
    ...row.premises.map((premise, index) => {
      const sourceRowId = stableQualityId("premise", `${row.participantId}:${row.premiseSourcePaths[index]!}`);
      return {
        documentId: stableQualityId("document", `premise:${sourceRowId}`),
        participantId: row.participantId,
        sourceRowId,
        sourceType: "premise" as const,
        strategy: "historical-quality-fixture",
        targetCorpus: "premise",
        targetFrame: "discovery",
        text: premise,
        sourcePaths: [row.premiseSourcePaths[index]!],
        contentFingerprint: fingerprintCanonicalJson(premise),
      };
    }),
    {
      documentId: stableQualityId("document", `context:${stableQualityId("context", row.participantId)}`),
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

const APPROVAL_RECEIPT_PATH = "docs/research/2026-08-07-ind-638a-shared-pool-approval.json";
const APPROVAL_RECEIPT_COMMIT = "dbbae0c7887cd981e21162aa42a6da9b587076d3";
const REPOSITORY_ROOT = fileURLToPath(new URL("../../../../../", import.meta.url));

interface ApprovalHandoffProvenance {
  receiptParent: string;
  receiptChangedPaths: readonly string[];
  receiptObjectExists: boolean;
  contentObjectExists: boolean;
  contentAuthor: string;
  receiptCommitAuthor: string;
}

function verifyApprovalHandoff(
  input: unknown,
  provenance: ApprovalHandoffProvenance,
  currentValues: typeof current,
): HistoricalSharedPoolApprovalReceipt {
  const parsed = HistoricalSharedPoolApprovalReceiptSchema.parse(input);
  if (!provenance.receiptObjectExists || !provenance.contentObjectExists) throw new Error("approval Git object is missing");
  if (provenance.receiptParent !== parsed.contentRevision) throw new Error("receipt parent does not bind content revision");
  if (provenance.receiptChangedPaths.length !== 1 || provenance.receiptChangedPaths[0] !== APPROVAL_RECEIPT_PATH) {
    throw new Error("receipt commit must change only the canonical receipt");
  }
  if (provenance.contentAuthor !== parsed.authorId) throw new Error("receipt author does not match content commit author");
  if (provenance.receiptCommitAuthor === provenance.contentAuthor) throw new Error("receipt commit author must be independent");
  if (provenance.receiptCommitAuthor !== parsed.reviewerId) throw new Error("receipt signer does not match reviewer");
  verifyHistoricalSharedPoolApprovalReceipt(parsed, currentValues);
  return parsed;
}

function git(args: readonly string[]): string {
  const result = Bun.spawnSync(["git", ...args], { cwd: REPOSITORY_ROOT });
  if (result.exitCode !== 0) throw new Error(new TextDecoder().decode(result.stderr));
  return new TextDecoder().decode(result.stdout).trim();
}

function gitObjectExists(revision: string): boolean {
  return Bun.spawnSync(["git", "cat-file", "-e", `${revision}^{commit}`], { cwd: REPOSITORY_ROOT }).exitCode === 0;
}

function expectDeeplyFrozen(value: unknown, visited = new Set<unknown>()): void {
  if (value === null || typeof value !== "object" || visited.has(value)) return;
  visited.add(value);
  expect(Object.isFrozen(value)).toBeTrue();
  for (const nested of Object.values(value)) expectDeeplyFrozen(nested, visited);
}

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

  it("keeps a retrieval document ID stable when an earlier source row is removed", () => {
    const fixture = syntheticFixture();
    const enrichmentRow = fixture.enrichmentRows.find((row) => row.premises.length > 1)!;
    const removedSourceRowId = stableQualityId("premise", `${enrichmentRow.participantId}:${enrichmentRow.premiseSourcePaths[0]!}`);
    const retainedSourceRowId = stableQualityId("premise", `${enrichmentRow.participantId}:${enrichmentRow.premiseSourcePaths[1]!}`);
    const originalPlan = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture });
    const originalDocument = originalPlan.seedProjection.documents.find((document) => document.sourceRowId === retainedSourceRowId)!;
    const reducedFixture: HistoricalSharedPoolFixture = {
      ...fixture,
      enrichmentRows: fixture.enrichmentRows.map((row) => row.participantId === enrichmentRow.participantId
        ? { ...row, premises: row.premises.slice(1), premiseSourcePaths: row.premiseSourcePaths.slice(1) }
        : row),
      retrievalDocuments: fixture.retrievalDocuments.filter((document) => document.sourceRowId !== removedSourceRowId),
    };

    const reducedPlan = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture: reducedFixture });
    expect(reducedPlan.seedProjection.documents.find((document) => document.sourceRowId === retainedSourceRowId)?.documentId)
      .toBe(originalDocument.documentId);
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
    expect(() => admitHistoricalSharedPool({ cases: HISTORICAL_QUALITY_CASES, fixture, current: { authorId: fixture.approval.authorId, contentRevision: "a".repeat(40) } })).toThrow(/approval is pending/);

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

describe("approved historical shared-pool fixture", () => {
  const sourceParticipantIds = new Set(["h1-a", "h2-a", "h3-a", "h4-a", "h5-a"]);
  const caseByParticipantId = new Map(HISTORICAL_QUALITY_CASES.flatMap((historicalCase) =>
    historicalCase.input.entities.map((entity) => [entity.userId, historicalCase] as const)));
  const rowByParticipantId = new Map(HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS.map((row) => [row.participantId, row] as const));
  const fixturePlan = buildHistoricalSharedPoolPlan({ cases: HISTORICAL_QUALITY_CASES, fixture: HISTORICAL_SHARED_POOL_FIXTURE });
  const projection = HISTORICAL_SHARED_POOL_SEED_PROJECTION;
  const isSorted = (ids: readonly string[]): boolean => ids.every((id, index) => index === 0 || ids[index - 1]! < id);

  it("uses the exact neutral shared network literal", () => {
    expect(HISTORICAL_SHARED_NETWORK).toEqual({
      id: stableQualityId("network", "shared-pool-v1"),
      title: "Interdisciplinary collaboration community",
      prompt: "A private community where people describe what they are working on, what they can contribute, and the kinds of collaboration they are open to.",
    });
  });

  it("preserves all five source enrichment rows byte-for-byte", () => {
    for (const participantId of sourceParticipantIds) {
      const historicalCase = caseByParticipantId.get(participantId)!;
      expect(historicalCase.input.discovererId).toBe(participantId);
      const expected = historicalCase.historicalQuality.triggerInputs.enrichment;
      const actual = rowByParticipantId.get(participantId)!;
      expect(actual.premises).toEqual(expected.premises);
      expect(actual.userContext).toBe(expected.userContext);
    }
  });

  it("mechanically derives every other premise, source path, and context from approved fields", () => {
    for (const [participantId, entity] of entityById) {
      if (sourceParticipantIds.has(participantId)) continue;
      const historicalCase = caseByParticipantId.get(participantId)!;
      const intentPayload = entity.intents![0]!.payload;
      const row = rowByParticipantId.get(participantId)!;
      expect(row.premises).toEqual([intentPayload]);
      expect(row.premiseSourcePaths).toEqual([
        `case:${historicalCase.id}/participant:${participantId}/intent:0/payload`,
      ]);
      expect(row.contextSourcePaths).toEqual([
        `case:${historicalCase.id}/participant:${participantId}/profile/bio`,
        `case:${historicalCase.id}/participant:${participantId}/profile/location`,
        `case:${historicalCase.id}/participant:${participantId}/profile/interests`,
        `case:${historicalCase.id}/participant:${participantId}/profile/skills`,
        `case:${historicalCase.id}/participant:${participantId}/intent:0/payload`,
      ]);
      expect(row.userContext).toBe([
        `Bio: ${entity.profile.bio ?? ""}`,
        `Location: ${entity.profile.location ?? ""}`,
        `Interests: ${(entity.profile.interests ?? []).join(", ")}`,
        `Skills: ${(entity.profile.skills ?? []).join(", ")}`,
        `Intent: ${intentPayload}`,
      ].join("\n"));
    }
  });

  it("gives all 25 participants complete enrichment and exact retrieval-document coverage", () => {
    expect(HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS).toHaveLength(25);
    expect(rowByParticipantId.size).toBe(25);
    const totalPremises = HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS.reduce((total, row) => total + row.premises.length, 0);
    expect(HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS).toHaveLength(totalPremises + 25);

    for (const [participantId, entity] of entityById) {
      expect(entity.intents).toHaveLength(1);
      const row = rowByParticipantId.get(participantId)!;
      expect(row.premises.length).toBeGreaterThan(0);
      expect(row.userContext.length).toBeGreaterThan(0);
      const documents = HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS.filter((document) => document.participantId === participantId);
      expect(documents.filter((document) => document.sourceType === "premise")).toHaveLength(row.premises.length);
      expect(documents.filter((document) => document.sourceType === "context")).toHaveLength(1);
    }
  });

  it("builds the exact ordered, unique, owned database-shaped projection", () => {
    expect(projection.users).toHaveLength(25);
    expect(projection.networks).toEqual([HISTORICAL_SHARED_NETWORK]);
    expect(projection.memberships).toHaveLength(25);
    expect(projection.intents).toHaveLength(25);
    expect(projection.intentNetworkAssignments).toHaveLength(25);
    expect(projection.premises).toHaveLength(HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS.reduce((total, row) => total + row.premises.length, 0));
    expect(projection.contexts).toHaveLength(25);
    expect(projection.documents).toHaveLength(projection.premises.length + projection.contexts.length);

    for (const rows of [projection.users, projection.intents, projection.premises, projection.contexts]) {
      const ids = rows.map((row) => row.id);
      expect(isSorted(ids)).toBeTrue();
      expect(new Set(ids).size).toBe(ids.length);
    }
    const membershipIds = projection.memberships.map((row) => `${row.networkId}\0${row.userId}`);
    const assignmentIds = projection.intentNetworkAssignments.map((row) => `${row.networkId}\0${row.intentId}`);
    expect(isSorted(membershipIds)).toBeTrue();
    expect(new Set(membershipIds).size).toBe(25);
    expect(isSorted(assignmentIds)).toBeTrue();
    expect(new Set(assignmentIds).size).toBe(25);
    expect(isSorted(projection.documents.map((row) => row.documentId))).toBeTrue();
    expect(new Set(projection.documents.map((row) => row.documentId)).size).toBe(projection.documents.length);

    const userIds = new Set(projection.users.map((row) => row.id));
    const intentById = new Map(projection.intents.map((row) => [row.id, row] as const));
    const sourceById = new Map<string, {
      participantId: string;
      sourceType: "premise" | "context";
      text: string;
      sourcePaths: readonly string[];
    }>([
      ...projection.premises.map((row) => [row.id, {
        participantId: row.participantId,
        sourceType: "premise" as const,
        text: row.text,
        sourcePaths: [row.sourcePath],
      }] as const),
      ...projection.contexts.map((row) => [row.id, {
        participantId: row.participantId,
        sourceType: "context" as const,
        text: row.text,
        sourcePaths: row.sourcePaths,
      }] as const),
    ]);
    for (const membership of projection.memberships) {
      expect(membership.networkId).toBe(HISTORICAL_SHARED_NETWORK.id);
      expect(userIds.has(membership.userId)).toBeTrue();
    }
    for (const intent of projection.intents) {
      expect(userIds.has(intent.userId)).toBeTrue();
      const participantId = projection.contexts.find((context) => context.userId === intent.userId)!.participantId;
      expect(intent.id).toBe(stableQualityId("intent", participantId));
      expect(intent.userId).toBe(stableQualityId("user", participantId));
    }
    for (const assignment of projection.intentNetworkAssignments) {
      expect(assignment.networkId).toBe(HISTORICAL_SHARED_NETWORK.id);
      expect(intentById.has(assignment.intentId)).toBeTrue();
    }
    for (const premise of projection.premises) {
      expect(userIds.has(premise.userId)).toBeTrue();
      expect(intentById.get(premise.intentId)?.userId).toBe(premise.userId);
    }
    for (const context of projection.contexts) {
      expect(context.userId).toBe(stableQualityId("user", context.participantId));
    }
    for (const document of projection.documents) {
      const source = sourceById.get(document.sourceRowId)!;
      expect(document.participantId).toBe(source.participantId);
      expect(document.sourceType).toBe(source.sourceType);
      expect(document.text).toBe(source.text);
      expect(document.sourcePaths).toEqual(source.sourcePaths);
      expect(document.strategy).toBe("historical-quality-fixture");
      expect(document.targetCorpus).toBe(document.sourceType);
      expect(document.targetFrame).toBe("discovery");
      expect(document.contentFingerprint).toBe(fingerprintCanonicalJson(document.text));
    }
  });

  it("transcribes the immutable approval receipt and strictly admits the exact content revision", async () => {
    const canonicalReceipt = await Bun.file(new URL("../../../../../docs/research/2026-08-07-ind-638a-shared-pool-approval.json", import.meta.url)).json();
    expect(HISTORICAL_SHARED_POOL_APPROVAL_RECORD).toEqual(canonicalReceipt);
    expect(HISTORICAL_SHARED_POOL_APPROVAL_RECORD).toEqual({
      status: "approved",
      authorId: "yanki@index.network",
      reviewerId: "ind638.pool-auditor@index.network",
      contentRevision: "0dfb578845697aa8f2773695a4a02ab2a5d3be2d",
      reviewedAt: "2026-08-09T19:02:56Z",
      decision: "approved",
      independenceAttested: true,
      recognizability: "medium",
      rationale: "Independently reviewed the exact content revision's neutral shared prompt, five byte-exact source enrichments, twenty mechanical model-safe projections, all fifty-five retrieval documents and source identities, twenty-five participant mappings, direct 1/3/20 roles, anonymization, leakage boundaries, and recomputed corpus and fingerprints. Residual pooled recognizability is medium because domain-specific attribute combinations can still suggest well-known historical pairs despite anonymized identifiers and exclusion of names, dates, institutions, products, outcomes, and audit data from the shared prompt and pooled model-safe projection.",
      corpusVersion: HISTORICAL_SHARED_POOL_FIXTURE.corpusVersion,
      planFingerprint: "288336f6511a366d8d49303bc3e76eb475a981966e1ffb0eb2a8539d53fc4ce6",
      seedProjectionFingerprint: "8d27a7634c7def4857f5acd5b399ee82389d8c9baab23fe0b8b4df187a337c38",
      retrievalDocumentFingerprint: "87142f9c46d5fa51f6327c169f6c25d0d90fe35def5ed8778cd27e3da98d7b35",
    });
    expect(HISTORICAL_SHARED_POOL_PLAN).toEqual(fixturePlan);
    expect(admitHistoricalSharedPool({
      cases: HISTORICAL_QUALITY_CASES,
      fixture: HISTORICAL_SHARED_POOL_FIXTURE,
      current: {
        authorId: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.authorId,
        contentRevision: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision,
      },
    })).toEqual(HISTORICAL_SHARED_POOL_PLAN);
  });

  it("recomputes the three pairwise-distinct approval fingerprints", () => {
    const recomputed = {
      planFingerprint: historicalSharedPoolPlanFingerprint(HISTORICAL_SHARED_POOL_PLAN),
      seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION),
      retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION.documents),
    };
    expect(recomputed).toEqual({
      planFingerprint: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.planFingerprint,
      seedProjectionFingerprint: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.seedProjectionFingerprint,
      retrievalDocumentFingerprint: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.retrievalDocumentFingerprint,
    });
    expect(new Set(Object.values(recomputed)).size).toBe(3);
  });

  it("deeply freezes the approval, admitted plan, and exported seed projection", () => {
    expectDeeplyFrozen(HISTORICAL_SHARED_POOL_APPROVAL_RECORD);
    expectDeeplyFrozen(HISTORICAL_SHARED_POOL_PLAN);
    expectDeeplyFrozen(HISTORICAL_SHARED_POOL_SEED_PROJECTION);
    expect(HISTORICAL_SHARED_POOL_PLAN.seedProjection).toBe(HISTORICAL_SHARED_POOL_SEED_PROJECTION);

    expect(() => ((HISTORICAL_SHARED_POOL_APPROVAL_RECORD as any).rationale = "mutated")).toThrow();
    expect(() => (HISTORICAL_SHARED_POOL_PLAN.cases as any[]).push({})).toThrow();
    expect(() => ((HISTORICAL_SHARED_POOL_SEED_PROJECTION.contexts[0] as any).text = "mutated")).toThrow();
    expect(() => (HISTORICAL_SHARED_POOL_SEED_PROJECTION.documents[0]!.sourcePaths as any[]).push("mutated")).toThrow();
  });

  it("keeps pooled model-safe and downstream projections recursively free of approval leakage", () => {
    const projections = {
      model: {
        network: HISTORICAL_SHARED_NETWORK,
        enrichmentRows: HISTORICAL_SHARED_POOL_ENRICHMENT_ROWS,
        retrievalDocuments: HISTORICAL_SHARED_POOL_RETRIEVAL_DOCUMENTS,
      },
      seed: HISTORICAL_SHARED_POOL_SEED_PROJECTION,
      child: HISTORICAL_SHARED_POOL_PLAN.seedProjection,
      artifact: structuredClone(HISTORICAL_SHARED_POOL_SEED_PROJECTION),
    };
    const serialized = JSON.stringify(projections);
    for (const forbidden of [
      "reportNames", "citations", "http://", "https://", "cutoff", "anonymizationReview",
      "semanticNegatives", "semanticNegativeReason", "approval", "status", "authorId", "reviewerId",
      "contentRevision", "reviewedAt", "decision", "independenceAttested", "recognizability", "rationale",
      "planFingerprint", "seedProjectionFingerprint", "retrievalDocumentFingerprint",
    ]) expect(serialized).not.toContain(forbidden);
  });

  it("binds the canonical receipt to the immutable Git handoff and rejects provenance and receipt mutations", async () => {
    const canonicalReceipt = await Bun.file(new URL("../../../../../docs/research/2026-08-07-ind-638a-shared-pool-approval.json", import.meta.url)).json();
    const actualCurrent = {
      authorId: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.authorId,
      contentRevision: HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision,
      corpusVersion: HISTORICAL_SHARED_POOL_FIXTURE.corpusVersion,
      planFingerprint: historicalSharedPoolPlanFingerprint(HISTORICAL_SHARED_POOL_PLAN),
      seedProjectionFingerprint: historicalSharedPoolSeedFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION),
      retrievalDocumentFingerprint: historicalRetrievalDocumentFingerprint(HISTORICAL_SHARED_POOL_SEED_PROJECTION.documents),
    };
    const provenance: ApprovalHandoffProvenance = {
      receiptParent: git(["rev-parse", `${APPROVAL_RECEIPT_COMMIT}^`]),
      receiptChangedPaths: git(["diff-tree", "--no-commit-id", "--name-only", "-r", APPROVAL_RECEIPT_COMMIT]).split("\n"),
      receiptObjectExists: gitObjectExists(APPROVAL_RECEIPT_COMMIT),
      contentObjectExists: gitObjectExists(HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision),
      contentAuthor: git(["show", "-s", "--format=%ae", HISTORICAL_SHARED_POOL_APPROVAL_RECORD.contentRevision]),
      receiptCommitAuthor: git(["show", "-s", "--format=%ae", APPROVAL_RECEIPT_COMMIT]),
    };
    expect(verifyApprovalHandoff(canonicalReceipt, provenance, actualCurrent)).toEqual(HISTORICAL_SHARED_POOL_APPROVAL_RECORD);

    const provenanceMutations: ApprovalHandoffProvenance[] = [
      { ...provenance, receiptParent: "f".repeat(40) },
      { ...provenance, receiptChangedPaths: [APPROVAL_RECEIPT_PATH, "unexpected.ts"] },
      { ...provenance, receiptObjectExists: false },
      { ...provenance, contentObjectExists: false },
      { ...provenance, contentAuthor: "wrong-author@index.network" },
      { ...provenance, receiptCommitAuthor: provenance.contentAuthor },
      { ...provenance, receiptCommitAuthor: "wrong-signer@index.network" },
    ];
    for (const mutation of provenanceMutations) {
      expect(() => verifyApprovalHandoff(canonicalReceipt, mutation, actualCurrent)).toThrow();
    }

    const receiptMutations: unknown[] = [
      { ...canonicalReceipt, authorId: canonicalReceipt.reviewerId, reviewerId: canonicalReceipt.reviewerId },
      { ...canonicalReceipt, independenceAttested: false },
      { ...canonicalReceipt, reviewedAt: "not-a-date" },
      { ...canonicalReceipt, contentRevision: "invalid" },
      { ...canonicalReceipt, contentRevision: "f".repeat(40) },
      { ...canonicalReceipt, corpusVersion: "stale-corpus" },
      { ...canonicalReceipt, planFingerprint: "f".repeat(64) },
      { ...canonicalReceipt, seedProjectionFingerprint: "f".repeat(64) },
      { ...canonicalReceipt, retrievalDocumentFingerprint: "f".repeat(64) },
      { ...canonicalReceipt, recognizability: "high" },
      { ...canonicalReceipt, decision: "pending" },
      { ...canonicalReceipt, rationale: "   " },
    ];
    for (const mutation of receiptMutations) {
      expect(() => verifyApprovalHandoff(mutation, provenance, actualCurrent)).toThrow();
    }
  });
});
