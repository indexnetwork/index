import type { ResolvedToolContext } from "../agent/tool.helpers.js";

// ═══════════════════════════════════════════════════════════════════════════════
// Enrichment run persistence + queue
//
// Mirrors the discovery-run contract for the enrichment pipeline (profile/context
// preview + update). See discovery-run.interface.ts for the shared lifecycle rules.
//
// Port contract (host application implements `EnrichmentRunStore` + `EnrichmentRunQueue`):
//   • Status lifecycle queued → running → (succeeded | failed | cancelled); `mark*`
//     transitions are idempotent.
//   • `get` / `requestCancel` are owner-scoped and return `null` for missing or
//     non-owned runs.
//   • `listActive` returns queued/running runs (empty array, never null).
//   • Legacy `*_user_profile` operations are read-compat only — never written by new code.
// ═══════════════════════════════════════════════════════════════════════════════

export type EnrichmentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
// Canonical run operations are the *_user_context names (IND-371). The legacy
// *_user_profile values are retained so historical run rows persisted before the
// rename still type-check; nothing new writes them.
export type EnrichmentRunOperation =
  | "preview_user_context"
  | "update_user_context"
  | "preview_user_profile"
  | "update_user_profile";

export interface PreviewUserEnrichmentRunInput {
  name?: string;
  location?: string;
  bioOrDescription?: string;
  edgeosProfileText?: string;
  allowPublicLookup?: boolean;
  linkedinUrl?: string;
  githubUrl?: string;
  twitterUrl?: string;
  websites?: string[];
}

export interface UpdateUserEnrichmentRunInput {
  profileId?: string;
  action?: string;
  details?: string;
  socials?: Record<string, string>;
}

export type EnrichmentRunInput = PreviewUserEnrichmentRunInput | UpdateUserEnrichmentRunInput;

export interface EnrichmentRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  operation: EnrichmentRunOperation;
  status: EnrichmentRunStatus;
  input: EnrichmentRunInput;
  context: Pick<ResolvedToolContext,
    "userId" |
    "userName" |
    "userEmail" |
    "scopeType" |
    "scopeId" |
    "indexName" |
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

export interface CreateEnrichmentRunInput {
  userId: string;
  agentId?: string | null;
  operation: EnrichmentRunOperation;
  input: EnrichmentRunInput;
  context: EnrichmentRunRecord["context"];
  expiresAt?: Date;
}

export interface EnrichmentRunStore {
  create(input: CreateEnrichmentRunInput): Promise<EnrichmentRunRecord>;
  get(runId: string, userId: string): Promise<EnrichmentRunRecord | null>;
  markRunning(runId: string): Promise<EnrichmentRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<EnrichmentRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<EnrichmentRunRecord[]>;
}

export interface EnrichmentRunQueue {
  enqueue(runId: string): Promise<{ jobId?: string | number } | void>;
  cancel(runId: string): Promise<boolean>;
}
