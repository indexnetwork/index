import { EventEmitter } from 'events';
import type { SyncRun } from './types';

const emitter = new EventEmitter();
emitter.setMaxListeners(1000);

export function emitRunUpdate(runId: string, run: SyncRun) {
  emitter.emit(`run:${runId}`, run);
}

export function onRunUpdate(runId: string, listener: (run: SyncRun) => void) {
  emitter.on(`run:${runId}`, listener);
}

export function offRunUpdate(runId: string, listener: (run: SyncRun) => void) {
  emitter.off(`run:${runId}`, listener);
}

