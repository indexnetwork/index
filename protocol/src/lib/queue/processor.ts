import { queue, IndexIntentJob } from './llm-queue';
import { intentIndexer } from '../../agents/core/intent_indexer';
import { triggerBrokersOnIntentCreated } from '../../agents/context_brokers/connector';

export class QueueProcessor {
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;
  private concurrency: number;

  constructor(concurrency: number = parseInt(process.env.QUEUE_CONCURRENCY || '3')) {
    this.concurrency = concurrency;
  }

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log(`🚀 Queue processor started with concurrency: ${this.concurrency}`);
    
    // Start multiple parallel processing loops
    for (let i = 0; i < this.concurrency; i++) {
      this.startWorker(i);
    }
  }

  private startWorker(workerId: number): void {
    const processLoop = async () => {
      while (this.isRunning) {
        try {
          await this.processNextJob(workerId);
        } catch (error) {
          console.error(`Queue worker ${workerId} error:`, error);
        }
        // Small delay to prevent busy waiting
        await new Promise(resolve => setTimeout(resolve, parseInt(process.env.QUEUE_POLL_INTERVAL_MS || '100')));
      }
    };
    
    processLoop().catch(error => {
      console.error(`Queue worker ${workerId} crashed:`, error);
    });
  }

  stop(): void {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('🛑 Queue processor stopped');
  }

  private async processNextJob(workerId?: number): Promise<void> {
    const job = await queue.getNextJob();
    if (!job) return;

    const workerPrefix = workerId !== undefined ? `[W${workerId}] ` : '';
    console.log(`${workerPrefix}🔄 Processing: ${job.action} for intent ${job.data.intentId} (priority: ${job.priority})`);
    
    try {
      switch (job.action) {
        case 'index_intent':
          await this.indexIntent(job);
          break;
        default:
          console.warn(`${workerPrefix}Unknown action: ${job.action}`);
      }
      
      console.log(`${workerPrefix}✅ Completed: ${job.action} for intent ${job.data.intentId}`);
    } catch (error) {
      console.error(`${workerPrefix}❌ Failed: ${job.action} for intent ${job.data.intentId}`, error);
    }
  }

  private async indexIntent(job: IndexIntentJob): Promise<void> {
    const { intentId, indexId, triggerBrokers } = job.data;
    
    // Process specific intent-index pair
    await intentIndexer.processIntentForIndex(intentId, indexId);
    
    // Run context brokers if requested (for newly created/updated intents)
    if (triggerBrokers) {
      await triggerBrokersOnIntentCreated(intentId);
    }
  }
}

export const queueProcessor = new QueueProcessor();
