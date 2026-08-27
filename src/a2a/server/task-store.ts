import type { A2ATask } from "../wire/types.ts";

/** In-memory Task storage, keyed by task id. Good for a single process; a
 * real deployment with multiple instances would swap this for something
 * shared (a database, Redis, etc.) behind the same interface. */
export class TaskStore {
  private readonly tasks = new Map<string, A2ATask>();

  get(taskId: string): A2ATask | undefined {
    return this.tasks.get(taskId);
  }

  save(task: A2ATask): void {
    this.tasks.set(task.id, task);
  }
}
