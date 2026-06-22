# Queue Implementation Template

This document provides a standard template for creating new background job queues using the centralized `QueueFactory`.

## Directory Structure

Queues should typically be located in `src/queues/[domain]/`:

```
src/queues/[domain]/
  ├── [queue-name].queue.ts      # Queue definition and producer
  ├── [queue-name].worker.ts     # Worker (consumer) logic
  └── [queue-name].types.ts      # Job payload types
```

## Implementation

### 1. Types (`[queue-name].types.ts`)

Define the data structure for the job payload.

```typescript
export interface MyJobPayload {
  userId: string;
  action: string;
  meta?: Record<string, any>;
}

export const MY_QUEUE_NAME = 'domain:action-name'; // Namespaced queue name
```

### 2. Queue Definition (`[queue-name].queue.ts`)

Use `QueueFactory` to create the queue instance. This handles connection reuse and default options.

```typescript
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { MY_QUEUE_NAME, MyJobPayload } from './[queue-name].types';

// Create the queue instance
export const myQueue = QueueFactory.createQueue<MyJobPayload>(MY_QUEUE_NAME);

/**
 * Helper to dispatch a job to this queue.
 */
export async function dispatchMyJob(payload: MyJobPayload) {
  return myQueue.add('process-action', payload);
}
```

### 3. Worker Definition (`[queue-name].worker.ts`)

Define the worker to process jobs. Always handle errors gracefully.

```typescript
import { Job } from 'bullmq';
import { QueueFactory } from '../../lib/bullmq/bullmq';
import { MY_QUEUE_NAME, MyJobPayload } from './[queue-name].types';
import { log } from '../../lib/log';

/**
 * Processor function for the job.
 */
async function processMyJob(job: Job<MyJobPayload>) {
  const { userId, action } = job.data;
  
  log.info(`[MyWorker] Processing job ${job.id} for user ${userId}`);

  try {
    // Perform task logic here
    await performAction(userId, action);
    
    log.info(`[MyWorker] Job ${job.id} completed`);
    return { success: true };
  } catch (error) {
    log.error(`[MyWorker] Job ${job.id} failed`, { error });
    throw error; // Throwing allows BullMQ to handle retries
  }
}

// Create and export the worker instance
// Note: Workers are usually initialized in the main server entry point
export const myWorker = QueueFactory.createWorker<MyJobPayload>(
  MY_QUEUE_NAME, 
  processMyJob, 
  { 
    concurrency: 5 // Optional: Override default concurrency (1)
  }
);
```

## Best Practices

1.  **Use `QueueFactory`**: Always use `QueueFactory` instead of `new Queue()` or `new Worker()` directly. This ensures consistent Redis connections and default job settings (retries, timeouts).
2.  **Error Handling**: Wrap worker logic in try/catch blocks. Log errors but re-throw them if you want the job to retry (based on default retry policy).
3.  **Concurrency**: Use the `concurrency` option in `createWorker` to control how many jobs run in parallel per worker instance.
4.  **Idempotency**: Ensure your worker logic is idempotent, as jobs may be retried.
