import type { ResolvedToolContext } from "../agent/tool.helpers.js";

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
