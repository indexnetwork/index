/**
 * Deadlock detection + persuasion→bargaining mode shift (IND-428, backlog item 6).
 *
 * Grounding: Wells & Reed (2006), *Knowing When to Bargain* — a persuasion
 * dialogue (arguing the merits) that reaches a stalemate may execute a *legal
 * shift* into a negotiation dialogue (offering concessions). See
 * `docs/design/negotiation-dialogue-game.md` for the formal framing of the
 * turn protocol as a dialogue game.
 *
 * Design constraints (hard):
 * - **Deterministic**: deadlock is decided by pure inspection of the persisted
 *   turn history — never by an LLM.
 * - **Stance, not rules**: a detected deadlock changes the system agent's
 *   *drafting stance* only. Locutions, seat vocabularies (`allowedActionsFor`),
 *   termination, and turn-cap semantics are untouched.
 * - **Default-off**: gated on `NEGOTIATION_DEADLOCK_SHIFT_ENABLED === "true"`
 *   (strict literal) and applied only to v2 negotiations, checked alongside the
 *   protocol-version plumbing. When off, the legacy path is byte-identical.
 * - **Fail-open**: any detection error means "no deadlock" — advisory
 *   infrastructure never blocks a negotiation.
 */
import type { NegotiationTurn } from "./negotiation.state.js";

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Whether the deadlock→bargaining mode shift is enabled, from the
 * `NEGOTIATION_DEADLOCK_SHIFT_ENABLED` env switch. Strict literal `"true"`
 * only — the deployment is byte-for-byte unchanged until the flag is flipped,
 * and rolling back is the same single switch.
 */
export function configuredDeadlockShiftEnabled(): boolean {
  return process.env.NEGOTIATION_DEADLOCK_SHIFT_ENABLED === "true";
}

/**
 * Default deadlock threshold: 4 consecutive non-convergent turns. Sized
 * against the ambient turn cap (6): an outreach plus 4 unbroken counters
 * leaves exactly the closing turns to draft in the bargaining stance.
 */
export const DEFAULT_DEADLOCK_THRESHOLD = 4;

/**
 * Lower bound on the configurable threshold. Below 2 the "stalemate" signal is
 * meaningless — a single counter is ordinary dialogue, not a deadlock.
 */
export const MIN_DEADLOCK_THRESHOLD = 2;

/**
 * Consecutive non-convergent turns that constitute a deadlock, from
 * `NEGOTIATION_DEADLOCK_THRESHOLD`. Must be an integer >= 2; invalid,
 * non-integer, or out-of-range values fall back to the default (fail-open
 * toward the documented behavior, mirroring `askUserAnswerWindowMs`).
 */
export function configuredDeadlockThreshold(): number {
  const raw = process.env.NEGOTIATION_DEADLOCK_THRESHOLD;
  if (raw) {
    const parsed = Number(raw);
    if (Number.isInteger(parsed) && parsed >= MIN_DEADLOCK_THRESHOLD) return parsed;
  }
  return DEFAULT_DEADLOCK_THRESHOLD;
}

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * The locutions that count toward a stalemate: challenges and information
 * requests that keep the dialogue open without converging. Everything else —
 * openings (`propose`/`outreach`: a fresh case is on the table), terminal
 * actions (the game is deciding, not stalling), and `ask_user` (new principal
 * input is about to arrive) — RESETS the run to zero. Unknown/missing actions
 * also reset (conservative: never manufacture a deadlock from unreadable data).
 */
const NON_CONVERGENT_ACTIONS: ReadonlySet<string> = new Set(["counter", "question"]);

export interface DeadlockAssessment {
  /** True when the trailing non-convergent run has reached the threshold. */
  deadlocked: boolean;
  /** Length of the maximal trailing run of counter/question turns. */
  consecutiveNonConvergent: number;
  /** The threshold the run was compared against. */
  threshold: number;
}

/**
 * Deterministic stalemate detector: measures the maximal *trailing* run of
 * non-convergent turns (`counter`/`question`) in the persisted history and
 * compares it against the threshold. Continuation histories are included by
 * construction — the caller passes the full turn list, so a deadlock spanning
 * sessions still counts.
 *
 * Pure state inspection; no LLM, no I/O, no clock.
 */
export function assessDeadlock(
  history: ReadonlyArray<Pick<NegotiationTurn, "action">>,
  threshold: number = DEFAULT_DEADLOCK_THRESHOLD,
): DeadlockAssessment {
  const effectiveThreshold = Number.isInteger(threshold) && threshold >= MIN_DEADLOCK_THRESHOLD
    ? threshold
    : DEFAULT_DEADLOCK_THRESHOLD;

  let run = 0;
  for (let i = history.length - 1; i >= 0; i--) {
    const action = history[i]?.action;
    if (typeof action === "string" && NON_CONVERGENT_ACTIONS.has(action)) {
      run += 1;
    } else {
      break;
    }
  }

  return {
    deadlocked: run >= effectiveThreshold,
    consecutiveNonConvergent: run,
    threshold: effectiveThreshold,
  };
}

// ─── Internal shift record (task metadata JSONB, never public) ──────────────

/**
 * Analytical record of an applied shift, persisted to
 * `tasks.metadata.deadlockShift` via the optional `setTaskDeadlockShift`
 * database hook. Internal-only: negotiation API surfaces project specific
 * fields and never return task metadata verbatim (same privacy posture as
 * `metadata.screenDecision` and the QUD/uptake detection metadata).
 */
export interface DeadlockShiftRecord {
  reason: "consecutive_non_convergent";
  consecutiveNonConvergent: number;
  threshold: number;
  /** Zero-based session turn index at which the shifted draft happened. */
  shiftedAtTurn: number;
  seat: "initiator" | "counterparty";
  detectedAt: string;
}

// ─── Prompt section (system agent drafting stance) ──────────────────────────

const BARGAINING_SHIFT_SECTION = `

DEADLOCK — SHIFT FROM PERSUASION TO BARGAINING. The last {consecutive} turns were counters/questions without convergence: the merits have been argued and restating them will not move the other side. For this turn, change stance:
- Do NOT re-argue fit or repeat points already made.
- Offer a concrete concession or scope reduction instead: a smaller first step (a single intro call, a scoped trial, a narrower version of the collaboration), dropping a contested requirement, or a trade on a dimension not yet contested.
- Make the remaining objection priceable: name the specific smaller commitment that would resolve it.{askUserEscalation}
- If no reduced scope would genuinely serve {userName}'s interests, conclude decisively with a terminal action from your allowed set rather than another repetitive counter.
This shift changes your stance only — your available actions are unchanged.`;

const BARGAINING_ASK_USER_ESCALATION = `
- If a concession would require {userName}'s own input or permission (budget, availability, private details), escalate with "ask_user" instead of guessing.`;

/**
 * Renders the bargaining-stance prompt section. Returns the empty string when
 * the shift is not active, so the rendered system prompt is byte-identical to
 * the legacy build on every non-shifted turn (mirrors
 * `renderNegotiatorMemorySection`). The `ask_user` escalation line renders
 * only when the caller already legally holds the action (`canAskUser`) — the
 * shift never invents a locution.
 */
export function renderBargainingShiftSection(input: {
  active: boolean;
  userName: string;
  canAskUser: boolean;
  consecutiveNonConvergent: number;
}): string {
  if (!input.active) return "";
  return BARGAINING_SHIFT_SECTION
    .replace("{consecutive}", String(input.consecutiveNonConvergent))
    .replace("{askUserEscalation}", input.canAskUser ? BARGAINING_ASK_USER_ESCALATION : "")
    .replace(/{userName}/g, input.userName);
}
