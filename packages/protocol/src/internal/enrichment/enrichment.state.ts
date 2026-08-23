import { Annotation } from "@langchain/langgraph";
import type { UserIdentity } from "../../protocol/schemas/identity.schema.js";
import type { DebugMetaAgent } from "../../protocol/core.js";

/**
 * The Graph State for Profile Query.
 *
 * Query-only: reports whether the user has an enriched profile (ACTIVE
 * premises exist) and returns the users-sourced identity fields. Premise
 * decomposition (text → premises) lives on `PremiseGraphFactory`'s
 * `decompose` operation mode.
 */
export const EnrichmentGraphState = Annotation.Root({
  /**
   * The User ID to look up.
   */
  userId: Annotation<string>,

  operationMode: Annotation<'query'>({
    reducer: (curr, next) => next ?? curr,
    default: () => 'query',
  }),

  /**
   * The loaded profile document.
   */
  profile: Annotation<UserIdentity | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /**
   * Error message if any step fails (non-fatal).
   */
  error: Annotation<string | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),

  /** Timing records for each agent invocation within this graph run. */
  agentTimings: Annotation<DebugMetaAgent[]>({
    reducer: (acc, val) => [...acc, ...val],
    default: () => [],
  }),

  /**
   * Structured result for the tool to read.
   */
  readResult: Annotation<{
    hasProfile: boolean;
    profile?: {
      id?: string;
      name: string;
      bio: string;
      location: string;
    };
    message?: string;
  } | undefined>({
    reducer: (curr, next) => next,
    default: () => undefined,
  }),
});
