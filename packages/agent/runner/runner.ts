import type { Index } from "@indexnetwork/client";

import type { Intent, Model } from "../src/index.ts";
import { closeInitiation, owedWork, runNegotiate, runWake } from "../src/host.ts";

/** How many times a failed wake is retried before it waits for the next event or restart. */
const WAKE_RETRIES = 3;
/** The first retry's delay; each later one waits that much longer again. */
const WAKE_RETRY_MS = 30_000;

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
 * A counterpart's turn is the passive trigger: it briefs that one opportunity
 * if it needs briefing and takes its turn. No sibling is decided. When the
 * negotiations this seat opened since the last summary have all left their
 * opening turn, one summary goes to the principal and one wake decides them.
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
  /** Opportunities with a negotiator in flight, by signal. */
  const working = new Map<string, string>();
  /** Failed wakes retried so far, by signal. */
  const retries = new Map<string, number>();
  /** Stalls no wake has read yet, by signal: the only ones worth waking for. */
  const unread = new Map<string, string>();
  /** Signals whose initiation check is running, and those that asked for one while it ran. */
  const closing = new Set<string>();
  const resettle = new Set<string>();
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
      // This wake reads every stall standing on the signal, so none of them is
      // a reason to wake again.
      for (const [opportunityId, signal] of unread) if (signal === intentId) unread.delete(opportunityId);
      log(`wake ${intent.statement}`);
      const started = Date.now();
      // Each opportunity opens the moment its own decision is published, so
      // the first turns go out while the wake is still thinking.
      await runWake(client, intent, { ...runtime(), onNegotiate: (opportunityId) => startNegotiate(intentId, opportunityId) });
      retries.delete(intentId);
      log(`  wake done in ${Math.round((Date.now() - started) / 1000)}s`);
    })().catch((error: unknown) => {
      retry(intentId);
      onError(error);
    }).finally(() => {
      waking.delete(intentId);
      if (again.delete(intentId)) startWake(intentId);
    });
  }

  /**
   * A failed wake leaves what it owed on the conversation, so the wake runs
   * again a few times, further apart each time, then waits for the next event
   * or restart.
   *
   * @param intentId - The signal whose wake failed.
   */
  function retry(intentId: string): void {
    const attempt = (retries.get(intentId) ?? 0) + 1;
    if (stopped || attempt > WAKE_RETRIES) {
      retries.delete(intentId);
      return;
    }
    retries.set(intentId, attempt);
    log(`wake retry ${attempt} on ${intentId}`);
    setTimeout(() => startWake(intentId), WAKE_RETRY_MS * attempt).unref?.();
  }

  /**
   * Take up whatever one signal still owes, as Index records it: the wake a
   * stall is waiting on, and the turns nothing is holding.
   *
   * @param intentId - The signal.
   */
  async function recover(intentId: string): Promise<void> {
    const intent = intents.get(intentId);
    if (stopped || !intent) return;
    const owed = await owedWork(client, intent);
    if (owed.wake) startWake(intentId);
    for (const opportunityId of owed.negotiate) startNegotiate(intentId, opportunityId);
  }

  /**
   * Work one negotiation. A stall stands on the conversation and is recorded
   * here; waking on it is {@link finish}'s call, not this run's.
   *
   * @param intent - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  async function takeTurn(intent: Intent, opportunityId: string): Promise<void> {
    const result = await runNegotiate(client, opportunityId, intent, runtime());
    if ("turn" in result) {
      log(`turn ${result.turn.action} on ${opportunityId}`);
      unread.delete(opportunityId);
      return;
    }
    if ("held" in result) {
      log(`held ${opportunityId}: ${result.held}`);
      return;
    }
    log(`stall on ${opportunityId}: ${result.stall.reason}`);
    unread.set(opportunityId, intent.id);
  }

  /**
   * One negotiator is done. The initiation is read from the database: the
   * negotiations this seat opened since the last summary. While one is still
   * on its opening turn, a stall waits here. When none are, one summary is
   * written and one wake decides the whole set.
   *
   * @param intentId - The signal that negotiator belonged to.
   * @param opportunityId - The negotiation it worked.
   */
  function finish(intentId: string, opportunityId: string): void {
    working.delete(opportunityId);
    void settle(intentId);
  }

  /**
   * Read the initiation and wake once it has finished. A check that arrives
   * while one is running becomes a single follow-up.
   *
   * @param intentId - The signal.
   */
  async function settle(intentId: string): Promise<void> {
    if (stopped) return;
    if (closing.has(intentId)) {
      resettle.add(intentId);
      return;
    }
    closing.add(intentId);
    try {
      const intent = intents.get(intentId);
      if (!intent) return;
      const status = await closeInitiation(client, intent, runtime());
      if (stopped) return;
      const waiting = [...unread.values()].includes(intentId);
      if (status === "done" || (status === "idle" && waiting)) startWake(intentId);
    } catch (error) {
      onError(error);
    } finally {
      closing.delete(intentId);
      if (resettle.delete(intentId) && !stopped) await settle(intentId);
    }
  }

  /**
   * Work one negotiation, whether a decision authorised it or a counterpart
   * just moved it. A stall still standing on the conversation holds it inside
   * {@link runNegotiate}, so no runtime state can release it early.
   *
   * @param intentId - The signal this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  function startNegotiate(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    working.set(opportunityId, intentId);
    void takeTurn(intent, opportunityId).catch(onError).finally(() => finish(intentId, opportunityId));
  }

  /**
   * Recover every signal with an open negotiation: whatever was opened, moved,
   * stalled or answered while this process was gone, or was in flight when it
   * died.
   */
  async function recoverAll(): Promise<void> {
    const open = await client.listNegotiations();
    for (const intentId of new Set(open.map((negotiation) => negotiation.intentId))) await recover(intentId);
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
        startNegotiate(event.data.intentId, event.data.opportunityId);
        break;
      case "principal.input":
        // An answer releases only the stalls its question asked about, which the
        // wake reads from the conversation; anything else they write releases none.
        log(`event ${event.type} on ${event.data.intentId}`);
        startWake(event.data.intentId);
        break;
      // The stream is trustworthy from here on, so this is the one moment to
      // recover what happened while it was not. Signals are read first: a
      // negotiation on one this process has never heard of cannot be started.
      case "connected":
        log(`event ${event.type}`);
        void refresh().then(recoverAll).catch(onError);
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

  return {
    wake: startWake,
    stop: () => {
      stopped = true;
      stopStream();
      abort.abort();
    },
  };
}
