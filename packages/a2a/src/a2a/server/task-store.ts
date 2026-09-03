import type { A2ATask } from "../wire/types.ts";

/**
 * Where inbound Tasks live.
 *
 * An interface rather than a base class: a host's real store is backed by a
 * database, so it both needs to return promises and cannot inherit from a
 * class whose private `Map` would sit unused in every instance — TypeScript's
 * structural typing does not admit a private member declared elsewhere, which
 * would force `extends` on every implementation.
 *
 * Both methods may be synchronous or asynchronous; the server awaits either.
 */
export interface TaskStore {
  get(taskId: string): A2ATask | undefined | Promise<A2ATask | undefined>;
  save(task: A2ATask): void | Promise<void>;
}

/** In-memory Task storage, keyed by task id. Good for a single process; a
 * deployment that runs more than one, or survives restarts, implements
 * {@link TaskStore} over its own database instead. */
export class MemoryTaskStore implements TaskStore {
  private readonly tasks = new Map<string, A2ATask>();

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  save(task: A2ATask): void {
    this.tasks.set(task.id, task);
  }
}
