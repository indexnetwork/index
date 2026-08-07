import { HISTORICAL_QUALITY_CASES } from "../matching/matching.historical.js";
import type { HistoricalQualityCase } from "./historical-quality.corpus.js";
import type { HistoricalMatrixCase, HistoricalMatrixModelInput, MatrixIntent, MatrixParticipant } from "./historical-matrix.types.js";

type HistoricalEntity = HistoricalQualityCase["input"]["entities"][number];

function profileTextFor(entity: HistoricalEntity): string {
  const { bio = "", location = "", interests = [], skills = [] } = entity.profile;
  return [
    bio.trim(),
    `Location: ${location.trim()}.`,
    `Interests: ${interests.join(", ")}.`,
    `Skills: ${skills.join(", ")}.`,
  ].join("\n");
}

function intentFor(entity: HistoricalEntity): MatrixIntent {
  if (entity.intents?.length !== 1) {
    throw new Error(`${entity.userId}: expected exactly one audited participant intent`);
  }
  return { text: entity.intents[0]!.payload };
}

function participantFor(entity: HistoricalEntity): MatrixParticipant {
  return {
    id: entity.userId,
    profileText: profileTextFor(entity),
    location: entity.profile.location ?? "",
    interests: [...(entity.profile.interests ?? [])],
    skills: [...(entity.profile.skills ?? [])],
    intent: intentFor(entity),
  };
}

function adaptHistoricalCase(source: HistoricalQualityCase): HistoricalMatrixCase {
  const sourceEntity = source.input.entities.find((entity) => entity.userId === source.input.discovererId);
  if (!sourceEntity) throw new Error(`${source.id}: missing historical source participant`);

  const expectedUserId = source.expect.find((expectation) => expectation.match)?.candidateId;
  if (!expectedUserId) throw new Error(`${source.id}: missing historical expected target`);

  const networkContext = source.input.networkContexts?.[sourceEntity.networkId] ?? "";

  return {
    id: source.id,
    description: source.description,
    networkContext,
    sourceUserId: source.input.discovererId,
    expectedUserId,
    excludedUserIds: source.expect.filter((expectation) => !expectation.match).map((expectation) => expectation.candidateId),
    participants: source.input.entities.map(participantFor),
    reportNames: source.reportNames ? { ...source.reportNames } : undefined,
  };
}

function modelInputContains(value: unknown, text: string): boolean {
  if (typeof value === "string") return value.includes(text);
  if (value && typeof value === "object") return Object.values(value).some((entry) => modelInputContains(entry, text));
  return false;
}

function freezeCase(matrixCase: HistoricalMatrixCase): HistoricalMatrixCase {
  for (const participant of matrixCase.participants) {
    Object.freeze(participant.intent);
    Object.freeze(participant.interests);
    Object.freeze(participant.skills);
    Object.freeze(participant);
  }
  Object.freeze(matrixCase.participants);
  Object.freeze(matrixCase.excludedUserIds);
  if (matrixCase.reportNames) Object.freeze(matrixCase.reportNames);
  return Object.freeze(matrixCase);
}

/** Five frozen Tier-3 cases adapted directly from the canonical audited corpus. */
export const HISTORICAL_MATRIX_CASES: readonly HistoricalMatrixCase[] = Object.freeze(
  HISTORICAL_QUALITY_CASES.map(adaptHistoricalCase).map(freezeCase),
);

/** Removes control-plane and report-only fields before any model invocation. */
export function matrixModelInput(matrixCase: HistoricalMatrixCase): HistoricalMatrixModelInput {
  return {
    description: matrixCase.description,
    networkContext: matrixCase.networkContext,
    sourceUserId: matrixCase.sourceUserId,
    participants: matrixCase.participants.map((participant) => ({
      id: participant.id,
      profileText: participant.profileText,
      location: participant.location,
      interests: [...participant.interests],
      skills: [...participant.skills],
      intent: { text: participant.intent.text },
    })),
  };
}

/** Validates fixture integrity and the model-safe serialization boundary. */
export function validateHistoricalMatrixCases(cases: readonly HistoricalMatrixCase[]): void {
  if (new Set(cases.map((matrixCase) => matrixCase.id)).size !== cases.length) {
    throw new Error("Duplicate historical matrix case id");
  }

  for (const matrixCase of cases) {
    if (matrixCase.participants.some((participant) => !participant.id.trim())) {
      throw new Error(`${matrixCase.id}: participant is missing an id`);
    }
    const participantIds = new Set(matrixCase.participants.map((participant) => participant.id));
    if (participantIds.size !== matrixCase.participants.length) {
      throw new Error(`${matrixCase.id}: duplicate participant id`);
    }
    if (!participantIds.has(matrixCase.sourceUserId)) {
      throw new Error(`${matrixCase.id}: sourceUserId is not a participant`);
    }
    if (!matrixCase.expectedUserId.trim()) {
      throw new Error(`${matrixCase.id}: missing expected target`);
    }
    if (!participantIds.has(matrixCase.expectedUserId)) {
      throw new Error(`${matrixCase.id}: expectedUserId is not a participant`);
    }
    for (const excludedUserId of matrixCase.excludedUserIds) {
      if (!participantIds.has(excludedUserId)) {
        throw new Error(`${matrixCase.id}: excludedUserId ${excludedUserId} is not a participant`);
      }
    }
    if (matrixCase.excludedUserIds.includes(matrixCase.expectedUserId)) {
      throw new Error(`${matrixCase.id}: expected target is excluded`);
    }

    for (const participant of matrixCase.participants) {
      if (!participant.intent.text.trim()) {
        throw new Error(`${matrixCase.id}: ${participant.id} has an empty intent`);
      }
    }

    for (const userId of Object.keys(matrixCase.reportNames ?? {})) {
      if (!participantIds.has(userId)) {
        throw new Error(`${matrixCase.id}: reportNames userId ${userId} is not a participant`);
      }
    }

    const modelInput = matrixModelInput(matrixCase);
    for (const reportName of Object.values(matrixCase.reportNames ?? {})) {
      if (reportName && modelInputContains(modelInput, reportName)) {
        throw new Error(`${matrixCase.id}: report name is present in matrixModelInput`);
      }
    }
  }
}

validateHistoricalMatrixCases(HISTORICAL_MATRIX_CASES);
