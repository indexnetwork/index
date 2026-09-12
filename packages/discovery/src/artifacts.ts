import { createHash } from 'node:crypto';
import { z } from 'zod/v4';
import { getAbortSignalConfig, loggerFor, requestContext, timed } from './runtime.js';
import type { AgentTiming, ArtifactCache, ArtifactStore, EmbeddingGenerator, HydeTargetCorpus, Lens, Model, RunOptions } from './types.js';

/** Cache-aware source-grounded retrieval artifacts, independent of intent lifecycle. */
export class Artifacts {
  private readonly deps;

  constructor(deps: { database: ArtifactStore; embedder: EmbeddingGenerator; cache: ArtifactCache; model: Model }) {
    this.deps = { ...deps, inferrer: new LensInferrer(deps.model), generator: new HydeGenerator(deps.model), validator: new HydeValidator(deps.model) };
  }

  /**
   * @param input - Source identity, text, and optional inference context.
   * @param options - Cancellation and host observability for this invocation.
   * @returns Retrieval documents and vectors; only validated documents are persisted.
   * @throws On generation, embedding, storage failure, or cancellation.
   */
  prepare(input: ArtifactInput, options?: RunOptions) {
    return requestContext.run(options ?? requestContext.getStore() ?? {}, () => prepareArtifacts(input, this.deps));
  }
}



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

/** Fresh object each time so JSON Schema inlines both role arrays (Gemini rejects $ref). */
function createRoleSchema() {
  return z.object({
    role: z.string().min(1),
    evidence: z.string().min(1).describe('Exact evidence span copied from sourceText'),
  });
}

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
  sourceRoles: z.array(createRoleSchema()),
  counterpartRoles: z.array(createRoleSchema()),
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

/**
 * Lens Inferrer Agent: analyzes source text (intent or query) with optional
 * profile context and infers 1-N search lenses, each tagged with a target corpus.
 * Replaces the hardcoded HydeStrategy enum and regex-based selectStrategiesFromQuery.
 */



export interface LensInferenceInput {
  /** Intent payload or search query. */
  sourceText: string;
  /** User's profile summary for domain context (optional). */
  profileContext?: string;
  /** Maximum number of lenses to infer (default 3). */
  maxLenses?: number;
}

export interface LensInferenceOutput {
  lenses: Lens[];
  /** Sanitized source frame, present only for frame-constrained inference. */
  sourceFrame?: HydeSourceFrame;
}

const LENS_SYSTEM_PROMPT = `You analyze goals and search queries to identify the most relevant perspectives for finding matching people in a professional network.

For each perspective you identify, specify:
1. A clear, specific description of who or what to search for
2. Whether to search "profiles" (user bios, expertise, backgrounds) or "intents" (stated goals, needs, aspirations)
3. A brief reason why this perspective is relevant

Guidelines:
- Be specific and domain-aware. "early-stage crypto infrastructure investor" is better than "investor".
- Consider both sides: who can help the person AND whose goals complement theirs.
- When user context is provided, tailor perspectives to their domain (e.g. a DePIN founder searching for "investors" needs crypto-native infra investors specifically).
- Generate only perspectives that add distinct search value — don't repeat similar angles.
- Use "profiles" when looking for a type of person (expert, advisor, leader). Use "intents" when looking for a complementary goal or need (someone raising, someone hiring, someone seeking collaboration).
- Always include at least one "profiles" perspective when the source describes a need that a specific type of professional could fulfill. Most intents benefit from profile-based discovery.
- LOCATION AWARENESS: When the source text or user context mentions a specific location (city, region, country), incorporate it into lens descriptions. For example, "investors in San Francisco" should produce a lens like "SF-based early-stage investor" rather than just "early-stage investor". This helps the hypothetical document generator produce location-specific search documents, improving retrieval quality.`;

/** Source-grounded system prompt used only by frame extraction. */
export const FRAME_SYSTEM_PROMPT = `You extract a source-grounded frame for semantic retrieval from sourceText alone.

Source-frame rules:
- Extract evidence ONLY from sourceText.
- Every frame element must include an evidence field copied as an exact substring of sourceText.
- sourceRoles describe roles held or offered by the source side.
- sourceRoles and counterpartRoles MUST use generic lower-case role labels only (for example, "founder", "investor", or "technical advisor"). Never put a person, organization, product, location, time, number, credential, or exclusivity detail in a role label.
- counterpartRoles describe reciprocal or complementary target roles. A generic role may be inferred, but its evidence must be an exact sourceText span that supports the inference.
- hardConstraints contain only explicit constraints and classify each as location, time, numeric, credential, organization, exclusivity, or other.
- namedEntities contain only proper names explicitly present in sourceText and classify each as person, organization, product, location, event, or other.
- domainVocabulary contains source domain terms worth preserving.`;

