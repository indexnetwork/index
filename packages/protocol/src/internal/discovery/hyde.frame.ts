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

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Case-insensitive literal matching bounded by Unicode letters and numbers. */
function containsAlphanumericSpanCaseInsensitive(container: string, value: string): boolean {
  const needle = value.trim();
  if (!needle) return false;
  return new RegExp(
    `(?<![\\p{L}\\p{M}\\p{N}])${escapeRegularExpression(needle)}(?![\\p{L}\\p{M}\\p{N}])`,
    'iu',
  ).test(container);
}

function hasExactEvidence(sourceText: string, evidence: string): boolean {
  return containsAlphanumericSpanCaseInsensitive(sourceText, evidence);
}

const GENERIC_ROLE_TOKENS = new Set([
  'advisor', 'analyst', 'attendee', 'borrower', 'builder', 'buyer', 'candidate',
  'capitalist', 'ceo', 'cfo', 'client', 'cmo', 'cofounder', 'collaborator',
  'consultant', 'coo', 'creator', 'cto', 'customer', 'designer', 'developer',
  'director', 'employer', 'engineer', 'entrepreneur', 'executive', 'expert',
  'founder', 'funder', 'hire', 'hiring', 'investor', 'leader', 'lender',
  'manager', 'mentor', 'operator', 'organizer', 'owner', 'partner', 'practitioner',
  'professional', 'provider', 'recruiter', 'researcher', 'scientist', 'seller',
  'speaker', 'specialist', 'sponsor', 'strategist', 'supplier', 'technologist',
  'vendor', 'vp',
]);

const GENERIC_ROLE_MODIFIERS = new Set([
  'business', 'co', 'commercial', 'community', 'creative', 'early', 'experienced',
  'growth', 'independent', 'industry', 'junior', 'lead', 'local', 'nonprofit',
  'operations', 'product', 'professional', 'public', 'senior', 'stage',
  'startup', 'technical', 'venture',
]);

function roleTokens(role: string): string[] {
  return role.toLowerCase().match(/[\p{L}\p{M}\d]+/gu) ?? [];
}

function hasUnsupportedSourceRoleMaterial(role: string, evidence: string): boolean {
  const substantiveTokens = roleTokens(role).filter((token) => !GENERIC_ROLE_MODIFIERS.has(token));
  return substantiveTokens.length === 0
    || substantiveTokens.some((token) => !containsAlphanumericSpanCaseInsensitive(evidence, token));
}

function hasUnsupportedCounterpartRoleMaterial(role: string, evidence: string): boolean {
  return roleTokens(role).some((token) =>
    !GENERIC_ROLE_TOKENS.has(token)
    && !GENERIC_ROLE_MODIFIERS.has(token)
    && !containsAlphanumericSpanCaseInsensitive(evidence, token));
}

/**
 * Remove frame elements that cross the source-evidence boundary. Structured
 * payloads must occur inside their evidence span. Source roles require grounded
 * substantive tokens; counterpart roles may add generic inferred role language.
 */
export function sanitizeHydeSourceFrame(sourceText: string, frame: HydeSourceFrame): HydeSourceFrame {
  const grounded = <T extends { evidence: string }>(items: T[]): T[] =>
    items.filter((item) => hasExactEvidence(sourceText, item.evidence));
  return {
    sourceRoles: grounded(frame.sourceRoles)
      .filter((item) => !hasUnsupportedSourceRoleMaterial(item.role, item.evidence)),
    counterpartRoles: grounded(frame.counterpartRoles)
      .filter((item) => !hasUnsupportedCounterpartRoleMaterial(item.role, item.evidence)),
    hardConstraints: grounded(frame.hardConstraints)
      .filter((item) => containsAlphanumericSpanCaseInsensitive(item.evidence, item.value)),
    namedEntities: grounded(frame.namedEntities)
      .filter((item) => containsAlphanumericSpanCaseInsensitive(item.evidence, item.name)),
    domainVocabulary: grounded(frame.domainVocabulary)
      .filter((item) => containsAlphanumericSpanCaseInsensitive(item.evidence, item.term)),
  };
}
