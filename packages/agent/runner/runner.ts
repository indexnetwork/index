import type { Index } from "@indexnetwork/client";

import type { Intent, Model, NegotiateHook } from "../src/index.ts";
import { closeInitiation, encodeActions, owedWork, runNegotiate, runWake } from "../src/host.ts";

/** How many times a failed wake is retried before it waits for the next event or restart. */
const WAKE_RETRIES = 3;
/** The first retry's delay; each later one waits that much longer again. */
const WAKE_RETRY_MS = 10_000;

export interface RunnerOptions {
  client: Index;
  model: Model;
  now?: () => Date;
  /** Every wake, turn and stall, as one line. */
  log?: (line: string) => void;
  onError?: (error: unknown) => void;
  /** When set, decides each turn unless it calls `next`. */
  negotiate?: NegotiateHook;
}

export interface Runner {
  /** Wake one intent now, for whatever reason the host has. */
  wake: (intentId: string) => void;
  /** The morning wake for one intent. The host calls these one after another. */
  morning: (intentId: string) => Promise<void>;
  /** Abort in-flight runs and the event stream. There is no restart. */
  stop: () => void;
}

/**
 * Work every active intent this owner has. A wake happens because something
 * changed on the intent, and once each local morning when the host asks.
 *
 * A counterpart's turn is the passive trigger: it briefs that one opportunity
 * if it needs briefing and takes its turn. No sibling is decided. When the
 * negotiations this seat opened since the last summary have all left their
 * opening turn, one summary goes to the principal and one wake decides them.
 *
 * @param options - Index, the model, and where to report.
 * @returns A handle that wakes an intent on demand and stops everything.
 */
