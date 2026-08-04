import { useEffect, useRef, useState } from 'react';

import { HarnessProgressParser, type RunProgress } from '../../../../packages/protocol/eval/ops/ops.progress';
import { isTerminalStatus, subscribeToRun, type RunRecord } from '../api/client';

export interface RunProgressState {
  run: RunRecord | null;
  progress: RunProgress | null;
  /** First-seen and completion timestamps per case id, for live durations. */
  caseTimes: ReadonlyMap<string, number>;
  /** Set when the stream fails before any status frame arrives. */
  streamError: string | null;
}

/**
 * Subscribes to one run's stream and keeps the structured progress view fed:
 * status frames update the record, log chunks advance the parser, and case
 * timestamps give RunProgressView its durations. The pair page runs two of
 * these side by side; the single-run page keeps its own richer wiring (it
 * also fetches artifacts, comparisons and handles cancel).
 *
 * On a mid-stream reconnect the server replays the log from byte 0, so the
 * parser and timestamps reset — otherwise every case would render twice.
 */
export function useRunProgress(runId: string): RunProgressState {
  const [run, setRun] = useState<RunRecord | null>(null);
  const [progress, setProgress] = useState<RunProgress | null>(null);
  const [streamError, setStreamError] = useState<string | null>(null);
  const parserRef = useRef(new HarnessProgressParser());
  const caseTimesRef = useRef(new Map<string, number>());

  useEffect(() => {
    let mounted = true;
    let sawStatus = false;
    let closed = false;

    const unsubscribe = subscribeToRun(runId, {
      onLog: (chunk: string) => {
        if (!mounted) return;
        parserRef.current.push(chunk);
        const snapshot = parserRef.current.snapshot();
        const times = caseTimesRef.current;
        const nowMs = Date.now();
        for (const c of snapshot.cases) {
          if (!times.has(c.id)) times.set(c.id, nowMs);
          if (c.done && !times.has(`${c.id}::done`)) times.set(`${c.id}::done`, nowMs);
        }
        setProgress(snapshot);
      },
      onStatus: (record: RunRecord) => {
        if (!mounted) return;
        sawStatus = true;
        setRun(record);
        setStreamError(null);

        // The server closes the stream once a run is terminal; a browser
        // EventSource would reconnect forever, replaying the log each time.
        if (isTerminalStatus(record.status)) {
          closed = true;
          unsubscribe();
        }
      },
      onError: () => {
        if (!mounted || closed) return;

        if (!sawStatus) {
          closed = true;
          unsubscribe();
          setStreamError(`No run with id "${runId}" is available to stream.`);
          return;
        }

        parserRef.current = new HarnessProgressParser();
        caseTimesRef.current.clear();
        setProgress(null);
      },
    });

    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [runId]);

  return { run, progress, caseTimes: caseTimesRef.current, streamError };
}
