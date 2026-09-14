import type { IndexClient } from "@indexnetwork/client";

import type { Intent, Model } from "../src/index.ts";

import { startCron } from "./cron.ts";
import { negotiateOpportunity, wakeIntent } from "./snapshot.ts";

export interface RunnerOptions {
  client: IndexClient;
  model: Model;
  now?: () => Date;
  /** Every wake, turn, stall and dropped action, as one line. */
  log?: (line: string) => void;
  onError?: (error: unknown) => void;
}

export interface Runner {
  /** Abort in-flight runs, the cron timer, and the event stream. There is no restart. */
  stop: () => void;
}

/**
 * Work every active signal this owner has: wake on the triggers that deserve
 * one, negotiate on a counterpart's turn, and reflect once a wave of
 * negotiators has finished. A negotiator finishing alone never wakes anything.
 *
 * @param options - Index, the model, and where to report.
 * @returns A handle that stops everything.
 */
export function startRunner(options: RunnerOptions): Runner {
  const { client, model, now = () => new Date(), log = () => {}, onError = () => {} } = options;
  const abort = new AbortController();
  const intents = new Map<string, Intent>();
  const waking = new Set<string>();
  const again = new Set<string>();
  const waves = new Map<string, Set<string>>();
  let stopped = false;

  const runtime = () => ({ model, now, signal: abort.signal, log });

  function wakeNow(intentId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent) return;
    if (waking.has(intentId)) {
      again.add(intentId);
      return;
    }
    waking.add(intentId);
    void (async () => {
      log(`wake ${intent.statement}`);
      const started = Date.now();
      // Each opportunity opens the moment its own decision is published, so
      // the first turns go out while the rest are still being decided.
      await wakeIntent(client, intent, { ...runtime(), onNegotiate: (opportunityId) => negotiateNow(intentId, opportunityId) });
      log(`  wake done in ${Math.round((Date.now() - started) / 1000)}s`);
    })().catch(onError).finally(() => {
      waking.delete(intentId);
      if (again.delete(intentId)) wakeNow(intentId);
    });
  }

  function negotiateNow(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent) return;
    const wave = waves.get(intentId) ?? new Set<string>();
    waves.set(intentId, wave);
    if (wave.has(opportunityId)) return;
    wave.add(opportunityId);
    void (async () => {
      const result = await negotiateOpportunity(client, opportunityId, intent, runtime());
      log("turn" in result ? `turn ${result.turn.action} on ${opportunityId}` : `stall on ${opportunityId}: ${result.stall.reason}`);
    })().catch(onError).finally(() => {
      wave.delete(opportunityId);
      // The reflection loop: one wake when the wave empties, not per negotiator.
      if (!wave.size && !stopped) wakeNow(intentId);
    });
  }

  async function refresh(): Promise<void> {
    const rows = await client.listIntents();
    const active = new Set<string>();
    log(`read ${rows.length} signals, ${rows.filter((row) => row.status === "ACTIVE").length} active`);
    for (const row of rows) {
      if (row.status !== "ACTIVE") continue;
      active.add(row.id);
      const known = intents.has(row.id);
      intents.set(row.id, { id: row.id, statement: row.statement });
      if (!known) {
        log(`signal ${row.id}: ${row.statement}`);
        wakeNow(row.id);
      }
    }
    for (const id of [...intents.keys()]) {
      if (!active.has(id)) {
        intents.delete(id);
        log(`dropped signal ${id}`);
      }
    }
  }

  const stopStream = client.events((event) => {
    switch (event.type) {
      case "negotiation.turn":
        log(`event ${event.type} on ${event.data.opportunityId}`);
        negotiateNow(event.data.intentId, event.data.opportunityId);
        break;
      case "negotiation.opened":
      case "principal.input":
        log(`event ${event.type} on ${event.data.intentId}`);
        wakeNow(event.data.intentId);
        break;
      case "intent.created":
        log(`event ${event.type}: ${event.data.intentId}`);
        void refresh().catch(onError);
        break;
      case "intent.lifecycle":
        log(`event ${event.type}: ${event.data.intentId} is ${event.data.status}`);
        void refresh().catch(onError);
        break;
      default:
        log(`event ${event.type} (no wake)`);
        break;
    }
  });

  void refresh().catch(onError);
  const cron = startCron(now, () => {
    for (const id of intents.keys()) wakeNow(id);
  });

  return {
    stop: () => {
      stopped = true;
      cron.stop();
      stopStream();
      abort.abort();
    },
  };
}
