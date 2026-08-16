import { Annotation } from '@langchain/langgraph';
import type { Opportunity } from '../shared/interfaces/database.interface.js';
import type { RadarHealthResult } from '../opportunities/radar/radar.health.js';

/**
 * Maintenance Graph State (Annotation-based).
 * Flow: loadCurrentRadar → scoreRadarHealth → [conditional: rediscover | END] → logMaintenance → END
 */
export const MaintenanceGraphState = Annotation.Root({
  userId: Annotation<string>({
    reducer: (curr, next) => next ?? curr,
    default: () => '',
  }),

  /** Active intents for the user (used for rediscovery). */
  activeIntents: Annotation<Array<{ id: string; payload: string }>>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Current actionable opportunities for the user. */
  currentOpportunities: Annotation<Opportunity[]>({
    reducer: (curr, next) => next ?? curr,
    default: () => [],
  }),

  /** Current expired opportunities count. */
  expiredCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /** Unix ms timestamp of last rediscovery for this user. */
  lastRediscoveryAt: Annotation<number | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** Radar health score result. */
  healthResult: Annotation<RadarHealthResult | null>({
    reducer: (curr, next) => next ?? curr,
    default: () => null,
  }),

  /** Number of rediscovery jobs enqueued. */
  rediscoveryJobsEnqueued: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /** Current connector-flow opportunity count (from scoreRadarHealth). */
  connectorFlowCount: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  /** Number of introducer discovery jobs enqueued. */
  introducerDiscoveryJobsEnqueued: Annotation<number>({
    reducer: (curr, next) => next ?? curr,
    default: () => 0,
  }),

  error: Annotation<string | undefined>({
    reducer: (curr, next) => next ?? curr,
    default: () => undefined,
  }),
});
