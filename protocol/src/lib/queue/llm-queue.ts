import { PriorityQueue, QueueJob } from './index';
import { getRedisClient } from '../redis';

// LLM-specific job types
export interface IndexIntentJobData {
  intentId: string;
  indexId: string;
  userId: string; // Add userId to job data
}

export interface BrokerJobData {
  intentId: string; // Changed from currentIntentId for consistency
  relatedIntentId: string; // Required - we only queue pair processing jobs
  userId: string;
  brokerType: 'semantic_relevancy' | 'other';
  brokerAgentId?: string;
}

export type IndexIntentJob = QueueJob<IndexIntentJobData>;
export type BrokerJob = QueueJob<BrokerJobData>;

// Per-user queue manager with parallel processing
export class UserQueueManager {
  private redis = getRedisClient();
  private userQueues = new Map<string, PriorityQueue<IndexIntentJobData | BrokerJobData>>();
  private activeUsersSetKey = 'active_user_queues';
  private userWorkers = new Map<string, Set<number>>(); // Track active workers per user
  private maxUsers = parseInt(process.env.QUEUE_MAX_USERS || '10'); // Max concurrent users
  private maxWorkersPerUser = parseInt(process.env.QUEUE_MAX_WORKERS_PER_USER || '3'); // Max workers per user

  // Get or create queue for specific user
  getUserQueue(userId: string): PriorityQueue<IndexIntentJobData | BrokerJobData> {
    if (!this.userQueues.has(userId)) {
      const queue = new PriorityQueue<IndexIntentJobData | BrokerJobData>(`user_queue:${userId}`);
      this.userQueues.set(userId, queue);
    }
    return this.userQueues.get(userId)!;
  }

  // Add indexing job to user's specific queue
  async addUserJob(userId: string, data: IndexIntentJobData, priority: number): Promise<void> {
    const userQueue = this.getUserQueue(userId);
    
    // Add user to active users set
    await this.redis.sadd(this.activeUsersSetKey, userId);
    
    await userQueue.addJob(
      {
        action: 'index_intent',
        priority,
        data
      },
      // Custom ID generator for intent jobs
      (job) => `${job.action}_${job.data.intentId}_${(job.data as IndexIntentJobData).indexId}_${Date.now()}`
    );
  }

  // Add broker job to user's specific queue
  async addUserBrokerJob(userId: string, data: BrokerJobData, priority: number): Promise<void> {
    const userQueue = this.getUserQueue(userId);
    
    // Add user to active users set
    await this.redis.sadd(this.activeUsersSetKey, userId);
    
    await userQueue.addJob(
      {
        action: 'broker_semantic_relevancy',
        priority,
        data
      },
      // Custom ID generator for broker jobs
      (job) => `${job.action}_${job.data.intentId}_${(job.data as BrokerJobData).relatedIntentId}_${Date.now()}`
    );
  }

  // Get all active user queue keys (using Redis Set instead of keys)
  async getActiveUserQueues(): Promise<string[]> {
    const activeUsers = await this.redis.smembers(this.activeUsersSetKey);
    return activeUsers;
  }

  // Get next job from any user queue with parallel processing limits
  async getNextJobFromAnyUser(workerId: number): Promise<{ job: QueueJob<IndexIntentJobData | BrokerJobData>; userId: string } | null> {
    const activeUsers = await this.getActiveUserQueues();
    
    if (activeUsers.length === 0) {
      return null;
    }
    
    // Limit concurrent users and filter users with capacity
    const eligibleUsers = activeUsers
      .slice(0, this.maxUsers)
      .filter(userId => {
        const userWorkerSet = this.userWorkers.get(userId) || new Set();
        return userWorkerSet.size < this.maxWorkersPerUser;
      });
    
    if (eligibleUsers.length === 0) {
      return null; // All users are at max capacity
    }
    
    // Try to get jobs from all eligible users in parallel
    const jobPromises = eligibleUsers.map(async (userId) => {
      const userQueue = this.getUserQueue(userId);
      const job = await userQueue.getNextJob();
      
      if (job) {
        return { job, userId };
      } else {
        // Check if queue is empty and remove from active set
        const queueSize = await userQueue.getQueueSize();
        if (queueSize === 0) {
          await this.redis.srem(this.activeUsersSetKey, userId);
        }
        return null;
      }
    });
    
    // Wait for all parallel job fetches
    const results = await Promise.all(jobPromises);
    
    // Find first successful job
    const successfulResult = results.find(result => result !== null);
    
    if (successfulResult) {
      const { job, userId } = successfulResult;
      
      // Assign worker to this user
      if (!this.userWorkers.has(userId)) {
        this.userWorkers.set(userId, new Set());
      }
      this.userWorkers.get(userId)!.add(workerId);
      
      return { job, userId };
    }
    
    return null;
  }

