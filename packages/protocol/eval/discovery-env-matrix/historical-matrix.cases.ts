import { HISTORICAL_CASES } from "../matching/matching.historical.js";
import type { MatchingCase } from "../matching/matching.types.js";

import type { HistoricalMatrixCase, HistoricalMatrixModelInput, MatrixParticipant, ReconstructedIntent } from "./historical-matrix.types.js";

interface IntentReconstruction {
  text: string;
  basis: string[];
}

const RECONSTRUCTED_INTENTS: Record<string, IntentReconstruction> = {
  "h1-b": {
    text: "Design elegant computer circuit boards and share the schematics with fellow hobbyists.",
    basis: ["designs elegant computer circuit boards for fun", "shares the schematics at his hobby club"],
  },
  "h1-d": {
    text: "Supply electronic components and chips to the hobby community without co-founding a company.",
    basis: ["supplying electronic components and chips to the hobby community", "no interest in co-founding anything"],
  },
  "h1-e": {
    text: "Tinker with kit computers on weekends purely for enjoyment, not to start a company or ship a product.",
    basis: ["tinkering with kit computers on weekends purely for enjoyment", "no desire to start a company or ship a product"],
  },
  "h2-b": {
    text: "Apply physical model-building to a biological problem worth my modeling skill.",
    basis: ["builds structural models", "Restless for a biological problem worth his modeling skill"],
  },
  "h2-d": {
    text: "Keep the research group operating through funding, equipment, and scheduling support.",
    basis: ["manages funding, equipment, and scheduling for the research group", "Keeps the lab running"],
  },
  "h2-e": {
    text: "Focus on reaction kinetics of small industrial compounds rather than biological macromolecular structure.",
    basis: ["focused on the reaction kinetics of small industrial compounds", "not working on biological macromolecular structure"],
  },
  "h3-b": {
    text: "Find a writing partner with lyrical ideas and attitude to complement my melody and harmony skills.",
    basis: ["Looking for a writing partner with lyrical ideas and attitude", "Melodically gifted young musician"],
  },
  "h3-d": {
    text: "Book bands into local clubs and venues and connect acts to stages and audiences.",
    basis: ["books bands into the local clubs and venues", "Connects acts to stages and audiences"],
  },
  "h3-e": {
    text: "Devote my work to orchestral repertoire and chamber recitals rather than popular songwriting or club performance.",
    basis: ["devoted to the orchestral repertoire and chamber recitals", "No interest in popular songwriting or club performance"],
  },
  "h4-b": {
    text: "Write first checks into early technical teams and provide hands-on support to founders.",
    basis: ["writes first checks into early technical teams", "rolling up his sleeves with founders"],
  },
  "h4-d": {
    text: "Invest in companies with millions in revenue and proven traction, not pre-revenue prototypes.",
    basis: ["only writes large checks into companies with millions in revenue and proven traction", "Does not do first checks or pre-revenue prototypes"],
  },
  "h4-e": {
    text: "Write first checks only for consumer food and beverage brands.",
    basis: ["invests exclusively in consumer food and beverage brands", "Writes first checks"],
  },
  "h5-b": {
    text: "Study dendritic cells and vaccine responses with immune-cell assays for innate immune activation.",
    basis: ["studying dendritic cells and vaccine responses", "assays and domain knowledge for measuring innate immune activation"],
  },
  "h5-d": {
    text: "Pursue observational astronomy and telescope data analysis rather than RNA therapeutics or immune-cell assays.",
    basis: ["Domain expert in observational astronomy", "no connection to RNA therapeutics or immune-cell assays"],
  },
  "h5-e": {
    text: "Build business dashboards and reports for a general analytics community rather than biomedical research.",
    basis: ["builds business dashboards and reports", "does no biomedical research"],
  },
};

type HistoricalEntity = MatchingCase["input"]["entities"][number];

function profileTextFor(entity: HistoricalEntity): string {
  const { bio = "", location = "", interests = [], skills = [] } = entity.profile;
  return [
    bio.trim(),
    `Location: ${location.trim()}.`,
    `Interests: ${interests.join(", ")}.`,
    `Skills: ${skills.join(", ")}.`,
  ].join("\n");
}

function intentFor(entity: HistoricalEntity): ReconstructedIntent {
  const existingIntent = entity.intents?.[0]?.payload.trim();
  if (existingIntent) return { text: existingIntent, kind: "existing", basis: [] };

  const reconstruction = RECONSTRUCTED_INTENTS[entity.userId];
  if (!reconstruction) throw new Error(`${entity.userId}: missing historically grounded intent reconstruction`);

  return {
    text: reconstruction.text,
    kind: "historically_grounded_reconstruction",
    basis: [...reconstruction.basis],
  };
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

function adaptHistoricalCase(source: MatchingCase): HistoricalMatrixCase {
  const sourceEntity = source.input.entities.find((entity) => entity.userId === source.input.discovererId);
  if (!sourceEntity) throw new Error(`${source.id}: missing historical source participant`);

  const expectedUserId = source.expect.find((expectation) => expectation.match)?.candidateId;
  if (!expectedUserId) throw new Error(`${source.id}: missing historical expected target`);

  const networkContext = source.input.networkContexts?.[sourceEntity.networkId];
  if (!networkContext) throw new Error(`${source.id}: missing historical source network context`);

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
    Object.freeze(participant.intent.basis);
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

/** Five frozen Tier-3 cases adapted directly from the canonical historical corpus. */
export const HISTORICAL_MATRIX_CASES: readonly HistoricalMatrixCase[] = Object.freeze(
  HISTORICAL_CASES.map(adaptHistoricalCase).map(freezeCase),
);

/** Removes report-only and reconstruction-audit fields before any model invocation. */
export function matrixModelInput(matrixCase: HistoricalMatrixCase): HistoricalMatrixModelInput {
  return {
    id: matrixCase.id,
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
      if (participant.intent.kind === "historically_grounded_reconstruction") {
        if (participant.intent.basis.length === 0 || participant.intent.basis.some((basis) => !participant.profileText.includes(basis))) {
          throw new Error(`${matrixCase.id}: ${participant.id} reconstruction basis is not present in profileText`);
        }
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
