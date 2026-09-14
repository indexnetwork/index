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
 * one, and reflect once a wave of negotiators has finished. A negotiator
 * finishing alone never wakes anything.
 *
 * A counterpart's turn is the passive trigger: it works that one opportunity
 * and stops. No sibling is decided, the principal is not addressed, and no
 * wake follows.
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
  const working = new Set<string>();
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

  /**
   * @param intent - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  async function negotiate(intent: Intent, opportunityId: string): Promise<void> {
    const result = await negotiateOpportunity(client, opportunityId, intent, runtime());
    log("turn" in result ? `turn ${result.turn.action} on ${opportunityId}` : `stall on ${opportunityId}: ${result.stall.reason}`);
  }

  function negotiateNow(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    const wave = waves.get(intentId) ?? new Set<string>();
    waves.set(intentId, wave);
    working.add(opportunityId);
    wave.add(opportunityId);
    void negotiate(intent, opportunityId).catch(onError).finally(() => {
      working.delete(opportunityId);
      wave.delete(opportunityId);
      // The reflection loop: one wake when the wave empties, not per negotiator.
      if (!wave.size && !stopped) wakeNow(intentId);
    });
  }

  /**
   * A counterpart's turn: decide this one opportunity, take its turn, stop.
   *
   * @param intentId - The signal it belongs to.
   * @param opportunityId - The negotiation they moved on.
   */
  function inboundTurn(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    working.add(opportunityId);
    void (async () => {
      // A wake already running over this signal decides this opportunity too,
      // so a focused one would only race it for the same brief.
      if (!waking.has(intentId)) {
        log(`inbound ${opportunityId}`);
        await wakeIntent(client, intent, { ...runtime(), focus: opportunityId });
      }
      await negotiate(intent, opportunityId);
    })().catch(onError).finally(() => working.delete(opportunityId));
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
        inboundTurn(event.data.intentId, event.data.opportunityId);
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
