import { Annotation } from "@langchain/langgraph";
import type { PremiseAnalysis, PremiseRecord } from "../shared/interfaces/database.interface.js";
import type { DebugMetaAgent } from '../chat/chat-streaming.types.js';

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

  operationMode: Annotation<'create' | 'update' | 'query'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'create',
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
