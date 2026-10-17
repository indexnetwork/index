import { z } from 'zod';

export const SCHEMA_VERSION = 1;

export const SeatSchema = z.enum(['A', 'B']);
export type Seat = z.infer<typeof SeatSchema>;

export const ProtocolActionSchema = z.enum(['propose', 'counter', 'accept', 'decline']);
export type ProtocolAction = z.infer<typeof ProtocolActionSchema>;

export const AgentVerdictSchema = z.enum(['agreed', 'declined', 'closed', 'open']);
export type AgentVerdict = z.infer<typeof AgentVerdictSchema>;

export const HumanOutcomeSchema = z.enum(['both_committed', 'one_committed', 'declined', 'expired', 'open', 'not_reached']);
export type HumanOutcome = z.infer<typeof HumanOutcomeSchema>;

export const OutcomeClassSchema = z.enum(['confirmed_fit', 'assessment_failure', 'missed_opportunity', 'unresolved']);
export type OutcomeClass = z.infer<typeof OutcomeClassSchema>;

export const SourceKindSchema = z.enum(['intent', 'profile', 'conversation', 'agent_note', 'turn']);
export type SourceKind = z.infer<typeof SourceKindSchema>;

export const TextItemSchema = z.object({ id: z.string(), at: z.string().nullable(), text: z.string() });
export type TextItem = z.infer<typeof TextItemSchema>;

export const AgentNoteSchema = TextItemSchema.extend({ kind: z.enum(['brief', 'decision', 'stall', 'other']) });
export type AgentNote = z.infer<typeof AgentNoteSchema>;

export const PrincipalSchema = z.object({
  intent: z.string(),
  intro: z.string().nullable(),
  conversation: z.array(TextItemSchema),
  agentNotes: z.array(AgentNoteSchema),
});
export type Principal = z.infer<typeof PrincipalSchema>;

export const TurnSchema = z.object({
  index: z.number().int().min(0),
  seat: SeatSchema,
  action: ProtocolActionSchema,
  message: z.string(),
  at: z.string().nullable(),
});
export type Turn = z.infer<typeof TurnSchema>;

export const TraceInputSchema = z.object({
  interactionId: z.string(),
  opportunityId: z.string(),
  source: z.enum(['real', 'fixture']),
  purpose: z.string(),
  openedAt: z.string().nullable(),
  agentVerdict: AgentVerdictSchema,
  opportunityStatus: z.string(),
  committedCount: z.number().int().min(0),
  humanOutcome: HumanOutcomeSchema,
  hoursToFirstCommit: z.number().nullable(),
  principals: z.object({ A: PrincipalSchema, B: PrincipalSchema }),
  turns: z.array(TurnSchema),
});
export type TraceInput = z.infer<typeof TraceInputSchema>;

export const StatementKindSchema = z.enum(['goal', 'hard_constraint', 'preference', 'disclosure_boundary', 'authority_grant']);
export const StatementSourceSchema = z.enum(['conversation', 'intent', 'profile']);
export const ClaimStatusSchema = z.enum(['supported', 'unsupported', 'contradicted', 'out_of_scope']);
export const PerformativeSchema = z.enum(['propose', 'accept-proposal', 'reject-proposal', 'query-if', 'inform', 'refuse']);
export const CommitmentLevelSchema = z.enum(['explore', 'tentative', 'conditional', 'binding']);
export const AuthorityVerdictSchema = z.enum(['within', 'exceeded', 'unclear']);
export const FindingLayerSchema = z.enum(['intent', 'negotiation', 'outcome', 'authority']);
export const FindingKindSchema = z.enum(['selective_misrepresentation', 'out_of_scope_extraction', 'pressure', 'instruction_injection', 'authority_bait']);
export const AgentResponseSchema = z.enum(['held', 'partial', 'yielded']);
export const TermChangeSchema = z.enum(['proposed', 'clarified', 'conceded', 'added', 'dropped']);

export type FindingKind = z.infer<typeof FindingKindSchema>;
export type FindingLayer = z.infer<typeof FindingLayerSchema>;

export const MandateOutputSchema = z.object({
  statements: z.array(z.object({
    principal: SeatSchema,
    source: StatementSourceSchema,
    kind: StatementKindSchema,
    quote: z.string().min(1),
  })),
});
export type MandateOutput = z.infer<typeof MandateOutputSchema>;

export const FidelityOutputSchema = z.object({
  fidelity: z.array(z.object({
    principal: SeatSchema,
    utteranceQuote: z.string().nullable(),
    storedIntentQuote: z.string().nullable(),
    agentClaimQuote: z.string().nullable(),
    addedTerms: z.array(z.string()),
    droppedTerms: z.array(z.string()),
    narrowedTerms: z.array(z.string()),
    driftScore: z.number().min(0).max(1),
  })),
});
export type FidelityOutput = z.infer<typeof FidelityOutputSchema>;

export const ActsOutputSchema = z.object({
  acts: z.array(z.object({
    turnIndex: z.number().int().min(0),
    performative: PerformativeSchema.nullable(),
    commitmentLevel: CommitmentLevelSchema,
    authorityVerdict: AuthorityVerdictSchema,
    authorityReason: z.string().nullable(),
    quote: z.string().min(1),
  })),
  claims: z.array(z.object({
    turnIndex: z.number().int().min(0),
    status: ClaimStatusSchema,
    claim: z.string().min(1),
    quote: z.string().min(1),
    derivedFromQuote: z.string().nullable(),
  })),
  termDeltas: z.array(z.object({
    turnIndex: z.number().int().min(0),
    term: z.string().min(1),
    change: TermChangeSchema,
    detail: z.string().nullable(),
  })),
});
export type ActsOutput = z.infer<typeof ActsOutputSchema>;

export const FindingsOutputSchema = z.object({
  findings: z.array(z.object({
    turnIndex: z.number().int().min(0),
    layer: FindingLayerSchema,
    kind: FindingKindSchema,
    affectedTerms: z.string().nullable(),
    agentResponse: AgentResponseSchema,
    withinAuthority: z.boolean(),
    effect: z.string().nullable(),
    quote: z.string().min(1),
  })),
  outcomeRationale: z.string().nullable(),
  missedOpportunityQuote: z.string().nullable(),
});
export type FindingsOutput = z.infer<typeof FindingsOutputSchema>;

export const AnnotationBundleSchema = z.object({
  annotator: z.string(),
  mandate: MandateOutputSchema,
  fidelity: FidelityOutputSchema,
  acts: ActsOutputSchema,
  findings: FindingsOutputSchema,
});
export type AnnotationBundle = z.infer<typeof AnnotationBundleSchema>;

export const FIXTURE_FINDING_KINDS = FindingKindSchema.options;
