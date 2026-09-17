import type { Index } from "@indexnetwork/client";

import type { Intent, Model } from "../src/index.ts";
import { runNegotiate, runWake } from "../src/host.ts";

export interface RunnerOptions {
  client: Index;
  model: Model;
  now?: () => Date;
  /** Every wake, turn and stall, as one line. */
  log?: (line: string) => void;
  onError?: (error: unknown) => void;
}

export interface Runner {
  /** Wake one signal now, for whatever reason the host has. */
  wake: (intentId: string) => void;
  /** Abort in-flight runs and the event stream. There is no restart. */
  stop: () => void;
}

/**
 * Work every active signal this owner has. Nothing runs on a clock: a wake
 * happens because something changed on the signal, or because the host asked
 * for one.
 *
 * A counterpart's turn and an opening are the passive triggers: each briefs
 * that one opportunity if it needs briefing, takes its turn, and stops. No
 * sibling is decided, the principal is not addressed, and no wake follows.
 *
 * @param options - Index, the model, and where to report.
 * @returns A handle that wakes a signal on demand and stops everything.
 */
export function startRunner(options: RunnerOptions): Runner {
  const { client, model, now = () => new Date(), log = () => {}, onError = () => {} } = options;
  const abort = new AbortController();
  const intents = new Map<string, Intent>();
  const waking = new Set<string>();
  const again = new Set<string>();
  const waves = new Map<string, Set<string>>();
  const working = new Set<string>();
  /** Opportunities whose stall is waiting on the principal, by signal. */
  const stalled = new Map<string, string>();
  let stopped = false;

  const runtime = () => ({ model, now, signal: abort.signal, log });

  /**
   * Wake one signal, coalescing a request that arrives while one is running
   * into a single follow-up.
   *
   * @param intentId - The signal to think about.
   */
  function startWake(intentId: string): void {
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
      // the first turns go out while the wake is still thinking.
      await runWake(client, intent, { ...runtime(), onNegotiate: (opportunityId, decision) => startNegotiate(intentId, opportunityId, decision) });
      log(`  wake done in ${Math.round((Date.now() - started) / 1000)}s`);
    })().catch(onError).finally(() => {
      waking.delete(intentId);
      if (again.delete(intentId)) startWake(intentId);
    });
  }

  /**
   * Work one negotiation, and wake the signal when it stalls: the stall stands
   * on the conversation, so that wake can ask the principal for what the brief
   * was missing.
   *
   * A stall inside a wave waits for the wake that fires when the wave empties,
   * so every stall of that batch is put to the principal together rather than
   * one wake, one question at a time. Only the first stall of an opportunity
   * counts, and a continue is then held out of the wake's own negotiators
   * until the principal answers: without that, asking and stalling would
   * trade places without end. Accept and decline still run — that turn is
   * what the stall was waiting for.
   *
   * @param intent - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  async function takeTurn(intent: Intent, opportunityId: string): Promise<void> {
    const result = await runNegotiate(client, opportunityId, intent, runtime());
    if ("turn" in result) {
      log(`turn ${result.turn.action} on ${opportunityId}`);
      stalled.delete(opportunityId);
      return;
    }
    log(`stall on ${opportunityId}: ${result.stall.reason}`);
    if (stalled.has(opportunityId)) return;
    stalled.set(opportunityId, intent.id);
    if (waves.get(intent.id)?.has(opportunityId)) return;
    startWake(intent.id);
  }

  /**
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation a decision just authorised.
   * @param decision - The wake's decision, when this start came from one.
   */
  function startNegotiate(intentId: string, opportunityId: string, decision?: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    // A continue after a stall still has no new fact. Accept and decline are
    // the fact: release the hold so that turn goes out.
    if (decision === "accept" || decision === "decline") stalled.delete(opportunityId);
    if (stalled.has(opportunityId)) return;
    const wave = waves.get(intentId) ?? new Set<string>();
    waves.set(intentId, wave);
    working.add(opportunityId);
    wave.add(opportunityId);
    void takeTurn(intent, opportunityId).catch(onError).finally(() => {
      working.delete(opportunityId);
      wave.delete(opportunityId);
      // One wake when the wave empties, not per negotiator, and only for a
      // wave that stalled: one that produced only turns has nothing to think
      // about.
      if (!wave.size && !stopped && [...stalled.values()].includes(intentId)) startWake(intentId);
    });
  }

  /**
   * Start every negotiation on one signal that is waiting on this seat and has
   * no turn yet.
   *
   * Whoever opened it, an opportunity at turn zero waiting on us moves only
   * because we move it. Each one is briefed by its own run and proposed to,
   * which is why an opening needs no wake: the wake that opened them already
   * started them, and this covers the ones a counterpart opened and anything
   * left unstarted when this process reconnects.
   *
   * @param intentId - The signal whose negotiations to start.
   */
  async function startUnstarted(intentId: string): Promise<void> {
    const [user, open] = await Promise.all([client.me(), client.listNegotiations()]);
    for (const negotiation of open) {
      if (negotiation.intentId !== intentId) continue;
      if (negotiation.awaitingUserId !== user.id || negotiation.turnCount > 0) continue;
      startNegotiate(intentId, negotiation.opportunityId);
    }
  }

  /**
   * A counterpart's turn: take ours back, briefing this one opportunity first
   * if it has never been briefed. No wake.
   *
   * @param intentId - The signal it belongs to.
   * @param opportunityId - The negotiation they moved on.
   */
  function onCounterpartTurn(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    working.add(opportunityId);
    void takeTurn(intent, opportunityId).catch(onError).finally(() => working.delete(opportunityId));
  }

  // Signals already running when this process started are adopted, not woken:
  // their being there is not something that happened.
  let adopted = false;

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
        if (adopted) startWake(row.id);
      }
    }
    adopted = true;
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
        onCounterpartTurn(event.data.intentId, event.data.opportunityId);
        break;
      case "principal.input":
        // The answer is what every stall on this signal was waiting for, and
        // it is the moment a standing question may have died.
        for (const [opportunityId, intentId] of stalled) {
          if (intentId === event.data.intentId) stalled.delete(opportunityId);
        }
        log(`event ${event.type} on ${event.data.intentId}`);
        startWake(event.data.intentId);
        break;
      case "negotiation.opened":
        log(`event ${event.type} on ${event.data.intentId}`);
        void startUnstarted(event.data.intentId).catch(onError);
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

  return {
    wake: startWake,
    stop: () => {
      stopped = true;
      stopStream();
      abort.abort();
    },
  };
}