const lensSchema = z.object({
  label: z.string().describe('Specific description of the search perspective'),
  corpus: z.enum(['profiles', 'intents']).describe('Search user profiles or user intents'),
  reasoning: z.string().describe('Why this perspective is relevant'),
});

const lensResponseFormat = z.object({
  lenses: z.array(lensSchema).min(1).max(5).describe('Inferred search lenses'),
});

/** Structured-output schema used only by source-frame extraction. */
export const FrameResponseSchema = z.object({
  sourceFrame: HydeSourceFrameSchema,
});

const lensLogger = loggerFor("LensInferrer");

/** Infers search lenses from source text and optional profile context. */
export class LensInferrer {
  constructor(private readonly model: Model) {}

  /** Infer search lenses and extract a source-only frame in parallel. */
  async infer(input: LensInferenceInput): Promise<LensInferenceOutput> {
    const { sourceText, profileContext, maxLenses = 3 } = input;

    lensLogger.verbose('Inferring lenses', {
      sourceTextLength: sourceText.length,
      hasProfileContext: !!profileContext,
      maxLenses,
    });

    let humanPrompt = `Identify up to ${maxLenses} search perspectives for finding relevant matches.\n\nSource: "${sourceText}"`;

    if (profileContext) {
      humanPrompt += `\n\nUser context: ${profileContext}`;
    }

    const lensPromise = this.model.complete({
      name: 'lens_inferrer', schema: lensResponseFormat,
      messages: [
        { role: 'system', content: LENS_SYSTEM_PROMPT },
        { role: 'user', content: humanPrompt },
      ],
    }, getAbortSignalConfig()).then(result => lensResponseFormat.parse(result).lenses.slice(0, maxLenses));
    const framePromise = this.model.complete({
      name: 'lens_inferrer_frame_v1', schema: FrameResponseSchema,
      messages: [
        { role: 'system', content: FRAME_SYSTEM_PROMPT },
        { role: 'user', content: `Extract the source frame.\n\nSource: "${sourceText}"` },
      ],
    }, getAbortSignalConfig()).then(result => sanitizeHydeSourceFrame(sourceText, FrameResponseSchema.parse(result).sourceFrame));
    const [lensResult, frameResult] = await Promise.allSettled([lensPromise, framePromise]);

    getAbortSignalConfig().signal?.throwIfAborted();

    if (lensResult.status === 'rejected') {
      lensLogger.error('Lens inference failed', { error: lensResult.reason });
      return { lenses: [] };
    }

    const lenses = lensResult.value;
    lensLogger.verbose('Frame-constrained lenses inferred', { count: lenses.length });

    if (frameResult.status === 'rejected') {
      lensLogger.error('Source frame extraction failed', { error: frameResult.reason });
      return {
        lenses,
        sourceFrame: {
          sourceRoles: [],
          counterpartRoles: [],
          hardConstraints: [],
          namedEntities: [],
          domainVocabulary: [],
        },
      };
    }

    return { lenses, sourceFrame: frameResult.value };
  }
}

/**
 * HyDE Generator Agent: pure LLM agent for generating hypothetical documents
 * in the target corpus voice. Uses free-text lens labels instead of enum strategies.
 */


const generatorLogger = loggerFor("HydeGenerator");

const GENERATOR_SYSTEM_PROMPT = `You are a Hypothetical Document Generator for semantic search.

Your task: Given a source statement (e.g. an intent or goal), write a short hypothetical document in the voice of the TARGET side—the kind of person or statement that would be an ideal match for that source.

Rules:
- Write in first person as the target.
- Be concrete and specific so the text is good for vector similarity search.
- Output only the hypothetical document text, no meta-commentary.
- Keep length to a few sentences or one short paragraph.`;

const generatorResponseFormat = z.object({
  hypotheticalDocument: z
    .string()
    .describe('The hypothetical document text in the target voice, suitable for embedding and retrieval'),
});

export interface HydeGeneratorOutput {
  text: string;
}

