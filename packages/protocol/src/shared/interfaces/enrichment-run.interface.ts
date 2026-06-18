import type { ResolvedToolContext } from "../agent/tool.helpers.js";

export type EnrichmentRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type EnrichmentRunOperation = "preview_user_profile" | "update_user_profile";

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
    "networkId" |
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
