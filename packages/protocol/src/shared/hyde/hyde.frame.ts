import { z } from 'zod';

/** Source-grounded role supported by an exact span from the source text. */
export interface HydeFrameRole {
  role: string;
  evidence: string;
}

export const HYDE_HARD_CONSTRAINT_TYPES = [
  'location',
  'time',
  'numeric',
  'credential',
  'organization',
  'exclusivity',
  'other',
] as const;

export type HydeHardConstraintType = (typeof HYDE_HARD_CONSTRAINT_TYPES)[number];

/** Explicit hard constraint supported by an exact span from the source text. */
export interface HydeFrameHardConstraint {
  type: HydeHardConstraintType;
  value: string;
  evidence: string;
}

export const HYDE_NAMED_ENTITY_TYPES = [
  'person',
  'organization',
  'product',
  'location',
  'event',
  'other',
] as const;

export type HydeNamedEntityType = (typeof HYDE_NAMED_ENTITY_TYPES)[number];

/** Named entity supported by an exact span from the source text. */
export interface HydeFrameNamedEntity {
  type: HydeNamedEntityType;
  name: string;
  evidence: string;
}

/** Domain term supported by an exact span from the source text. */
export interface HydeFrameVocabulary {
  term: string;
  evidence: string;
}

/**
 * Source-grounded controls for frame-constrained HyDE generation.
 * Counterpart roles may be reciprocal/complementary inferences, but their
 * evidence must still be an exact span from the source text.
 */
export interface HydeSourceFrame {
  sourceRoles: HydeFrameRole[];
  counterpartRoles: HydeFrameRole[];
  hardConstraints: HydeFrameHardConstraint[];
  namedEntities: HydeFrameNamedEntity[];
  domainVocabulary: HydeFrameVocabulary[];
}

const roleSchema = z.object({
  role: z.string().min(1),
  evidence: z.string().min(1).describe('Exact evidence span copied from sourceText'),
});

const hardConstraintSchema = z.object({
  type: z.enum(HYDE_HARD_CONSTRAINT_TYPES),
  value: z.string().min(1),
  evidence: z.string().min(1).describe('Exact evidence span copied from sourceText'),
});

const namedEntitySchema = z.object({
  type: z.enum(HYDE_NAMED_ENTITY_TYPES),
  name: z.string().min(1),
  evidence: z.string().min(1).describe('Exact evidence span copied from sourceText'),
});

const vocabularySchema = z.object({
  term: z.string().min(1),
  evidence: z.string().min(1).describe('Exact evidence span copied from sourceText'),
});

/** Structured-output schema for source-grounded frames. */
export const HydeSourceFrameSchema = z.object({
  sourceRoles: z.array(roleSchema),
  counterpartRoles: z.array(roleSchema),
  hardConstraints: z.array(hardConstraintSchema),
  namedEntities: z.array(namedEntitySchema),
  domainVocabulary: z.array(vocabularySchema),
});

function hasExactEvidence(sourceText: string, evidence: string): boolean {
  return evidence.length > 0 && sourceText.toLocaleLowerCase().includes(evidence.toLocaleLowerCase());
}

/**
 * Remove every frame element whose evidence is not a case-insensitive exact
 * substring of sourceText. No other text, including profileContext, is accepted
 * as evidence.
 */
export function sanitizeHydeSourceFrame(sourceText: string, frame: HydeSourceFrame): HydeSourceFrame {
  const grounded = <T extends { evidence: string }>(items: T[]): T[] =>
    items.filter((item) => hasExactEvidence(sourceText, item.evidence));

  return {
    sourceRoles: grounded(frame.sourceRoles),
    counterpartRoles: grounded(frame.counterpartRoles),
    hardConstraints: grounded(frame.hardConstraints),
    namedEntities: grounded(frame.namedEntities),
    domainVocabulary: grounded(frame.domainVocabulary),
  };
}
