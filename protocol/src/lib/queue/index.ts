import { getRedisClient } from '../redis';

export interface QueueJob<T = any> {
  id: string;
  action: string;
  priority: number;
  data: T;
  createdAt: number;
}

export class PriorityQueue<T = any> {
  private redis = getRedisClient();
  private queueKey: string;

  constructor(queueKey: string) {
    this.queueKey = queueKey;
  }

  async addJob(job: Omit<QueueJob<T>, 'id' | 'createdAt'>, generateId?: (job: Omit<QueueJob<T>, 'id' | 'createdAt'>) => string): Promise<void> {
    const queueJob: QueueJob<T> = {
      ...job,
      id: generateId ? generateId(job) : `${job.action}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: Date.now()
    };

    await this.redis.zadd(this.queueKey, job.priority, JSON.stringify(queueJob));
  }

  async getNextJob(): Promise<QueueJob<T> | null> {
    const result = await this.redis.zpopmax(this.queueKey);
    if (!result || result.length === 0) return null;

    try {
      return JSON.parse(result[0]);
    } catch (error) {
      console.error('Failed to parse queue job:', error);
      return null;
    }
  }

  async getQueueSize(): Promise<number> {
    return await this.redis.zcard(this.queueKey);
  }

  async clearQueue(): Promise<void> {
    await this.redis.del(this.queueKey);
  }
}
