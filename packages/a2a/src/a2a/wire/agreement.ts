import type { NegotiationDecision, NegotiationTerms } from "../../core/types.ts";
import { messageToDecision } from "./history.ts";
import type { A2ATask } from "./types.ts";

export type AgreementStatus = "agreed" | "declined" | "open" | "conflict" | "unconfirmed";

/**
 * What evidence the verdict rests on. These aren't strictness levels — they
 * are different kinds of fact about the exchange, so a caller can accept
 * weaker evidence for a low-stakes deal and demand stronger evidence when
 * something irreversible depends on it:
 *
 * - `reference` — the closing move named the `offerId` it accepted. Provenance:
 *   this acceptance binds to that specific offer.
 * - `terms` — the closing moves' structured terms were compared directly, with
 *   no explicit reference between them. Content equality, not provenance.
 * - `state` — from the server-stamped task state alone, with no terms involved
 *   (`declined`/`open`).
 * - `prose` — a text-level comparison. Never produced by `verifyAgreement()`,
 *   which returns `unconfirmed` rather than guess at English; included so a
 *   caller layering its own prose fallback can label it in the same vocabulary.
 *
 * Expect this union to grow — a signed or content-addressed acceptance would
 * arrive as a new basis, not as a change to what `status` means.
 */
export type AgreementBasis = "reference" | "terms" | "state" | "prose";

export interface AgreementResult {
  /**
   * - `agreed` — the closing move bound to a specific offer both sides can point at.
   * - `declined` — the task ended without a deal.
   * - `open` — the negotiation hasn't reached a terminal state yet.
   * - `conflict` — the task completed, but the two sides' closing moves bound
   *   to different terms. Do not act on this as a deal.
   * - `unconfirmed` — the task completed, but nothing structured says *what*
   *   was agreed (prose-only decisions). Verify out of band.
   *
   * `status` means the same thing regardless of how the verdict was reached;
   * read `basis` to see what evidence backs it. A caller wanting only
   * provenance-backed deals checks `status === "agreed" && basis === "reference"`.
   */
  status: AgreementStatus;
  /** What evidence the verdict rests on. */
  basis: AgreementBasis;
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
    return { status: "open", basis: "state", reason: `task is still ${state}` };
  }
  if (state !== "completed") {
    return { status: "declined", basis: "state", reason: `task ended as ${state}` };
  }

  const decisions = decisionsOf(task);
  const closing = decisions.at(-1);
  const previous = decisions.at(-2);

  if (!closing) {
    return {
      status: "unconfirmed",
      basis: "state",
      reason: "task completed with no readable decisions",
    };
  }

  if (closing.acceptsOfferId) {
    const accepted = decisions.find((decision) => decision.offerId === closing.acceptsOfferId);
    if (!accepted) {
      return {
        status: "conflict",
        basis: "reference",
        reason: `closing move accepted offer "${closing.acceptsOfferId}", which appears nowhere in this task`,
      };
    }
    // If the accepting side also restated terms, they must match the offer
    // it named — otherwise it accepted one thing and recorded another.
    if (closing.terms && !sameTerms(closing.terms, accepted.terms)) {
      return {
        status: "conflict",
        basis: "reference",
        reason: "closing move's own terms differ from the offer it accepted",
      };
    }
    return { status: "agreed", basis: "reference", terms: accepted.terms };
  }

  // No explicit reference. If both closing moves put terms on the table and
  // they disagree, that's the two-accepts-different-numbers case.
  if (closing.terms && previous?.terms && !sameTerms(closing.terms, previous.terms)) {
    return {
      status: "conflict",
      basis: "terms",
      reason: "the two closing moves name different terms and neither references the other's offer",
    };
  }

  if (closing.terms) {
    return { status: "agreed", basis: "terms", terms: closing.terms };
  }

  return {
    status: "unconfirmed",
    basis: "state",
    reason:
      "task completed, but no decision carried structured terms — pass DecideOptions.terms to make acceptance verifiable",
  };
}