export interface HydeGenerateInput {
  /** Original intent or query text. */
  sourceText: string;
  /** Free-text lens label from LensInferrer (e.g. "crypto infra VC"). */
  lens: string;
  /** Which corpus voice to generate in. */
  corpus: HydeTargetCorpus;
  /** Sanitized source-grounded frame.  */
  sourceFrame: HydeSourceFrame;
}

function renderList(items: string[]): string {
  return items.length > 0 ? items.join('; ') : '(none)';
}

/** Build the frame-v1 generation prompt from sanitized source evidence. */
export function buildFrameHydePrompt(input: HydeGenerateInput & { sourceFrame: HydeSourceFrame }): string {
  const { sourceText, corpus, sourceFrame } = input;
  const corpusInstruction = {
    profiles: 'Write a first-person professional biography in the target profile voice.',
    intents: 'Write a first-person goal or aspiration in the target intent voice.',
  }[corpus];

  return `${corpusInstruction}

Source text: "${sourceText}"

Sanitized source frame:
- Source roles: ${renderList(sourceFrame.sourceRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Counterpart/complementary roles: ${renderList(sourceFrame.counterpartRoles.map((item) => `${item.role} [evidence: "${item.evidence}"]`))}
- Explicit hard constraints: ${renderList(sourceFrame.hardConstraints.map((item) => `${item.type}: ${item.value} [evidence: "${item.evidence}"]`))}
- Named entities: ${renderList(sourceFrame.namedEntities.map((item) => `${item.type}: ${item.name} [evidence: "${item.evidence}"]`))}
- Domain vocabulary: ${renderList(sourceFrame.domainVocabulary.map((item) => `${item.term} [evidence: "${item.evidence}"]`))}

Generation constraints:
- You MAY elaborate generic roles and generic domain language.
- You MAY use reciprocal/complementary inversion and write in the target voice.
- You MUST NOT introduce any new proper noun or named entity.
- You MUST NOT introduce any new hard location, time, numeric, credential, organization, or exclusivity constraint.
- Preserve explicit source-frame constraints when they apply to the reciprocal target.
- Output only a few sentences or one short paragraph.`;
}

/** Generates hypothetical documents in a target corpus voice for semantic search. */
export class HydeGenerator {
  constructor(private readonly model: Model) {}

  /** Generate a hypothetical document for the given source text and lens. */
  async generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput> {
    const result = await this.model.complete({
      name: 'hyde_generator', schema: generatorResponseFormat,
      messages: [
        { role: 'system', content: GENERATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildFrameHydePrompt(input) },
      ],
    }, getAbortSignalConfig());
    const parsed = generatorResponseFormat.parse(result);
    const text = parsed.hypotheticalDocument ?? '';

    generatorLogger.verbose('Generated HyDE document', {
      lens: input.lens,
      corpus: input.corpus,
      textLength: text.length,
      frameConstrained: !!input.sourceFrame,
    });

    return { text };
  }
}

export interface HydeValidationDocument {
  corpus: HydeTargetCorpus;
  text: string;
}

export interface HydeValidationInput {
  sourceText: string;
  sourceFrame: HydeSourceFrame;
  /** Generated documents keyed by opaque caller-supplied identifiers. */
  documents: Record<string, HydeValidationDocument>;
}

export interface HydeValidationVerdict {
  key: string;
  valid: boolean;
  unsupportedNamedEntities: string[];
  unsupportedHardConstraints: string[];
  reasoning: string;
}

export interface HydeValidationOutput {
  verdicts: HydeValidationVerdict[];
}

/** Structured-output schema for a single batch validation response. */
export const HydeValidationResponseSchema = z.object({
  verdicts: z.array(z.object({
    key: z.string().min(1),
    valid: z.boolean(),
    unsupportedNamedEntities: z.array(z.string()),
    unsupportedHardConstraints: z.array(z.string()),
    reasoning: z.string().min(1).describe('Concise explanation of the verdict'),
  })),
});

const VALIDATOR_SYSTEM_PROMPT = `You validate hypothetical retrieval documents against a sanitized source-grounded frame.

A document is invalid only when it invents unsupported proper nouns/named entities or unsupported HARD constraints (location, time, numeric, credential, organization, or exclusivity constraints).

Explicitly allowed and not grounds for rejection:
- first-person target voice;
- generic role or domain elaboration;
- reciprocal or complementary inversion of source and target roles.

Return exactly one verdict for each opaque key. Copy each key exactly. Mark valid=false when either unsupported list is non-empty. Keep reasoning concise.`;

