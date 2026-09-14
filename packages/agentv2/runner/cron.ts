/** Morning, afternoon, evening on the runner's clock. */
const CRON_HOURS = [8, 14, 20];

/**
 * @param from - The moment to schedule after.
 * @returns The next cron hour strictly after it.
 */
export function nextCron(from: Date): Date {
  const at = new Date(from);
  at.setMinutes(0, 0, 0);
  for (const hour of CRON_HOURS) {
    at.setHours(hour);
    if (at > from) return at;
  }
  at.setDate(at.getDate() + 1);
  at.setHours(CRON_HOURS[0]!);
  return at;
}

/**
 * Call `tick` at every cron hour, rescheduling itself after each one.
 *
 * @param now - The runner's clock.
 * @param tick - What one cron hour does.
 * @returns A handle that cancels the pending hour.
 */
export function startCron(now: () => Date, tick: () => void): { stop: () => void } {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let stopped = false;

  const schedule = (): void => {
    if (stopped) return;
    timer = setTimeout(() => {
      tick();
      schedule();
    }, nextCron(now()).getTime() - now().getTime());
    timer.unref?.();
  };

  schedule();
  return {
    stop: () => {
      stopped = true;
      clearTimeout(timer);
    },
  };
}
