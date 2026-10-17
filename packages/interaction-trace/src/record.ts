import type { AgentVerdict, HumanOutcome, OutcomeClass, Seat } from './schema.ts';

export interface InteractionRow {
  id: string;
  opportunityId: string;
  source: 'real' | 'fixture';
  purpose: string;
  agentVerdict: AgentVerdict;
  turnCount: number;
  openedAt: string | null;
  annotator: string;
  schemaVersion: number;
}

export interface StatementRow {
  principal: Seat;
  source: 'conversation' | 'intent' | 'profile';
  kind: string;
  quote: string;
}

export interface FidelityRow {
  principal: Seat;
  utteranceQuote: string | null;
  storedIntentQuote: string | null;
  agentClaimQuote: string | null;
  addedTerms: string[];
  droppedTerms: string[];
  narrowedTerms: string[];
  driftScore: number;
}

export interface TurnActRow {
  turnIndex: number;
  seat: Seat;
  protocolAction: string;
  performative: string;
  commitmentLevel: string;
  authorityVerdict: string;
  authorityReason: string | null;
  quote: string;
  annotated: boolean;
}

export interface ClaimRow {
  turnIndex: number;
  seat: Seat;
  statementIndex: number | null;
  status: string;
  claim: string;
  quote: string;
}

export interface TermDeltaRow {
  turnIndex: number;
  seat: Seat;
  term: string;
  change: string;
  detail: string | null;
}

export interface FindingRow {
  turnIndex: number;
  layer: string;
  kind: string;
  owaspRef: string;
  atlasRef: string | null;
  affectedTerms: string | null;
  agentResponse: string;
  withinAuthority: boolean;
  effect: string | null;
  quote: string;
}

export interface OutcomeRow {
  agentVerdict: AgentVerdict;
  humanOutcome: HumanOutcome;
  outcomeClass: OutcomeClass;
  causeFindingIndex: number | null;
  rationale: string | null;
  hoursToFirstCommit: number | null;
}

export interface DroppedAnnotation {
  layer: string;
  reason: string;
  quote: string | null;
}

export interface TraceRecord {
  interaction: InteractionRow;
  statements: StatementRow[];
  fidelity: FidelityRow[];
  turnActs: TurnActRow[];
  claims: ClaimRow[];
  termDeltas: TermDeltaRow[];
  findings: FindingRow[];
  outcome: OutcomeRow;
  dropped: DroppedAnnotation[];
  emitted: Record<string, number>;
}
