import { QueueJob } from './index';

export interface Worker<T> {
  id: number;
  busy: boolean;
  process: (job: QueueJob<T>) => Promise<void>;
}

export class WorkerPool<T = any> {
  private workers: Worker<T>[] = [];
  private jobQueue: QueueJob<T>[] = [];
  private isRunning = false;

  constructor(
    private workerCount: number = parseInt(process.env.QUEUE_CONCURRENCY || '3'),
    private jobProcessor: (job: QueueJob<T>) => Promise<void>
  ) {
    this.initializeWorkers();
  }

  private initializeWorkers(): void {
    for (let i = 0; i < this.workerCount; i++) {
      this.workers.push({
        id: i,
        busy: false,
        process: async (job: QueueJob<T>) => {
          const worker = this.workers[i];
          worker.busy = true;
          try {
            console.log(`[Worker ${i}] Processing job ${job.id}`);
            await this.jobProcessor(job);
            console.log(`[Worker ${i}] Completed job ${job.id}`);
          } catch (error) {
            console.error(`[Worker ${i}] Failed job ${job.id}:`, error);
            throw error;
          } finally {
            worker.busy = false;
            this.processNextJob();
          }
        }
      });
    }
  }

  start(): void {
    this.isRunning = true;
    console.log(`🚀 Worker pool started with ${this.workerCount} workers`);
  }

  stop(): void {
    this.isRunning = false;
    console.log('🛑 Worker pool stopped');
  }

  addJob(job: QueueJob<T>): void {
    if (!this.isRunning) return;
    
    this.jobQueue.push(job);
    this.processNextJob();
  }

  private processNextJob(): void {
    if (this.jobQueue.length === 0) return;

    // Find available worker
    const availableWorker = this.workers.find(w => !w.busy);
    if (!availableWorker) return;

    const job = this.jobQueue.shift();
    if (job) {
      availableWorker.process(job).catch(error => {
        console.error(`Worker pool error:`, error);
      });
    }
  }

  getStatus(): { 
    totalWorkers: number; 
    busyWorkers: number; 
    queueLength: number; 
    availableWorkers: number;
  } {
    const busyWorkers = this.workers.filter(w => w.busy).length;
    return {
      totalWorkers: this.workerCount,
      busyWorkers,
      availableWorkers: this.workerCount - busyWorkers,
      queueLength: this.jobQueue.length
    };
  }
}
