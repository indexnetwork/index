import { PriorityQueue, QueueJob } from './index';

// LLM-specific job types
export interface IndexIntentJobData {
  intentId: string;
  indexId: string;
  triggerBrokers?: boolean;
}

export type IndexIntentJob = QueueJob<IndexIntentJobData>;

// Create LLM queue instance with custom ID generator
export const llmQueue = new PriorityQueue<IndexIntentJobData>('llm_queue');

// Helper function to add index intent jobs
export async function addIndexIntentJob(data: IndexIntentJobData, priority: number): Promise<void> {
  await llmQueue.addJob(
    {
      action: 'index_intent',
      priority,
      data
    },
    // Custom ID generator for intent jobs
    (job) => `${job.action}_${job.data.intentId}_${job.data.indexId}_${Date.now()}`
  );
}

// Legacy export for compatibility
export const queue = llmQueue;