/** Build a profile-free batch validation prompt. */
export function buildHydeValidationPrompt(input: HydeValidationInput): string {
  return `Source text:\n${input.sourceText}\n\nSanitized source frame:\n${JSON.stringify(input.sourceFrame)}\n\nGenerated documents:\n${JSON.stringify(input.documents)}`;
}

/** Validates a batch against source evidence without access to profile context. */
export class HydeValidator {
  constructor(private readonly model: Model) {}

  /** Validate all generated documents in one structured-model call. */
  async validate(input: HydeValidationInput): Promise<HydeValidationOutput> {
    const result = await this.model.complete({
      name: 'hyde_validator', schema: HydeValidationResponseSchema,
      temperature: 0, maxTokens: 2048,
      messages: [
        { role: 'system', content: VALIDATOR_SYSTEM_PROMPT },
        { role: 'user', content: buildHydeValidationPrompt(input) },
      ],
    }, getAbortSignalConfig());
    return HydeValidationResponseSchema.parse(result);
  }
}

export type HydeDocumentOrigin = 'cache' | 'db' | 'generated';
export type HydeValidationStatus = 'valid' | 'invalid' | 'failed_open';

/** Single HyDE document (text + embedding) for one lens. */
export interface HydeDocumentState {
  lens: string;
  targetCorpus: HydeTargetCorpus;
  hydeText: string;
  hydeEmbedding: number[];
  origin?: HydeDocumentOrigin;
  validationStatus?: HydeValidationStatus;
  hydeGenerationVersion?: 'frame-v1';
  frameFingerprint?: string;
  sourceTextHash?: string;
  generatedAt?: string;
}


export interface ArtifactInput {
  sourceType: 'intent' | 'query' | 'context';
  sourceId?: string;
  sourceText: string;
  profileContext?: string;
  maxLenses?: number;
  forceRegenerate?: boolean;
}

export interface HydeState extends ArtifactInput {
  maxLenses: number;
  forceRegenerate: boolean;
  lenses: Lens[];
  sourceFrame?: HydeSourceFrame;
  frameFingerprint?: string;
  sourceTextHash?: string;
  generatedAt?: string;
  hydeDocuments: Record<string, HydeDocumentState>;
  hydeEmbeddings: Record<string, number[]>;
  agentTimings: AgentTiming[];
}

export const HYDE_FRAME_GENERATION_VERSION = 'frame-v1' as const;

/** Exact UTF-8 source identity, unchanged from persisted frame-v1 artifacts. */
export function computeHydeSourceTextHash(sourceText: string): string {
  return createHash('sha256').update(sourceText, 'utf8').digest('hex');
}

const HYDE_DEFAULT_CACHE_TTL = 3600;
const artifactLogger = loggerFor("Discovery:Artifacts");
let lastGenerationTimestamp = 0;

function nextGenerationMarker(): string {
  lastGenerationTimestamp = Math.max(Date.now(), lastGenerationTimestamp + 1);
  return new Date(lastGenerationTimestamp).toISOString();
}

/** Narrow lens inferrer contract accepted by the graph. */
export interface HydeLensInferrerLike {
  infer(input: LensInferenceInput): Promise<LensInferenceOutput>;
}

/** Narrow document generator contract accepted by the graph. */
export interface HydeGeneratorLike {
  generate(input: HydeGenerateInput): Promise<HydeGeneratorOutput>;
}

/** Narrow batch validator contract accepted by the graph. */
export interface HydeValidatorLike {
  validate(input: HydeValidationInput): Promise<HydeValidationOutput>;
}

/** Hash a lens label (+ optional corpus) to a short key for cache/DB indexing. */
function lensHash(label: string, corpus?: string): string {
  const input = corpus
    ? `${label.toLowerCase().trim()}:${corpus}`
    : label.toLowerCase().trim();
  return computeHydeSourceTextHash(input).slice(0, 16);
}

function entityCacheKey(sourceId: string | undefined, sourceText: string): string {
  return sourceId ?? `q:${computeHydeSourceTextHash(sourceText).slice(0, 16)}`;
}

