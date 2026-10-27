/**
 * The MoralMod NegotiateHook: for ON-arm residents, consult the assessment
 * before the negotiator writes the turn; on any failure — unavailability, the
 * deadline (which bounds queueing and polling alike), an invalid result, or an
 * assessed run that throws — fall back to the plain negotiator and say so in
 * the research record. Shadow-arm turns never wait: the consult is measured
 * off the turn's critical path. OFF-arm and unassigned residents pass through
 * untouched.
 */

import { createHash } from "node:crypto";

import type { AssessmentSelection, NegotiateHook, NegotiateInput, NegotiateResult } from "@indexnetwork/agent";

import { assessmentContext, canonical, DEFAULT_BYTE_BUDGET, type AssessmentContext } from "./context.ts";
import { AssessmentError } from "./selection.ts";
import { publicationCheck } from "./publication.ts";
import { Semaphore } from "./semaphore.ts";
import type { AssessmentClient } from "./consult.ts";

export type Arm = "on" | "off" | "shadow";

export type FallbackReason = "deadline" | "unavailable" | "invalid_assessment" | "oversize" | "missing_owner" | "publication_blocked" | "error";

/** One ON or shadow turn's research record: moralmod-turn-exposure-1. */
export interface TurnExposureEvent {
  contract: "moralmod-turn-exposure-1";
  opportunityId: string;
  userId: string;
  intentId: string;
  turnCount: number | null;
  arm: "on" | "shadow";
  runId: string | null;
  outcome: "assessed" | "fallback" | "shadow";
  fallbackReason?: FallbackReason;
  selection?: AssessmentSelection;
  /** Consult wall-clock, including any wait for a slot. */
  durationMs?: number;
  at: string;
}

