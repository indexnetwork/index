import type { NegotiationDecision, NegotiationTerms } from "../../core/types.ts";
import { messageToDecision } from "./history.ts";
import type { A2ATask } from "./types.ts";

export type AgreementStatus = "agreed" | "declined" | "open" | "conflict" | "unconfirmed";

export interface AgreementResult {
  /**
   * - `agreed` — the closing move bound to a specific offer both sides can point at.
   * - `declined` — the task ended without a deal.
   * - `open` — the negotiation hasn't reached a terminal state yet.
   * - `conflict` — the task completed, but the two sides' closing moves bound
   *   to different terms. Do not act on this as a deal.
   * - `unconfirmed` — the task completed, but nothing structured says *what*
   *   was agreed (prose-only decisions). Verify out of band.
   */
  status: AgreementStatus;
  /** The agreed terms, when `status` is `agreed`. */
  terms?: NegotiationTerms;
  /** Human-readable explanation, for the non-`agreed` outcomes. */
  reason?: string;
}

function decisionsOf(task: A2ATask): NegotiationDecision[] {
  return task.history
    .map((message) => messageToDecision(message))
    .filter((decision): decision is NegotiationDecision => decision !== null);
}

function sameTerms(a: NegotiationTerms | undefined, b: NegotiationTerms | undefined): boolean {
  if (!a || !b) return false;
  return canonicalize(a) === canonicalize(b);
}

/** Order-independent JSON rendering, so two sides comparing the same terms
 * object reach the same string regardless of key order. */
function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  return `{${entries.map(([key, entryValue]) => `${JSON.stringify(key)}:${canonicalize(entryValue)}`).join(",")}}`;
}

/**
 * Reports what a task actually settled on, from the task itself rather than
 * from either side's self-reported action — both sides run this over the
 * same Task and reach the same verdict.
 *
 * The A2A spec makes the server-stamped `task.status.state` the single
 * authority on whether a negotiation ended, but it says nothing about *what*
 * was agreed. That's what `terms`/`offerId`/`acceptsOfferId` on a
 * `NegotiationDecision` are for: an accepting move that names the offer it
 * binds to can be checked, where two prose "accept"s naming different
 * numbers cannot.
 */
export function verifyAgreement(task: A2ATask): AgreementResult {
  const state = task.status.state;

  if (state === "submitted" || state === "working" || state === "input-required") {
    return { status: "open", reason: `task is still ${state}` };
  }
  if (state !== "completed") {
    return { status: "declined", reason: `task ended as ${state}` };
  }

  const decisions = decisionsOf(task);
  const closing = decisions.at(-1);
  const previous = decisions.at(-2);

  if (!closing) {
    return { status: "unconfirmed", reason: "task completed with no readable decisions" };
  }

  if (closing.acceptsOfferId) {
    const accepted = decisions.find((decision) => decision.offerId === closing.acceptsOfferId);
    if (!accepted) {
      return {
        status: "conflict",
        reason: `closing move accepted offer "${closing.acceptsOfferId}", which appears nowhere in this task`,
      };
    }
    // If the accepting side also restated terms, they must match the offer
    // it named — otherwise it accepted one thing and recorded another.
    if (closing.terms && !sameTerms(closing.terms, accepted.terms)) {
      return {
        status: "conflict",
        reason: "closing move's own terms differ from the offer it accepted",
      };
    }
    return { status: "agreed", terms: accepted.terms };
  }

  // No explicit reference. If both closing moves put terms on the table and
  // they disagree, that's the two-accepts-different-numbers case.
  if (closing.terms && previous?.terms && !sameTerms(closing.terms, previous.terms)) {
    return {
      status: "conflict",
      reason: "the two closing moves name different terms and neither references the other's offer",
    };
  }

  if (closing.terms) {
    return { status: "agreed", terms: closing.terms };
  }

  return {
    status: "unconfirmed",
    reason:
      "task completed, but no decision carried structured terms — pass DecideOptions.terms to make acceptance verifiable",
  };
}
