/**
 * Simple performance timing utilities for the protocol library.
 * Standalone — no external dependencies.
 */

type TimingCallback = (name: string, durationMs: number) => void;
type TimingWrapper = <T>(name: string, fn: () => Promise<T>) => Promise<T>;

let onTiming: TimingCallback | undefined;
let timingWrapper: TimingWrapper | undefined;

/** Set a global callback for timing events (e.g. for aggregation/logging). */
export function setTimingCallback(cb: TimingCallback | undefined) {
  onTiming = cb;
}

/**
 * Set a global wrapper around timed operations.
 * Host applications can use this to attach protocol timings to their tracing backend
 * without coupling the protocol package to any observability vendor.
 */
export function setTimingWrapper(wrapper: TimingWrapper | undefined) {
  timingWrapper = wrapper;
}

/**
 * Wraps an async function with timing measurement.
 * Reports duration to the global timing callback if set.
 */
export async function timed<T>(name: string, fn: () => Promise<T>): Promise<T> {
  const run = async () => {
    const start = performance.now();
    try {
      const result = await fn();
      onTiming?.(name, performance.now() - start);
      return result;
    } catch (err) {
      onTiming?.(name, performance.now() - start);
      throw err;
    }
  };

  return timingWrapper ? timingWrapper(name, run) : run();
}

/**
 * Method decorator that wraps an async method with timing measurement.
 * Uses `ClassName.methodName` as the timing label.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function Timed(): (target: any, propertyKey: string, descriptor: PropertyDescriptor) => void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return function (_target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const original = descriptor.value;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    descriptor.value = function (this: any, ...args: any[]) {
      const className = this.constructor.name;
      const name = `${className}.${propertyKey}`;
      return timed(name, () => original.apply(this, args));
    };
  };
}
