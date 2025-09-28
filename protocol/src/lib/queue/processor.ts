import { IndexIntentJob, BrokerJob, userQueueManager } from './llm-queue';
import { intentIndexer } from '../../agents/core/intent_indexer';
import { SemanticRelevancyBroker } from '../../agents/context_brokers/semantic_relevancy';
import { getRedisClient } from '../redis';

// Job history tracking interface
export interface JobHistoryEntry {
  id: string;
  jobName: string; // Dynamic job name based on job type
  priority: number;
  status: 'processing' | 'completed' | 'failed';
  workerId: number;
  startedAt: number;
  completedAt?: number;
  duration?: number;
  error?: string;
  // Dynamic job-specific data
  jobData: Record<string, any>;
}

export class QueueProcessor {
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private concurrency: number;
  private redis = getRedisClient();
  private historyKey = 'queue:job_history';
  private semanticBroker = new SemanticRelevancyBroker('028ef80e-9b1c-434b-9296-bb6130509482');
  private availableWorkers = new Set<number>(); // Track available workers
  private jobDistributionInterval: NodeJS.Timeout | null = null;

  constructor(concurrency: number = parseInt(process.env.QUEUE_CONCURRENCY || '3')) {
    this.concurrency = concurrency;
    // Initialize all workers as available
    for (let i = 0; i < concurrency; i++) {
      this.availableWorkers.add(i);
    }
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`🚀 Queue processor started with parallel user processing: ${this.concurrency} workers, max 10 users, 3 workers/user`);
    