export interface MoralmodHookOptions {
  /** The resident's arm; null for residents outside the study. */
  arm: (userId: string) => Promise<Arm | null>;
  client: AssessmentClient;
  /** The configured selection template, e.g. "aggregate-value-mean-hold-v1". */
  templateId: string;
  /** Bounds the whole consult: waiting for a slot, the run, and polling. */
  deadlineMs: number;
  /** Consults in flight at once per process. */
  maxConcurrent: number;
  /** Research record sink. Failures are the sink's to log; they never lose a turn. */
  emit: (event: TurnExposureEvent) => Promise<void>;
  byteBudget?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The principal must not read assessment mechanics either; a held turn gets plain words. */
const NEUTRAL_STALL_REASON = "This opportunity is held for your guidance: the options are too close to choose between on the brief alone.";

/** The turn packet the assessment models: never the model, signal, evidence, or private intents. */
function packet(input: NegotiateInput): unknown {
  return {
    user: { id: input.user.id, name: input.user.name ?? null },
    intent: input.intent,
    brief: input.brief,
    opportunity: input.opportunity,
  };
}

interface Consulted {
  context: AssessmentContext | null;
  fallbackReason: FallbackReason;
  durationMs: number;
  aborted?: unknown;
}

export function createMoralmodHook(options: MoralmodHookOptions): NegotiateHook {
  const semaphore = new Semaphore(options.maxConcurrent);
  const now = options.now ?? (() => new Date());

  /** Run the consult under the slot limit, the whole thing bounded by the deadline. */
  async function consult(input: NegotiateInput): Promise<Consulted> {
    const started = Date.now();
    const until = started + options.deadlineMs;
    const turnIndex = input.opportunity.turnCount ?? input.opportunity.turns?.length ?? 0;
    const source = packet(input);
    const sourceDigest = createHash("sha256").update(canonical(source)).digest("hex").slice(0, 16);
    let expire: ReturnType<typeof setTimeout> | undefined;
    const expired = new Promise<"expired">((resolve) => { expire = setTimeout(() => resolve("expired"), options.deadlineMs); });
    try {
      const work = semaphore.run(async () => {
        const remaining = until - Date.now();
        if (remaining <= 0) return null;
        return options.client.consult(
          { opportunityId: input.opportunity.id, turnIndex, ownerUserId: input.user.id, sourceDigest, packet: source },
          { deadlineMs: remaining, ...(input.signal ? { signal: input.signal } : {}) },
        );
      });
      // The queued work keeps its slot discipline; a raced-out consult sees the
      // expired deadline when its slot finally arrives and returns fast.
      work.catch(() => {});
      const raw = await Promise.race([work, expired]);
      const durationMs = Date.now() - started;
      if (raw === "expired" || raw === null) {
        return { context: null, fallbackReason: Date.now() >= until ? "deadline" : "unavailable", durationMs };
      }
      return {
        context: assessmentContext(raw, options.templateId, input.user.id, options.byteBudget ?? DEFAULT_BYTE_BUDGET),
        fallbackReason: "unavailable",
        durationMs,
      };
    } catch (error) {
      const durationMs = Date.now() - started;
      if (input.signal?.aborted) return { context: null, fallbackReason: "unavailable", durationMs, aborted: error };
      const reason: FallbackReason = error instanceof AssessmentError && error.code !== "policy_not_selected" ? error.code : "unavailable";
      options.log?.(`moralmod consult failed (${reason}): ${String(error)}`);
      return { context: null, fallbackReason: reason, durationMs };
    } finally {
      clearTimeout(expire);
    }
  }

  return async (input, next) => {
    const arm = await options.arm(input.user.id).catch(() => null);
    if (arm !== "on" && arm !== "shadow") return next();

    const base = {
      contract: "moralmod-turn-exposure-1" as const,
      opportunityId: input.opportunity.id,
      userId: input.user.id,
      intentId: input.intent.id,
      turnCount: input.opportunity.turnCount ?? input.opportunity.turns?.length ?? null,
      arm,
    };
    const report = (event: TurnExposureEvent) => options.emit(event).catch((error) => {
      options.log?.(`moralmod exposure emit failed: ${String(error)}`);
    });

    if (arm === "shadow") {
      // Stage 0: measure the consult off the critical path; the turn never waits.
      void consult(input).then((measured) => report({
        ...base,
        runId: measured.context?.runId ?? null,
        outcome: "shadow",
        ...(measured.context ? {} : { fallbackReason: measured.fallbackReason }),
        durationMs: measured.durationMs,
        at: now().toISOString(),
      })).catch(() => {});
      return next();
    }

    const consulted = await consult(input);
    if (consulted.aborted !== undefined) throw consulted.aborted;
    const { context, durationMs } = consulted;

    if (!context) {
      void report({ ...base, runId: null, outcome: "fallback", fallbackReason: consulted.fallbackReason, durationMs, at: now().toISOString() });
      return next();
    }

    let selection: AssessmentSelection | undefined;
    let result: NegotiateResult;
    try {
      result = await next({
        ...input,
        assessment: {
          text: context.text,
          orderedActionIds: context.orderedActionIds,
          preferredActionId: context.preferredActionId,
          onSelection: (recorded) => { selection = recorded; },
        },
      });
    } catch (error) {
      if (input.signal?.aborted) throw error;
      // An assessed run that the provider or decorator refuses must not cost the
      // resident their turn: record it and take the plain path.
      options.log?.(`moralmod assessed run failed: ${String(error)}`);
      void report({ ...base, runId: context.runId, outcome: "fallback", fallbackReason: "error", durationMs, at: now().toISOString() });
      return next();
    }

    if ("turn" in result && publicationCheck([result.turn.message], [context.runId]) === "blocked") {
      void report({ ...base, runId: context.runId, outcome: "fallback", fallbackReason: "publication_blocked", ...(selection ? { selection } : {}), durationMs, at: now().toISOString() });
      return { stall: { reason: "The drafted message failed the private-context guard; nothing was sent." } };
    }
    if ("stall" in result) {
      // Stall text reaches the principal; it must be as clean as a turn.
      const ask = result.stall.suggestedAsk;
      result = {
        stall: {
          reason: publicationCheck([result.stall.reason], [context.runId]) === "blocked" ? NEUTRAL_STALL_REASON : result.stall.reason,
          ...(ask && publicationCheck([ask], [context.runId]) === "passed" ? { suggestedAsk: ask } : {}),
        },
      };
    }
    void report({ ...base, runId: context.runId, outcome: "assessed", ...(selection ? { selection } : {}), durationMs, at: now().toISOString() });
    return result;
  };
}
