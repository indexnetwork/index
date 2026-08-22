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

export type { DeadlockShiftRecord } from "./negotiation.deadlock.contracts.js";

// ─── Configuration ───────────────────────────────────────────────────────────

/**
 * Deadlock threshold: 4 consecutive non-convergent turns. Sized
 * against the ambient turn cap (6): an outreach plus 4 unbroken counters
 * leaves exactly the closing turns to draft in the bargaining stance.
 */
export const DEFAULT_DEADLOCK_THRESHOLD = 4;

/**
 * Lower bound on the configurable threshold. Below 2 the "stalemate" signal is
 * meaningless — a single counter is ordinary dialogue, not a deadlock.
 */
export const MIN_DEADLOCK_THRESHOLD = 2;

// ─── Detection ───────────────────────────────────────────────────────────────

/**
 * The locutions that count toward a stalemate: challenges and information
 * requests that keep the dialogue open without converging. Everything else —
 * openings (`outreach`: a fresh case is on the table), terminal
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
  history: ReadonlyArray<{ action?: string }>,
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

// ─── Prompt section (system agent drafting stance) ──────────────────────────

/**
 * Deadlock resolution (IND-611): a stalemate resolves as a stalemate rather
 * than by bargaining. The designed outcome of persistent disagreement is
 * "possibly no match", not "a smaller match". Same trigger, same threshold,
 * same actions — only the drafting stance differs.
 */
const STALEMATE_SHIFT_SECTION = `

DEADLOCK — THE MERITS ARE EXHAUSTED. The last {consecutive} turns were counters/questions without convergence: the merits have been argued and restating them will not move the other side. For this turn, change stance:
- Do NOT re-argue fit or repeat points already made.
- Do NOT buy agreement with a concession or a reduced scope. A shrunken version of a match that could not be agreed on its merits is usually worth less of {userName}'s attention than the full one was, not more.
- Name the ONE specific thing that would genuinely change your assessment. If it has not appeared after this many turns, it is unlikely to.
- Absent that, conclude decisively with a terminal action from your allowed set. An unresolved disagreement is an acceptable outcome; a match made to end the disagreement is not.
This shift changes your stance only — your available actions are unchanged.`;

/**
 * Renders the deadlock-stance prompt section. Returns the empty string when
 * the shift is not active, so the rendered system prompt carries nothing extra
 * on a non-shifted turn (mirrors `renderNegotiatorMemorySection`).
 *
 * A detected deadlock drafts toward stalemate, not bargaining: the designed
 * outcome of persistent disagreement is "possibly no match".
 */
export function renderStalemateShiftSection(input: {
  active: boolean;
  userName: string;
  consecutiveNonConvergent: number;
}): string {
  if (!input.active) return "";
  return STALEMATE_SHIFT_SECTION
    .replace("{consecutive}", String(input.consecutiveNonConvergent))
    .replace(/{userName}/g, input.userName);
}
