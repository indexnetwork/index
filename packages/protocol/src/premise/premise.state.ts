import { Annotation } from "@langchain/langgraph";
import type { PremiseAnalysis, PremiseProvenance, PremiseRecord } from "../shared/interfaces/database.interface.js";
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';
import type { ToolScopeType } from '../shared/agent/tool.scope.js';

export const PremiseGraphState = Annotation.Root({
  userId: Annotation<string>,

  assertionText: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  tier: Annotation<'assertive' | 'contextual'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'assertive',
  }),

  validFrom: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  validUntil: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  volatile: Annotation<boolean>({
    reducer: (curr, next) => next ?? curr,
    default: () => false,
  }),

  provenanceSource: Annotation<PremiseProvenance['source'] | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  provenanceSourceId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  provenanceConfidence: Annotation<number | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  operationMode: Annotation<'create' | 'update' | 'query'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create',
  }),

  /** Focused request scope type for assignment writes. */
  scopeType: Annotation<ToolScopeType | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** Focused request scope id. When scopeType is `network`, this is the focused network id. */
  scopeId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  /** @deprecated Use scopeType/scopeId. Retained temporarily for older enqueue handlers. */
  networkScopeId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  targetPremiseId: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  analysis: Annotation<PremiseAnalysis | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  embedding: Annotation<number[] | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  premise: Annotation<PremiseRecord | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  // Set by the dedupe node when a near-duplicate ACTIVE premise already exists for
  // the user (create mode only). When present, persist/index are skipped — the
  // candidate is treated as already represented by `duplicateOf`.
  duplicateOf: Annotation<{ premiseId: string; assertionText: string; similarity: number } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  networkAssignments: Annotation<Array<{ networkId: string; relevancyScore: number }>>({
    reducer: (curr, next) => next,
    default: () => [],
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),

  readResult: Annotation<{
    premises: PremiseRecord[];
    count: number;
    message?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),
});
