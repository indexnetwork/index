import type { PremiseAnalysis, PremiseProvenance, PremiseRecord } from "../../platform/database.js";
import type { DebugMetaAgent } from "../../protocol/core.js";
import type { ToolScopeType } from '../shared/agent/tool.scope.js';

export interface PremiseState {
  userId: string;
  assertionText: string | undefined;
  tier: 'assertive' | 'contextual';
  validFrom: string | undefined;
  validUntil: string | undefined;
  volatile: boolean;
  provenanceSource: PremiseProvenance['source'] | undefined;
  provenanceSourceId: string | undefined;
  provenanceConfidence: number | undefined;
  operationMode: 'create' | 'update' | 'query' | 'decompose';
  /** Free text to decompose into premises (decompose mode only). */
  input: string | undefined;
  /** Focused request scope type for assignment writes. */
  scopeType: ToolScopeType | undefined;
  /** Focused request scope id. When scopeType is `network`, this is the focused network id. */
  scopeId: string | undefined;
  /** @deprecated Use scopeType/scopeId. Retained temporarily for older enqueue handlers. */
  networkScopeId: string | undefined;
  targetPremiseId: string | undefined;
  analysis: PremiseAnalysis | undefined;
  embedding: number[] | undefined;
  premise: PremiseRecord | undefined;
  duplicateOf: { premiseId: string; assertionText: string; similarity: number } | undefined;
  networkAssignments: Array<{ networkId: string; relevancyScore: number }>;
  error: string | undefined;
  readResult: {
    premises: PremiseRecord[];
    count: number;
    message?: string;
  } | undefined;
  agentTimings: DebugMetaAgent[];
}

export function premiseDefaults(): PremiseState {
  return {
    userId: "",
    assertionText: undefined,
    tier: 'assertive',
    validFrom: undefined,
    validUntil: undefined,
    volatile: false,
    provenanceSource: undefined,
    provenanceSourceId: undefined,
    provenanceConfidence: undefined,
    operationMode: 'create',
    input: undefined,
    scopeType: undefined,
    scopeId: undefined,
    networkScopeId: undefined,
    targetPremiseId: undefined,
    analysis: undefined,
    embedding: undefined,
    premise: undefined,
    duplicateOf: undefined,
    networkAssignments: [],
    error: undefined,
    readResult: undefined,
    agentTimings: [],
  };
}

