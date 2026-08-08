import { createHash } from 'node:crypto';
import type { NegotiationContinuationTimeoutIdentity, NegotiationTurn } from '@indexnetwork/protocol';

import type { ContinuationExecutionFence } from '../../adapters/negotiation-continuation.atomic';
import type { Task } from '../../adapters/database.shared';

export type NegotiationTimeoutExecutionSource = 'ordinary' | 'claim';

export interface NegotiationTimeoutExecutionIdentity {
  executionId: string;
  taskId: string;
  source: NegotiationTimeoutExecutionSource;
  generation: string;
  turnNumber: number;
}

export interface NegotiationTimeoutExecutionReceipt {
  version: 1;
  executionId: string;
  taskId: string;
  messageId: string;
  artifactId: string | null;
  finalState: 'completed' | 'waiting_for_agent';
  turnNumber: number;
  completedAt: string;
  rearm: {
    parkGeneration: string;
    /** Absolute deadline committed with the timeout completion outbox. */
    deadlineAt: string;
    continuation?: NegotiationContinuationTimeoutIdentity;
  } | null;
}

export interface NegotiationTimeoutExecutionRecord extends NegotiationTimeoutExecutionIdentity {
  version: 1;
  status: 'pending' | 'invoked' | 'completed';
  createdAt: string;
  invokedAt?: string;
  completedAt?: string;
  turn?: NegotiationTurn;
  receipt?: NegotiationTimeoutExecutionReceipt;
  outboxDeliveredAt?: string;
}

export interface AcquiredNegotiationTimeoutExecution {
  task: Task;
  execution: NegotiationTimeoutExecutionRecord;
  continuationExecution?: ContinuationExecutionFence;
}

export interface NegotiationTimeoutCompletionPlan {
  executionId: string;
  taskId: string;
  conversationId: string;
  turn: NegotiationTurn;
  finalState: 'completed' | 'waiting_for_agent';
  turnNumber: number;
  outcome?: Record<string, unknown>;
  opportunity?: { id: string; status: 'pending' | 'rejected' | 'stalled' };
  continuationOutcome?: 'accepted' | 'rejected' | 'stalled' | 'waiting_for_agent';
  rearm: {
    parkGeneration: string;
    /** Relative policy input; the adapter converts it to a commit-time deadline. */
    parkWindowMs: number;
    continuation?: NegotiationContinuationTimeoutIdentity;
  } | null;
}

export type NegotiationTimeoutAtomicStep =
  | 'message'
  | 'task'
  | 'artifact'
  | 'opportunity'
  | 'continuation'
  | 'receipt';

export interface NegotiationTimeoutExecutionStore {
  acquireWaitingNegotiationTimeoutExecution(input: {
    taskId: string;
    parkGeneration: string;
    turnNumber: number;
    continuation?: NegotiationContinuationTimeoutIdentity;
  }): Promise<AcquiredNegotiationTimeoutExecution | null>;
  acquireClaimedNegotiationTimeoutExecution(input: {
    taskId: string;
    claimedByAgentId: string;
    claimedAt: Date;
    turnNumber: number;
    continuation?: NegotiationContinuationTimeoutIdentity;
  }): Promise<AcquiredNegotiationTimeoutExecution | null>;
  recordNegotiationTimeoutInvocation(input: {
    executionId: string;
    taskId: string;
    turn: NegotiationTurn;
  }): Promise<AcquiredNegotiationTimeoutExecution | null>;
  completeNegotiationTimeoutExecution(
    plan: NegotiationTimeoutCompletionPlan,
    continuationExecution?: ContinuationExecutionFence,
    faultAfterStep?: (step: NegotiationTimeoutAtomicStep) => void | Promise<void>,
  ): Promise<AcquiredNegotiationTimeoutExecution | null>;
  markNegotiationTimeoutOutboxDelivered(taskId: string, executionId: string): Promise<boolean>;
}

export function negotiationTimeoutExecutionId(input: {
  taskId: string;
  source: NegotiationTimeoutExecutionSource;
  generation: string;
  turnNumber: number;
  continuation?: NegotiationContinuationTimeoutIdentity;
}): string {
  const continuation = input.continuation
    ? `${input.continuation.priorTaskId}\0${input.continuation.settlementId}\0${input.continuation.successorTaskId}\0${input.continuation.token}\0${input.continuation.fence}`
    : '';
  const digest = createHash('sha256')
    .update(`${input.taskId}\0${input.source}\0${input.generation}\0${input.turnNumber}\0${continuation}`, 'utf8')
    .digest('hex');
  return `negotiation-timeout:${digest}`;
}

export function remainingDeadlineDelayMs(deadlineAt: string, now = Date.now()): number {
  const deadline = new Date(deadlineAt).getTime();
  if (!Number.isFinite(deadline)) throw new Error('Timeout outbox has a malformed absolute deadline');
  return Math.max(0, deadline - now);
}

function validContinuation(value: unknown): boolean {
  if (value === undefined) return true;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const item = value as Partial<NegotiationContinuationTimeoutIdentity>;
  return typeof item.priorTaskId === 'string'
    && typeof item.settlementId === 'string'
    && typeof item.successorTaskId === 'string'
    && typeof item.token === 'string'
    && Number.isInteger(item.fence);
}

function validReceipt(value: unknown, executionId: string): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const receipt = value as Partial<NegotiationTimeoutExecutionReceipt>;
  const rearm = receipt.rearm;
  return receipt.version === 1
    && receipt.executionId === executionId
    && typeof receipt.taskId === 'string'
    && typeof receipt.messageId === 'string'
    && (typeof receipt.artifactId === 'string' || receipt.artifactId === null)
    && (receipt.finalState === 'completed' || receipt.finalState === 'waiting_for_agent')
    && Number.isInteger(receipt.turnNumber)
    && typeof receipt.completedAt === 'string'
    && (rearm === null || (
      !!rearm
      && typeof rearm.parkGeneration === 'string'
      && typeof rearm.deadlineAt === 'string'
      && Number.isFinite(new Date(rearm.deadlineAt).getTime())
      && validContinuation(rearm.continuation)
    ));
}

export function parseNegotiationTimeoutExecution(value: unknown): NegotiationTimeoutExecutionRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Partial<NegotiationTimeoutExecutionRecord>;
  if (
    record.version !== 1
    || typeof record.executionId !== 'string'
    || typeof record.taskId !== 'string'
    || (record.source !== 'ordinary' && record.source !== 'claim')
    || typeof record.generation !== 'string'
    || !Number.isInteger(record.turnNumber)
    || (record.status !== 'pending' && record.status !== 'invoked' && record.status !== 'completed')
    || typeof record.createdAt !== 'string'
    || ((record.status === 'invoked' || record.status === 'completed') && (!record.turn || typeof record.turn !== 'object'))
    || (record.status === 'completed' && !validReceipt(record.receipt, record.executionId))
  ) return null;
  return record as NegotiationTimeoutExecutionRecord;
}

export function timeoutExecutionMatches(
  record: NegotiationTimeoutExecutionRecord,
  identity: NegotiationTimeoutExecutionIdentity,
): boolean {
  return record.executionId === identity.executionId
    && record.taskId === identity.taskId
    && record.source === identity.source
    && record.generation === identity.generation
    && record.turnNumber === identity.turnNumber;
}
