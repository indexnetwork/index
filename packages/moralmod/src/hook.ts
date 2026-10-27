/**
 * The MoralMod NegotiateHook: for ON-arm residents, consult the assessment
 * before the negotiator writes the turn; on any failure, fall back to the
 * plain negotiator and say so in the research record. OFF-arm and unassigned
 * residents pass through untouched.
 */

import type { AssessmentSelection, NegotiateHook, NegotiateInput } from "@indexnetwork/agent";

import { assessmentContext, DEFAULT_BYTE_BUDGET, type AssessmentContext } from "./context.ts";
import { AssessmentError } from "./selection.ts";
import { publicationCheck } from "./publication.ts";
import { Semaphore } from "./semaphore.ts";
import type { AssessmentClient } from "./consult.ts";

export type Arm = "on" | "off" | "shadow";

export type FallbackReason = "deadline" | "unavailable" | "invalid_assessment" | "oversize" | "missing_owner" | "publication_blocked";

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
  at: string;
}

export interface MoralmodHookOptions {
  /** The resident's arm; null for residents outside the study. */
  arm: (userId: string) => Promise<Arm | null>;
  client: AssessmentClient;
  /** The configured selection template, e.g. "aggregate-value-mean-hold-v1". */
  templateId: string;
  deadlineMs: number;
  /** Consults in flight at once per process. */
  maxConcurrent: number;
  /** Research record sink. Failures are the sink's to log; they never lose a turn. */
  emit: (event: TurnExposureEvent) => Promise<void>;
  byteBudget?: number;
  now?: () => Date;
  log?: (line: string) => void;
}

/** The turn packet the assessment models: never the model, signal, evidence, or private intents. */
function packet(input: NegotiateInput): unknown {
  return {
    user: { id: input.user.id, name: input.user.name ?? null },
    intent: input.intent,
    brief: input.brief,
    opportunity: input.opportunity,
  };
}

export function createMoralmodHook(options: MoralmodHookOptions): NegotiateHook {
  const semaphore = new Semaphore(options.maxConcurrent);
  const now = options.now ?? (() => new Date());

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

    let context: AssessmentContext | null = null;
    let fallbackReason: FallbackReason = "deadline";
    try {
      const raw = await semaphore.run(() => options.client.consult(
        { opportunityId: input.opportunity.id, turnIndex: input.opportunity.turnCount ?? input.opportunity.turns?.length ?? 0, ownerUserId: input.user.id, packet: packet(input) },
        { deadlineMs: options.deadlineMs, ...(input.signal ? { signal: input.signal } : {}) },
      ));
      if (raw === null) fallbackReason = "unavailable";
      else context = assessmentContext(raw, options.templateId, input.user.id, options.byteBudget ?? DEFAULT_BYTE_BUDGET);
    } catch (error) {
      if (input.signal?.aborted) throw error;
      if (error instanceof AssessmentError && error.code !== "policy_not_selected") fallbackReason = error.code;
      else fallbackReason = "unavailable";
      options.log?.(`moralmod consult failed (${fallbackReason}): ${String(error)}`);
    }

    if (arm === "shadow") {
      // Stage 0: measure the consult, change nothing.
      void report({ ...base, runId: context?.runId ?? null, outcome: "shadow", at: now().toISOString() });
      return next();
    }

    if (!context) {
      void report({ ...base, runId: null, outcome: "fallback", fallbackReason, at: now().toISOString() });
      return next();
    }

    let selection: AssessmentSelection | undefined;
    const result = await next({
      ...input,
      assessment: {
        text: context.text,
        orderedActionIds: context.orderedActionIds,
        preferredActionId: context.preferredActionId,
        onSelection: (recorded) => { selection = recorded; },
      },
    });

    if ("turn" in result && publicationCheck([result.turn.message], [context.runId]) === "blocked") {
      void report({ ...base, runId: context.runId, outcome: "fallback", fallbackReason: "publication_blocked", ...(selection ? { selection } : {}), at: now().toISOString() });
      return { stall: { reason: "The drafted message failed the private-context guard; nothing was sent." } };
    }
    void report({ ...base, runId: context.runId, outcome: "assessed", ...(selection ? { selection } : {}), at: now().toISOString() });
    return result;
  };
}