function sortedFrame(frame: HydeSourceFrame): HydeSourceFrame {
  const sort = <T>(items: T[]): T[] => [...items].sort((left, right) => {
    const leftJson = JSON.stringify(left);
    const rightJson = JSON.stringify(right);
    return leftJson < rightJson ? -1 : leftJson > rightJson ? 1 : 0;
  });
  return {
    sourceRoles: sort(frame.sourceRoles),
    counterpartRoles: sort(frame.counterpartRoles),
    hardConstraints: sort(frame.hardConstraints),
    namedEntities: sort(frame.namedEntities),
    domainVocabulary: sort(frame.domainVocabulary),
  };
}

/** Deterministic identity for the source content and sanitized frame. */
function computeHydeFrameFingerprint(sourceText: string, sourceFrame: HydeSourceFrame): string {
  return computeHydeSourceTextHash(`${sourceText}\0${JSON.stringify(sortedFrame(sourceFrame))}`);
}

function requireFrameFingerprint(frameFingerprint: string | undefined): string {
  if (!frameFingerprint) throw new Error('frame-v1 HyDE requires a frame fingerprint');
  return frameFingerprint;
}

/** Namespaced frame-v1 cache key. */
function cacheKey(
  sourceType: string,
  sourceId: string | undefined,
  sourceText: string,
  lens: string,
  corpus: string | undefined,
  frameFingerprint: string,
): string {
  const entityKey = entityCacheKey(sourceId, sourceText);
  return `hyde:${HYDE_FRAME_GENERATION_VERSION}:${sourceType}:${entityKey}:${frameFingerprint}:${lensHash(lens, corpus)}`;
}

/** Stable frame-v1 identity per lens/corpus. */
function dbStrategy(label: string, corpus?: string): string {
  return `${HYDE_FRAME_GENERATION_VERSION}:${lensHash(label, corpus)}`;
}

