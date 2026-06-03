import type { ResolvedToolContext } from "../agent/tool.helpers.js";

export type ProfileRunStatus = "queued" | "running" | "succeeded" | "failed" | "cancelled";
export type ProfileRunOperation = "preview_user_profile" | "update_user_profile";

export interface PreviewUserProfileRunInput {
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

export interface UpdateUserProfileRunInput {
  profileId?: string;
  action?: string;
  details?: string;
  socials?: Record<string, string>;
}

export type ProfileRunInput = PreviewUserProfileRunInput | UpdateUserProfileRunInput;

export interface ProfileRunRecord {
  id: string;
  userId: string;
  agentId?: string | null;
  operation: ProfileRunOperation;
  status: ProfileRunStatus;
  input: ProfileRunInput;
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

export interface CreateProfileRunInput {
  userId: string;
  agentId?: string | null;
  operation: ProfileRunOperation;
  input: ProfileRunInput;
  context: ProfileRunRecord["context"];
  expiresAt?: Date;
}

export interface ProfileRunStore {
  create(input: CreateProfileRunInput): Promise<ProfileRunRecord>;
  get(runId: string, userId: string): Promise<ProfileRunRecord | null>;
  markRunning(runId: string): Promise<ProfileRunRecord | null>;
  updateProgress(runId: string, progress: Record<string, unknown>): Promise<void>;
  markSucceeded(runId: string, result: unknown): Promise<void>;
  markFailed(runId: string, error: string): Promise<void>;
  requestCancel(runId: string, userId: string): Promise<ProfileRunRecord | null>;
  markCancelled(runId: string, reason?: string): Promise<void>;
  isCancelRequested(runId: string): Promise<boolean>;
  listActive(userId: string, limit?: number): Promise<ProfileRunRecord[]>;
}

export interface ProfileRunQueue {
  enqueue(runId: string): Promise<{ jobId?: string | number } | void>;
  cancel(runId: string): Promise<boolean>;
}
