import { traceAppOperation } from "../sentry-performance";

import { recordTiming } from "./performance.aggregator";

export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  return traceAppOperation(
    {
      name,
      op: 'backend.operation',
      attributes: {
        subsystem: 'backend',
        'code.function': name,
      },
    },
    async () => {
      const start = performance.now();
      try {
        const result = await fn();
        recordTiming(name, performance.now() - start);
        return result;
      } catch (err) {
        recordTiming(name, performance.now() - start);
        throw err;
      }
    },
  );
}