function isValidGenerationMarker(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function isFrameCacheDocument(
  doc: HydeDocumentState,
  lensLabel: string,
  frameFingerprint: string,
  sourceTextHash: string,
): boolean {
  return doc.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && doc.validationStatus === 'valid'
    && doc.lens === lensLabel
    && doc.frameFingerprint === frameFingerprint
    && doc.sourceTextHash === sourceTextHash
    && isValidGenerationMarker(doc.generatedAt);
}

interface FrameDbContext extends Record<string, unknown> {
  hydeGenerationVersion: typeof HYDE_FRAME_GENERATION_VERSION;
  lensLabel: string;
  validationStatus: 'valid';
  frameFingerprint: string;
  sourceTextHash: string;
  generatedAt: string;
}

function isFrameDbContext(
  context: Record<string, unknown> | null,
  lensLabel: string,
  frameFingerprint: string,
  sourceTextHash: string,
): context is FrameDbContext {
  return context?.hydeGenerationVersion === HYDE_FRAME_GENERATION_VERSION
    && context.lensLabel === lensLabel
    && context.validationStatus === 'valid'
    && context.frameFingerprint === frameFingerprint
    && context.sourceTextHash === sourceTextHash
    && isValidGenerationMarker(context.generatedAt);
}

function emptyFrame(): HydeSourceFrame {
  return {
    sourceRoles: [],
    counterpartRoles: [],
    hardConstraints: [],
    namedEntities: [],
    domainVocabulary: [],
  };
}

function opaqueDocumentKey(doc: HydeDocumentState): string {
  return `d-${computeHydeSourceTextHash(`${doc.lens}\0${doc.targetCorpus}\0${doc.hydeText}`).slice(0, 16)}`;
}

function isRuntimeVerdict(value: unknown): value is HydeValidationVerdict {
  if (!value || typeof value !== 'object') return false;
  const verdict = value as Partial<HydeValidationVerdict>;
  return typeof verdict.key === 'string'
    && typeof verdict.valid === 'boolean'
    && Array.isArray(verdict.unsupportedNamedEntities)
    && verdict.unsupportedNamedEntities.every((item) => typeof item === 'string')
    && Array.isArray(verdict.unsupportedHardConstraints)
    && verdict.unsupportedHardConstraints.every((item) => typeof item === 'string')
    && typeof verdict.reasoning === 'string';
}

export interface ArtifactDeps {
  database: ArtifactStore;
  embedder: EmbeddingGenerator;
  cache: ArtifactCache;
  inferrer: HydeLensInferrerLike;
  generator: HydeGeneratorLike;
  validator: HydeValidatorLike;
}

/** Prepare validated retrieval artifacts, reusing only the matching source/frame cohort. */
export async function prepareArtifacts(input: ArtifactInput, deps: ArtifactDeps): Promise<HydeState> {
  const state: HydeState = {
    ...input, maxLenses: input.maxLenses ?? 3, forceRegenerate: input.forceRegenerate ?? false,
    lenses: [], hydeDocuments: {}, hydeEmbeddings: {}, agentTimings: [],
  };
  const apply = async (step: (state: HydeState, deps: ArtifactDeps) => Promise<Partial<HydeState>>) => {
    getAbortSignalConfig().signal?.throwIfAborted();
    const result = await step(state, deps);
    const timings = [...state.agentTimings, ...(result.agentTimings ?? [])];
    Object.assign(state, result, { agentTimings: timings });
    getAbortSignalConfig().signal?.throwIfAborted();
  };
  await apply(inferLensesNode);
  await apply(checkCacheNode);
  if (state.lenses.some(lens => !state.hydeDocuments[lens.label])) {
    await apply(generateMissingNode);
    await apply(validateGeneratedNode);
  }
  await apply(embedNode);
  await apply(cacheResultsNode);
  return state;
}

/** Node 1: Infer lenses from source text + optional profile context. */
export async function inferLensesNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.inferLenses", async () => {
    const { sourceText, profileContext, maxLenses } = state;
    const agentTimingsAccum: AgentTiming[] = [];

    try {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const inferrerStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: "lens-inferrer" });
      const result = await deps.inferrer.infer({
        sourceText,
        profileContext,
        maxLenses,
      });
      const durationMs = Date.now() - inferrerStart;
      agentTimingsAccum.push({ name: 'lens.inferrer', durationMs });
      traceEmitter?.({ type: "agent_end", name: "lens-inferrer", durationMs, summary: result.lenses.length > 0 ? `Inferred ${result.lenses.length} lens(es)` : "lens-inferrer completed" });

      const sourceFrame = sanitizeHydeSourceFrame(sourceText, result.sourceFrame ?? emptyFrame());
      return {
        lenses: result.lenses,
        sourceFrame,
        frameFingerprint: computeHydeFrameFingerprint(sourceText, sourceFrame),
        sourceTextHash: computeHydeSourceTextHash(sourceText),
        generatedAt: nextGenerationMarker(),
        agentTimings: agentTimingsAccum,
      };
    } catch (error) {
      artifactLogger.error('Lens inference failed in graph node', { error });
      const sourceFrame = emptyFrame();
      return {
        lenses: [],
        sourceFrame,
        frameFingerprint: computeHydeFrameFingerprint(sourceText, sourceFrame),
        sourceTextHash: computeHydeSourceTextHash(sourceText),
        generatedAt: nextGenerationMarker(),
        agentTimings: agentTimingsAccum,
      };
    }
  });
}

/** Node 2: Check the frame-isolated cache/DB for matching documents. */
export async function checkCacheNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.checkCache", async () => {
    const { sourceType, sourceId, sourceText, lenses, forceRegenerate } = state;

    if (forceRegenerate) return { hydeDocuments: {} };

    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    const cached: Record<string, HydeDocumentState> = {};
    for (const lens of lenses) {
      const key = cacheKey(
        sourceType,
        sourceId ?? undefined,
        sourceText,
        lens.label,
        lens.corpus,
        frameFingerprint,
      );
      const fromCache = await deps.cache.get<HydeDocumentState>(key);
      const cacheAccepted = fromCache?.hydeText
        && fromCache.hydeEmbedding?.length
        && isFrameCacheDocument(fromCache, lens.label, frameFingerprint, sourceTextHash);
      if (cacheAccepted && fromCache) {
        cached[lens.label] = {
          ...fromCache,
          origin: 'cache' as const,
        };
        continue;
      }

      if (sourceId) {
        const fromDb = await deps.database.getHydeDocument(
          sourceType,
          sourceId,
          dbStrategy(lens.label, lens.corpus),
        );
        const frameDbContext = fromDb ? fromDb.context : null;
        if (fromDb && isFrameDbContext(frameDbContext, lens.label, frameFingerprint, sourceTextHash)) {
          cached[lens.label] = {
            lens: lens.label,
            targetCorpus: fromDb.targetCorpus as HydeDocumentState['targetCorpus'],
            hydeText: fromDb.hydeText,
            hydeEmbedding: fromDb.hydeEmbedding,
            origin: 'db' as const,
            validationStatus: 'valid' as const,
            hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
            frameFingerprint,
            sourceTextHash,
            generatedAt: (frameDbContext as FrameDbContext).generatedAt,
          };
        }
      }
    }

    const newestTimestamp = Math.max(
      ...Object.values(cached).map((doc) => Date.parse(doc.generatedAt ?? '')),
    );
    if (Number.isFinite(newestTimestamp)) {
      return {
        hydeDocuments: Object.fromEntries(Object.entries(cached).filter(([, doc]) =>
          Date.parse(doc.generatedAt ?? '') === newestTimestamp)),
      };
    }

    return { hydeDocuments: cached };
  });
}