export function startRunner(options: RunnerOptions): Runner {
  const { client, model, now = () => new Date(), log = () => {}, onError = () => {}, negotiate } = options;
  const abort = new AbortController();
  const intents = new Map<string, Intent>();
  const waking = new Set<string>();
  const again = new Set<string>();
  /** What the principal wrote while a wake ran, by intent, until a step of it reads it. */
  const inbox = new Map<string, string[]>();
  /** Intents the principal edited since their last wake read them. */
  const edited = new Set<string>();
  /** Opportunities with a negotiator in flight, by intent. */
  const working = new Map<string, string>();
  /** Failed wakes retried so far, by intent. */
  const retries = new Map<string, number>();
  /** Stalls no wake has read yet, by intent: the only ones worth waking for. */
  const unread = new Map<string, string>();
  /** Intents whose initiation check is running, and those that asked for one while it ran. */
  const closing = new Set<string>();
  const resettle = new Set<string>();
  let stopped = false;

  const runtime = () => ({ model, now, signal: abort.signal, log, ...(negotiate ? { negotiate } : {}) });

  /**
   * Wake one intent, coalescing a request that arrives while one is running
   * into a single follow-up.
   *
   * @param intentId - The intent to think about.
   * @param text - A direct message that caused this wake. While a wake runs it is handed to that wake instead of waiting for another.
   * @param options - `edited` when the principal changed what the intent asks for; a wake already running gets a follow-up that knows it.
   */
  function startWake(intentId: string, text?: string, options: { edited?: boolean } = {}): void {
    const intent = intents.get(intentId);
    if (stopped || !intent) return;
    if (options.edited) edited.add(intentId);
    if (waking.has(intentId)) {
      if (text) inbox.set(intentId, [...inbox.get(intentId) ?? [], text]);
      else again.add(intentId);
      return;
    }
    waking.add(intentId);
    const wasEdited = edited.delete(intentId);
    void (async () => {
      // This wake reads every stall standing on the intent, so none of them is
      // a reason to wake again.
      for (const [opportunityId, intent] of unread) if (intent === intentId) unread.delete(opportunityId);
      log(`wake ${intent.statement}`);
      const started = Date.now();
      // Each opportunity opens the moment its own decision is published, so
      // the first turns go out while the wake is still thinking.
      await runWake(client, intent, {
        ...runtime(),
        steer: () => inbox.get(intentId)?.splice(0) ?? [],
        ...(wasEdited ? { edited: true } : {}),
        onNegotiate: (opportunityId) => startNegotiate(intentId, opportunityId),
      });
      retries.delete(intentId);
      log(`  wake done in ${Math.round((Date.now() - started) / 1000)}s`);
    })().catch((error: unknown) => {
      // The retry still owes the edit its read.
      if (wasEdited) edited.add(intentId);
      retry(intentId);
      onError(error);
    }).finally(() => {
      waking.delete(intentId);
      // A message no step read, because the wake was already done with its last one, gets a wake of its own.
      if (inbox.get(intentId)?.length) again.add(intentId);
      inbox.delete(intentId);
      if (again.delete(intentId)) startWake(intentId);
    });
  }

  /**
   * A failed wake leaves what it owed on the conversation, so the wake runs
   * again a few times, further apart each time, then waits for the next event
   * or restart.
   *
   * @param intentId - The intent whose wake failed.
   */
  function retry(intentId: string): void {
    const attempt = (retries.get(intentId) ?? 0) + 1;
    const tell = (text: string) => { void client.sendPrincipal(intentId, encodeActions([{ type: "progress", text }], { counterparts: new Map() })).catch(onError); };
    if (stopped || attempt > WAKE_RETRIES) {
      retries.delete(intentId);
      if (!stopped) tell("Couldn't finish. I'll try again on your next message.");
      return;
    }
    const delay = WAKE_RETRY_MS * attempt;
    retries.set(intentId, attempt);
    log(`wake retry ${attempt} on ${intentId}`);
    tell(`Something went wrong, retrying in ${delay / 1000}s.`);
    setTimeout(() => startWake(intentId), delay).unref?.();
  }

  /**
   * Take up whatever one intent still owes, as Index records it: the wake a
   * stall is waiting on, and the turns nothing is holding.
   *
   * @param intentId - The intent.
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
   * @param intent - The intent this negotiation belongs to.
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
   * @param intentId - The intent that negotiator belonged to.
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
   * @param intentId - The intent.
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
   * One morning wake. Same tools as an event wake. The intent id stays here,
   * so a person it opens takes the negotiator this runner already starts.
   *
   * @param intentId - The intent.
   */
  async function morning(intentId: string): Promise<void> {
    if (stopped) return;
    let intent = intents.get(intentId);
    if (!intent) {
      const rows = await client.listIntents();
      for (const row of rows) {
        if (row.status !== "active") continue;
        intents.set(row.id, { id: row.id, statement: row.statement });
      }
      intent = intents.get(intentId);
    }
    if (!intent) return;
    log(`morning ${intent.statement}`);
    await runWake(client, intent, {
      ...runtime(),
      reason: "morning",
      onNegotiate: (opportunityId) => startNegotiate(intentId, opportunityId),
    });
  }

  /**
   * Work one negotiation, whether a decision authorised it or a counterpart
   * just moved it. A stall still standing on the conversation holds it inside
   * {@link runNegotiate}, so no runtime state can release it early.
   *
   * @param intentId - The intent this negotiation belongs to.
   * @param opportunityId - The negotiation to work.
   */
  function startNegotiate(intentId: string, opportunityId: string): void {
    const intent = intents.get(intentId);
    if (stopped || !intent || working.has(opportunityId)) return;
    working.set(opportunityId, intentId);
    void takeTurn(intent, opportunityId).catch(onError).finally(() => finish(intentId, opportunityId));
  }

  /**
   * Recover every intent with an open negotiation: whatever was opened, moved,
   * stalled or answered while this process was gone, or was in flight when it
   * died.
   */
  async function recoverAll(): Promise<void> {
    const open = await client.listNegotiations();
    for (const intentId of new Set(open.map((negotiation) => negotiation.intentId))) await recover(intentId);
  }

  // Intents already running when this process started are adopted, not woken:
  // their being there is not something that happened.
  let adopted = false;

  async function refresh(): Promise<void> {
    const rows = await client.listIntents();
    const active = new Set<string>();
    log(`read ${rows.length} intents, ${rows.filter((row) => row.status === "active").length} active`);
    for (const row of rows) {
      if (row.status !== "active") continue;
      active.add(row.id);
      const known = intents.has(row.id);
      intents.set(row.id, { id: row.id, statement: row.statement });
      if (!known) {
        log(`intent ${row.id}: ${row.statement}`);
        if (adopted) startWake(row.id);
      }
    }
    adopted = true;
    for (const id of [...intents.keys()]) {
      if (!active.has(id)) {
        intents.delete(id);
        log(`dropped intent ${id}`);
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
        startWake(event.data.intentId, event.data.questionId ? undefined : event.data.text);
        break;
      // The stream is trustworthy from here on, so this is the one moment to
      // recover what happened while it was not. Intents are read first: a
      // negotiation on one this process has never heard of cannot be started.
      case "connected":
        log(`event ${event.type}`);
        void refresh().then(recoverAll).catch(onError);
        break;
      case "intent.created":
        log(`event ${event.type}: ${event.data.intentId}`);
        void refresh().catch(onError);
        break;
      case "intent.updated":
        // An edit to what the intent asks for is context the wake weighs
        // against each paused negotiation; any other refresh is not.
        if (!event.data.material) break;
        log(`event ${event.type}: ${event.data.intentId} edited`);
        void refresh().then(() => startWake(event.data.intentId, undefined, { edited: true })).catch(onError);
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
    morning,
    stop: () => {
      stopped = true;
      stopStream();
      abort.abort();
    },
  };
}