  // Get multiple jobs from multiple users in parallel (for batch processing)
  async getJobsFromAllEligibleUsers(): Promise<Array<{ job: QueueJob<IndexIntentJobData | BrokerJobData>; userId: string }>> {
    const activeUsers = await this.getActiveUserQueues();
    
    if (activeUsers.length === 0) {
      return [];
    }
    
    // Get all users with available worker capacity
    const eligibleUsers = activeUsers
      .slice(0, this.maxUsers)
      .filter(userId => {
        const userWorkerSet = this.userWorkers.get(userId) || new Set();
        return userWorkerSet.size < this.maxWorkersPerUser;
      });
    
    if (eligibleUsers.length === 0) {
      return [];
    }
    
    // Get jobs from all eligible users in parallel
    const jobPromises = eligibleUsers.map(async (userId) => {
      const userWorkerSet = this.userWorkers.get(userId) || new Set();
      const availableSlots = this.maxWorkersPerUser - userWorkerSet.size;
      
      // Get up to availableSlots jobs from this user
      const userQueue = this.getUserQueue(userId);
      const userJobs: Array<{ job: QueueJob<IndexIntentJobData | BrokerJobData>; userId: string }> = [];
      
      for (let i = 0; i < availableSlots; i++) {
        const job = await userQueue.getNextJob();
        if (job) {
          userJobs.push({ job, userId });
        } else {
          // Check if queue is empty and remove from active set
          const queueSize = await userQueue.getQueueSize();
          if (queueSize === 0) {
            await this.redis.srem(this.activeUsersSetKey, userId);
          }
          break; // No more jobs for this user
        }
      }
      
      return userJobs;
    });
    
    // Wait for all parallel operations
    const results = await Promise.all(jobPromises);
    
    // Flatten results
    return results.flat();
  }

  // Reserve worker slots for jobs (call this before processing)
  reserveWorkers(jobs: Array<{ userId: string; workerId: number }>): void {
    for (const { userId, workerId } of jobs) {
      if (!this.userWorkers.has(userId)) {
        this.userWorkers.set(userId, new Set());
      }
      this.userWorkers.get(userId)!.add(workerId);
    }
  }

  // Release worker from user when job completes
  releaseWorker(userId: string, workerId: number): void {
    const userWorkerSet = this.userWorkers.get(userId);
    if (userWorkerSet) {
      userWorkerSet.delete(workerId);
      if (userWorkerSet.size === 0) {
        this.userWorkers.delete(userId);
      }
    }
  }

  // Get parallel processing stats
  getParallelStats(): { activeUsers: number; totalWorkers: number; userWorkerCounts: Record<string, number> } {
    const userWorkerCounts: Record<string, number> = {};
    let totalWorkers = 0;
    
    for (const [userId, workerSet] of this.userWorkers.entries()) {
      userWorkerCounts[userId] = workerSet.size;
      totalWorkers += workerSet.size;
    }
    
    return {
      activeUsers: this.userWorkers.size,
      totalWorkers,
      userWorkerCounts
    };
  }

  // Get queue status for all users
  async getAllUsersStatus(): Promise<Array<{ userId: string; queueSize: number }>> {
    const activeUsers = await this.getActiveUserQueues();
    const statusPromises = activeUsers.map(async (userId) => {
      const userQueue = this.getUserQueue(userId);
      const queueSize = await userQueue.getQueueSize();
      
      // Clean up empty queues from active set
      if (queueSize === 0) {
        await this.redis.srem(this.activeUsersSetKey, userId);
      }
      
      return { userId, queueSize };
    });
    
    const results = await Promise.all(statusPromises);
    
    // Filter out empty queues for status display
    return results.filter(status => status.queueSize > 0);
  }
}

// Global user queue manager instance
export const userQueueManager = new UserQueueManager();

// Helper function to add index intent jobs with userId
export async function addIndexIntentJob(data: IndexIntentJobData, priority: number): Promise<void> {
  await userQueueManager.addUserJob(data.userId, data, priority);
}

// Helper function to add broker jobs with userId
export async function addBrokerJob(data: BrokerJobData, priority: number): Promise<void> {
  await userQueueManager.addUserBrokerJob(data.userId, data, priority);
}