/** Node 3: Generate all missing documents and return a complete snapshot. */
export async function generateMissingNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.generateMissing", async () => {
    const { sourceText, sourceFrame, lenses, hydeDocuments } = state;
    const missing = lenses.filter((lens) => !hydeDocuments[lens.label]);
    const agentTimingsAccum: AgentTiming[] = [];
    const generated: Record<string, HydeDocumentState> = {};
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    const generatedAt = state.generatedAt ?? nextGenerationMarker();
    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);

    await Promise.all(missing.map(async (lens) => {
      const traceEmitter = requestContext.getStore()?.traceEmitter;
      const generatorStart = Date.now();
      traceEmitter?.({ type: "agent_start", name: "hyde-generator" });
      const out = await deps.generator.generate({
        sourceText,
        lens: lens.label,
        corpus: lens.corpus,
        sourceFrame: sourceFrame ?? emptyFrame(),
      });
      const durationMs = Date.now() - generatorStart;
      agentTimingsAccum.push({ name: 'hyde.generator', durationMs });
      traceEmitter?.({ type: "agent_end", name: "hyde-generator", durationMs, summary: `Generated: ${lens.label}` });
      generated[lens.label] = {
        lens: lens.label,
        targetCorpus: lens.corpus,
        hydeText: out.text,
        hydeEmbedding: [],
        origin: 'generated' as const,
        frameFingerprint,
        sourceTextHash,
        generatedAt,
      };
    }));

    const retained = Object.fromEntries(Object.entries(hydeDocuments).map(([label, doc]) => [
      label,
      {
        ...doc,
        frameFingerprint,
        sourceTextHash,
        generatedAt,
      },
    ]));

    return { hydeDocuments: { ...retained, ...generated }, agentTimings: agentTimingsAccum };
  });
}

/** Validate newly generated docs in one batch. */
export async function validateGeneratedNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.validateGenerated", async () => {
    const generated = Object.values(state.hydeDocuments).filter((doc) => doc.origin === 'generated');
    if (generated.length === 0 || !deps.validator) return { hydeDocuments: state.hydeDocuments };

    const frame = sanitizeHydeSourceFrame(state.sourceText, state.sourceFrame ?? emptyFrame());
    const documents: HydeValidationInput['documents'] = {};
    const lensByDocumentKey = new Map<string, string>();
    for (const doc of generated) {
      const key = opaqueDocumentKey(doc);
      documents[key] = { corpus: doc.targetCorpus, text: doc.hydeText };
      lensByDocumentKey.set(key, doc.lens);
    }

    const updated = { ...state.hydeDocuments };
    const agentTimingsAccum: AgentTiming[] = [];
    const traceEmitter = requestContext.getStore()?.traceEmitter;
    const validatorStart = Date.now();
    let validCount = 0;
    let rejectedCount = 0;
    let failedOpenCount = 0;
    traceEmitter?.({ type: 'agent_start', name: 'hyde-validator' });

    try {
      const output = await deps.validator.validate({
        sourceText: state.sourceText,
        sourceFrame: frame,
        documents,
      });
      const rawVerdicts: unknown[] = Array.isArray((output as { verdicts?: unknown }).verdicts)
        ? (output as { verdicts: unknown[] }).verdicts
        : [];

      for (const key of Object.keys(documents)) {
        const lensLabel = lensByDocumentKey.get(key);
        if (!lensLabel) continue;
        const matching = rawVerdicts.filter((value) =>
          !!value && typeof value === 'object' && (value as { key?: unknown }).key === key);
        const doc = updated[lensLabel];
        if (!doc) continue;

        if (matching.length !== 1 || !isRuntimeVerdict(matching[0])) {
          failedOpenCount += 1;
          updated[lensLabel] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
          continue;
        }

        const verdict = matching[0];
        const hasUnsupportedGrounding = verdict.unsupportedNamedEntities.length > 0
          || verdict.unsupportedHardConstraints.length > 0;
        const contradictory = verdict.valid === hasUnsupportedGrounding;
        if (contradictory) {
          failedOpenCount += 1;
          updated[lensLabel] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
        } else if (!verdict.valid) {
          rejectedCount += 1;
          delete updated[lensLabel];
        } else {
          validCount += 1;
          updated[lensLabel] = { ...doc, validationStatus: 'valid', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
        }
      }
    } catch (error) {
      artifactLogger.error('HyDE validation failed open', { error });
      validCount = 0;
      rejectedCount = 0;
      failedOpenCount = generated.length;
      for (const doc of generated) {
        updated[doc.lens] = { ...doc, validationStatus: 'failed_open', hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION };
      }
    } finally {
      const durationMs = Date.now() - validatorStart;
      agentTimingsAccum.push({ name: 'hyde.validator', durationMs });
      traceEmitter?.({
        type: 'agent_end',
        name: 'hyde-validator',
        durationMs,
        summary: `${validCount} valid, ${rejectedCount} rejected, ${failedOpenCount} failed open`,
      });
    }

    return { hydeDocuments: updated, agentTimings: agentTimingsAccum };
  });
}

