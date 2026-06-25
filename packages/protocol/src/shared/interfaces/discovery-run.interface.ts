import type { ResolvedToolContext } from "../agent/tool.helpers.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Discovery run persistence + queue
//
// Models an async `discover_opportunities` job as a durable, owner-scoped record.
//
// Port contract (host application implements `DiscoveryRunStore` + `DiscoveryRunQueue`):
//   • Status is a one-way lifecycle: queued → running → (succeeded | failed | cancelled).
//     The `mark*` transitions must be idempotent — re-applying a terminal state is a no-op.
//   • Every read is owner-scoped: `get` and `requestCancel` take `userId` and MUST
//     return `null` when the run is missing or owned by another user (no cross-user reads).
//   • `isCancelRequested` is polled cooperatively by the running graph; the store sets
//     the flag via `requestCancel`, the worker observes it and calls `markCancelled`.
//   • `listActive` returns queued/running runs only (used to coalesce duplicate
//     discovery requests) — empty array, never null.
//   • `DiscoveryRunQueue.cancel` returns `true` if a pending job was removed, `false`
//     if nothing was queued (already running/finished).
// ═══════════════════════════════════════════════════════════════════════════════

export type DiscoveryRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";

export interface DiscoveryRunInput {
  continueFrom?: string;
  searchQuery?: string;
  networkId?: string;
  intentId?: string;
  targetUserId?: string;
  introTargetUserId?: string;
  partyUserIds?: string[];
  entities?: Array<{
    userId: string;
    profile?: {
      name?: string;
      bio?: string;
      location?: string;
      interests?: string[];
      skills?: string[];
      context?: string;
    };
    intents?: Array<{
      intentId: string;
      payload: string;
      summary?: string;
    }>;
    networkId: string;
  }>;
  hint?: string;
}

export interface DiscoveryRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  status: DiscoveryRunStatus;
  input: DiscoveryRunInput;
  context: Pick<ResolvedToolContext,
    "userId" |
    "userName" |
    "userEmail" |
    "networkId" |
    "scopeType" |
    "scopeId" |
    "indexName" |
    "indexScope" |
    "sessionId" |
    "agentId" |
    "clientSurface"
  >;
  progress?: Record<string, unknown> | null;
  result?: unknown;
  error?: string | null;
  cancelRequestedAt?: Date | null;
  createdAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  expiresAt?: Date | null;
}

export interface CreateDiscoveryRunInput {
  userId: string;
  agentId?: string | null;
  input: DiscoveryRunInput;
  context: DiscoveryRunRecord["context"];
  expiresAt?: Date;
}

export interface DiscoveryRunStore {
  create(input: CreateDiscoveryRunInput): Promise<DiscoveryRunRecord>;
  get(runId: string, userId: string): Promise<DiscoveryRunRecord | null>;
  markRunning(runId: string): Promise<DiscoveryRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<DiscoveryRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<DiscoveryRunRecord[]>;
}

export interface DiscoveryRunQueue {
  enqueue(runId: string): Promise<{ jobId?: string | number } | void>;
  cancel(runId: string): Promise<boolean>;
}
