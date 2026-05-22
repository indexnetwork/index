/** Config */
import { config } from "dotenv";
config({ path: '.env.test' });

import { describe, it, expect, jest, mock, afterAll } from 'bun:test';
import { QueueFactory } from './bullmq';
import { Queue, Worker, QueueEvents } from 'bullmq';

// Mock bullmq
mock.module('bullmq', () => ({
  Queue: jest.fn(),
  Worker: jest.fn(),
  QueueEvents: jest.fn(),
}));

afterAll(() => {
  mock.restore();
});

describe('QueueFactory', () => {
  it('should create a queue with default options', () => {
    const _queue = QueueFactory.createQueue('test-queue');
    expect(Queue).toHaveBeenCalledWith('test-queue', expect.objectContaining({
      connection: expect.any(Object),
      defaultJobOptions: expect.any(Object),
    }));
  });

  it('should create a worker', () => {
    const processor = jest.fn();
    QueueFactory.createWorker('test-queue', processor);
    expect(Worker).toHaveBeenCalledWith('test-queue', processor, expect.objectContaining({
      connection: expect.any(Object),
      concurrency: 1,
    }));
  });

  it('should create queue events', () => {
    QueueFactory.createQueueEvents('test-queue');
    expect(QueueEvents).toHaveBeenCalledWith('test-queue', expect.objectContaining({
      connection: expect.any(Object),
    }));
  });
});
