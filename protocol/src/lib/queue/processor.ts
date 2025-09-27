import { queue, IndexIntentJob } from './llm-queue';
import { intentIndexer } from '../../agents/core/intent_indexer';
import { triggerBrokersOnIntentCreated } from '../../agents/context_brokers/connector';

export class QueueProcessor {
  private isRunning = false;
  private processingInterval: NodeJS.Timeout | null = null;

  start(): void {
    if (this.isRunning) return;
    
    this.isRunning = true;
    console.log('🚀 Queue processor started');
    
    this.processingInterval = setInterval(() => {
      this.processNextJob().catch(error => {
        console.error('Queue processor error:', error);
      });
    }, 500); // Process every second
  }

  stop(): void {
    this.isRunning = false;
    if (this.processingInterval) {
      clearInterval(this.processingInterval);
      this.processingInterval = null;
    }
    console.log('🛑 Queue processor stopped');
  }

  private async processNextJob(): Promise<void> {
    const job = await queue.getNextJob();
    if (!job) return;

    console.log(`🔄 Processing: ${job.action} for intent ${job.data.intentId} (priority: ${job.priority})`);
    
    try {
      switch (job.action) {
        case 'index_intent':
          await this.indexIntent(job);
          break;
        default:
          console.warn(`Unknown action: ${job.action}`);
      }
      
      console.log(`✅ Completed: ${job.action} for intent ${job.data.intentId}`);
    } catch (error) {
      console.error(`❌ Failed: ${job.action} for intent ${job.data.intentId}`, error);
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
