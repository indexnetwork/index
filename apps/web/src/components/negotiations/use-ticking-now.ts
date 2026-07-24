import { useEffect, useState } from 'react';

/**
 * Re-render relative timestamps on a fixed interval (IND-555) so `timeAgo`
 * strings don't freeze at fetch time. Returns the current epoch-ms.
 */
export function useTickingNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const interval = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(interval);
  }, [intervalMs]);

  return now;
}