/** Embed all accepted/cached documents that do not have embeddings. */
export async function embedNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.embed", async () => {
    const toEmbed: { label: string; doc: HydeDocumentState }[] = [];
    const updated: Record<string, HydeDocumentState> = {};
    const hydeEmbeddings: Record<string, number[]> = {};

    for (const [label, doc] of Object.entries(state.hydeDocuments)) {
      if (doc.hydeEmbedding?.length) {
        updated[label] = doc;
        hydeEmbeddings[label] = doc.hydeEmbedding;
      } else {
        toEmbed.push({ label, doc });
      }
    }

    if (toEmbed.length > 0) {
      const embeddings = await deps.embedder.generate(
        toEmbed.map((item) => item.doc.hydeText),
        undefined,
        getAbortSignalConfig(),
      );
      const embeddingArray = Array.isArray(embeddings[0]) ? embeddings as number[][] : [embeddings as number[]];
      for (let i = 0; i < toEmbed.length; i++) {
        const { label, doc } = toEmbed[i]!;
        const embedding = embeddingArray[i] ?? [];
        updated[label] = { ...doc, hydeEmbedding: embedding };
        hydeEmbeddings[label] = embedding;
      }
    }

    return { hydeDocuments: updated, hydeEmbeddings };
  });
}

/** Cache/persist only successfully validated frame-v1 docs. */
export async function cacheResultsNode(state: HydeState, deps: ArtifactDeps) {
  return timed("HydeGraph.cacheResults", async () => {
    const { sourceType, sourceId, sourceText, hydeDocuments } = state;
    const frameFingerprint = requireFrameFingerprint(state.frameFingerprint);
    const sourceTextHash = state.sourceTextHash ?? computeHydeSourceTextHash(sourceText);
    await Promise.all(Object.entries(hydeDocuments).map(async ([label, doc]) => {
      if (!isFrameCacheDocument(doc, label, frameFingerprint, sourceTextHash)) return;

      const key = cacheKey(
        sourceType,
        sourceId ?? undefined,
        sourceText,
        label,
        doc.targetCorpus,
        frameFingerprint,
      );
      await deps.cache.set(key, doc, { ttl: HYDE_DEFAULT_CACHE_TTL });

      if (sourceId) {
        await deps.database.saveHydeDocument({
          sourceType,
          sourceId,
          strategy: dbStrategy(label, doc.targetCorpus),
          targetCorpus: doc.targetCorpus,
          hydeText: doc.hydeText,
          hydeEmbedding: doc.hydeEmbedding,
          context: {
            hydeGenerationVersion: HYDE_FRAME_GENERATION_VERSION,
            lensLabel: label,
            validationStatus: 'valid',
            frameFingerprint: doc.frameFingerprint,
            sourceTextHash: doc.sourceTextHash,
            generatedAt: doc.generatedAt,
          },
        });
      }
    }));
    return {};
  });
}
