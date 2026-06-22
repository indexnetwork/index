/**
 * Queue adapter: defines allowed interactions with BullMQ.
 * Imports only from lib (BullMQ). No protocol dependency.
 */

import type { Queue, JobsOptions } from 'bullmq';

// ═══════════════════════════════════════════════════════════════════════════════
// SHARED
// ═══════════════════════════════════════════════════════════════════════════════

/** Result of adding a job (adapter hides BullMQ Job). */
export interface AddJobResult {
  id: string;
}

// ═══════════════════════════════════════════════════════════════════════════════
// INTENT QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

export interface IndexIntentJobData {
  intentId: string;
  networkId: string;
  userId: string;
}

export interface GenerateIntentsJobData {
  userId: string;
  sourceId: string;
  sourceType: 'file' | 'link' | 'integration' | 'discovery_form';
  content?: string;
  objects?: unknown[];
  networkId?: string;
  intentCount?: number;
  instruction?: string;
  createdAt?: number | Date;
}

export type IntentJobName = 'index_intent' | 'generate_intents';
export type IntentJobData = IndexIntentJobData | GenerateIntentsJobData;

export interface IntentQueue {
  addJob(
    name: IntentJobName,
    data: IntentJobData,
    priority?: number
  ): Promise<AddJobResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// NEWSLETTER QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

export interface NewsletterCandidate {
  userId: string;
  userName: string;
  userRole?: string;
  stakeId: string;
  reasoning?: string;
}

export interface NewsletterJobData {
  recipientId: string;
  candidates: NewsletterCandidate[];
  force?: boolean;
}

export interface WeeklyCycleJobData {
  timestamp: number;
  force?: boolean;
  daysSince?: number;
}

export type NewsletterJobName = 'process_newsletter' | 'start_weekly_cycle';
export type NewsletterJobDataUnion = NewsletterJobData | WeeklyCycleJobData;

export interface NewsletterQueue {
  addJob(
    name: NewsletterJobName,
    data: NewsletterJobDataUnion,
    priority?: number
  ): Promise<AddJobResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// OPPORTUNITY QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

export interface OpportunityJobData extends Record<string, unknown> {
  timestamp?: number;
  force?: boolean;
  intentId?: string;
  userId?: string;
}

export interface OpportunityQueue {
  addJob(
    name: string,
    data: OpportunityJobData,
    priority?: number
  ): Promise<AddJobResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// PROFILE QUEUE
// ═══════════════════════════════════════════════════════════════════════════════

export interface ProfileUpdateJobData {
  userId: string;
  intro: string;
  userName: string | null;
}

export interface ProfileQueue {
  addJob(
    name: string,
    data: ProfileUpdateJobData,
    priority?: number
  ): Promise<AddJobResult>;
}

// ═══════════════════════════════════════════════════════════════════════════════
// COMPOSITE
// ═══════════════════════════════════════════════════════════════════════════════

export interface QueueAdapter {
  intent: IntentQueue;
  newsletter: NewsletterQueue;
  opportunity: OpportunityQueue;
  profile: ProfileQueue;
}

export interface QueueAdapterDeps {
  intent: IntentQueue;
  newsletter: NewsletterQueue;
  opportunity: OpportunityQueue;
  profile: ProfileQueue;
}

export function createQueueAdapter(deps: QueueAdapterDeps): QueueAdapter {
  return {
    intent: deps.intent,
    newsletter: deps.newsletter,
    opportunity: deps.opportunity,
    profile: deps.profile,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
// BULLMQ WRAPPERS (allowed interactions)
// ═══════════════════════════════════════════════════════════════════════════════

/**
 * Options for wrapping a BullMQ queue. Use to add custom job options (e.g. jobId).
 */
export type AddJobOptionsFn<T> = (
  name: string,
  data: T,
  priority?: number
) => JobsOptions | undefined;

/**
 * Wraps a BullMQ Queue so only addJob(name, data, priority) -> { id } is exposed.
 * Defines the adapter's allowed interaction with BullMQ.
 */
export function wrapQueue<T>(
  queue: Queue<T>,
  getOptions?: AddJobOptionsFn<T>
): { addJob(name: string, data: T, priority?: number): Promise<AddJobResult> } {
  return {
    async addJob(name, data, priority = 0) {
      const base: JobsOptions = {
        priority: priority > 0 ? priority : undefined,
      };
      const extra = getOptions?.(name, data, priority);
      const job = await queue.add(name as never, data as never, { ...base, ...extra });
      return { id: job.id! };
    },
  };
}

/** Intent queue: wrap BullMQ queue with priority-only options. */
export function createIntentQueueAdapter(
  queue: Queue<IntentJobData>
): IntentQueue {
  return wrapQueue(queue) as IntentQueue;
}

/** Opportunity queue: wrap BullMQ queue with priority-only options. */
export function createOpportunityQueueAdapter(
  queue: Queue<OpportunityJobData>
): OpportunityQueue {
  return wrapQueue(queue) as OpportunityQueue;
}

/** Profile queue: wrap BullMQ queue with priority-only options. */
export function createProfileQueueAdapter(
  queue: Queue<ProfileUpdateJobData>
): ProfileQueue {
  return wrapQueue(queue) as ProfileQueue;
}

/**
 * Newsletter queue: wrap BullMQ queue with optional custom options (e.g. jobId).
 * Pass getOptions from the queue module if it needs jobId, removeOnComplete, etc.
 */
export function createNewsletterQueueAdapter(
  queue: Queue<NewsletterJobDataUnion>,
  getOptions?: AddJobOptionsFn<NewsletterJobDataUnion>
): NewsletterQueue {
  return wrapQueue(queue, getOptions) as NewsletterQueue;
}
