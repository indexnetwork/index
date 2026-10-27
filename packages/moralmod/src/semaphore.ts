/** A counting semaphore: at most `limit` works run at once, the rest wait in FIFO order. */
export class Semaphore {
  private active = 0;
  private readonly waiters: (() => void)[] = [];

  constructor(private readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) throw new Error("Semaphore limit must be a positive integer.");
  }

  async run<T>(work: () => Promise<T>): Promise<T> {
    if (this.active < this.limit) this.active++;
    else await new Promise<void>((resolve) => { this.waiters.push(resolve); });
    try {
      return await work();
    } finally {
      // Hand the slot to the next waiter directly: the count never dips in
      // between, so a caller arriving mid-handoff cannot over-admit.
      const waiter = this.waiters.shift();
      if (waiter) waiter();
      else this.active--;
    }
  }
}