    // Start job distribution loop instead of individual worker loops
    this.startJobDistribution();
  }

  private startJobDistribution(): void {
    const distributionLoop = async () => {
      while (this.isRunning) {
        try {
          await this.distributeJobsToWorkers();
        } catch (error) {
          console.error('Job distribution error:', error);
        }
        // Small delay to prevent busy waiting
        await new Promise(resolve => setTimeout(resolve, parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '100')));
      }
    };
    
    distributionLoop().catch(error => {
      console.error('Job distribution crashed:', error);
    });
  }

  private async distributeJobsToWorkers(): Promise<void> {
    // Only distribute if we have available workers
    if (this.availableWorkers.size === 0) {
      return;
    }

    // Get jobs from all eligible users in parallel
    const availableJobs = await userQueueManager.getJobsFromAllEligibleUsers();
    
    if (availableJobs.length === 0) {
      return;
    }

    // Match jobs to available workers
    const jobAssignments: Array<{ job: any; userId: string; workerId: number }> = [];
    const availableWorkerIds = Array.from(this.availableWorkers);
    
    for (let i = 0; i < Math.min(availableJobs.length, availableWorkerIds.length); i++) {
      const workerId = availableWorkerIds[i];
      const { job, userId } = availableJobs[i];
      jobAssignments.push({ job, userId, workerId });
    }

    if (jobAssignments.length === 0) {
      return;
    }

    // Reserve workers and start processing jobs in parallel
    const workerReservations = jobAssignments.map(({ userId, workerId }) => ({ userId, workerId }));
    userQueueManager.reserveWorkers(workerReservations);

    // Remove workers from available set
    for (const { workerId } of jobAssignments) {
      this.availableWorkers.delete(workerId);
    }

    // Process all jobs in parallel
    const processingPromises = jobAssignments.map(({ job, userId, workerId }) => 
      this.processJobWithWorker(job, userId, workerId)
    );

    // Don't await - let jobs process in background
    Promise.allSettled(processingPromises);
  }

  private async processJobWithWorker(job: any, userId: string, workerId: number): Promise<void> {
    try {
      await this.processJob(job, userId, workerId);
    } finally {
      // Always release worker back to available pool
      this.availableWorkers.add(workerId);
      userQueueManager.releaseWorker(userId, workerId);
    }
  }

  stop(): void {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('🛑 Queue processor stopped');
  }

  // Add job to history tracking
  private async addJobToHistory(entry: JobHistoryEntry): Promise<void> {
    try {
      // Store as sorted set with timestamp as score for chronological order
      await this.redis.zadd(this.historyKey, entry.startedAt, JSON.stringify(entry));
      
      // Keep only last 1000 entries to prevent memory bloat
      const totalEntries = await this.redis.zcard(this.historyKey);
      if (totalEntries > 1000) {
        await this.redis.zremrangebyrank(this.historyKey, 0, totalEntries - 1000 - 1);
      }
    } catch (error) {
      console.error('Failed to add job to history:', error);
    }
  }

  // Update job status in history
  private async updateJobHistory(jobId: string, updates: Partial<JobHistoryEntry>): Promise<void> {
    try {
      // Get existing entries
      const entries = await this.redis.zrange(this.historyKey, -100, -1); // Get last 100 entries
      
      for (const entryStr of entries) {
        const entry: JobHistoryEntry = JSON.parse(entryStr);
        if (entry.id === jobId) {
          const updatedEntry = { ...entry, ...updates };
          
          // Remove old entry and add updated one
          await this.redis.zrem(this.historyKey, entryStr);
          await this.redis.zadd(this.historyKey, updatedEntry.startedAt, JSON.stringify(updatedEntry));
          break;
        }
      }
    } catch (error) {
      console.error('Failed to update job history:', error);
    }
  }

  // Get recent job history
  async getJobHistory(limit: number = 50): Promise<JobHistoryEntry[]> {
    try {
      const entries = await this.redis.zrange(this.historyKey, -limit, -1);
      return entries.map(entry => JSON.parse(entry)).reverse(); // Most recent first
    } catch (error) {
      console.error('Failed to get job history:', error);
      return [];
    }
  }

  private async processJob(job: any, userId: string, workerId: number): Promise<void> {
    const workerPrefix = `[W${workerId}] `;
    const startTime = Date.now();
    
    // Create dynamic job name and data based on job type
    let jobName: string;
    let jobData: Record<string, any> = { ...job.data };
    
    switch (job.action) {
      case 'index_intent':
        jobName = `Index Intent → Index`;
        break;
      case 'broker_semantic_relevancy':
        jobName = `Semantic Relevancy Pair`;
        break;
      default:
        jobName = job.action;
    }
    
    // Create history entry
    const historyEntry: JobHistoryEntry = {
      id: job.id,
      jobName,
      priority: job.priority,
      status: 'processing',
      workerId: workerId,
      startedAt: startTime,
      jobData
    };
    
    await this.addJobToHistory(historyEntry);
    
    console.log(`${workerPrefix}🔄 Processing: ${job.action} for user ${userId} intent ${job.data.intentId} (priority: ${job.priority})`);
    
    try {
      switch (job.action) {
        case 'index_intent':
          await this.indexIntent(job as IndexIntentJob);
          break;
        case 'broker_semantic_relevancy':
          await this.processBrokerJob(job as BrokerJob);
          break;
        default:
          console.warn(`${workerPrefix}Unknown action: ${job.action}`);
      }
      
      const completedAt = Date.now();
      const duration = completedAt - startTime;
      
      // Update history with completion
      await this.updateJobHistory(job.id, {
        status: 'completed',
        completedAt,
        duration
      });
      
      console.log(`${workerPrefix}✅ Completed: ${job.action} for user ${userId} intent ${job.data.intentId} (${duration}ms)`);
    } catch (error) {
      const completedAt = Date.now();
      const duration = completedAt - startTime;
      
      // Update history with failure
      await this.updateJobHistory(job.id, {
        status: 'failed',
        completedAt,
        duration,
        error: error instanceof Error ? error.message : String(error)
      });
      
      console.error(`${workerPrefix}❌ Failed: ${job.action} for user ${userId} intent ${job.data.intentId} (${duration}ms)`, error);
    }
  }

  private async indexIntent(job: IndexIntentJob): Promise<void> {
    const { intentId, indexId } = job.data;
    
    // Process specific intent-index pair
    await intentIndexer.processIntentForIndex(intentId, indexId);
    
  }

  private async processBrokerJob(job: BrokerJob): Promise<void> {
    const { currentIntentId, relatedIntentId, brokerType } = job.data;
    
    switch (brokerType) {
      case 'semantic_relevancy':
        if (!relatedIntentId) {
          console.error(`Semantic relevancy job missing relatedIntentId: ${currentIntentId}`);
          return;
        }
        // Process specific intent pair
        await this.semanticBroker.processIntentPair(currentIntentId, relatedIntentId);
        break;
      default:
        console.warn(`Unknown broker type: ${brokerType}`);
    }
  }
}

export const queueProcessor = new QueueProcessor();
