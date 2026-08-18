/**
 * "Asking you first" — the radar's projection of a pre-contact consultation.
 *
 * The turn-0 third verdict (#1445) parks the negotiation `input_required`
 * before any contact: the counterparty has never been written to, and the
 * whole record is the initiator's own question, sitting in the signal's DM.
 * The opportunity is `negotiating` throughout — the status flips when the
 * negotiation task is created, one step ahead of the opening turn — so the
 * radar renders such a match as an ordinary in-flight negotiation ("your
 * agent is still talking with theirs", "no action needed yet"), which is
 * exactly backwards: nothing was said, and the only thing the negotiation is
 * waiting for is the viewer.
 *
 * This module derives that state from the park itself. Nothing new is stored:
 * a park is one `input_required` negotiation task, and it stops being one the
 * moment the answer or the expiry resumes it — so the card appears and
 * disappears with the park with no lifecycle of its own.
 *
 * Recognition is NOT restated here. {@link countOpenPreContactConsults} is
 * #1445's own predicate — the one the per-signal cap counts with — applied to
 * a single task: it is what asserts the `input_required` state, the
 * `preContactConsult` stamp on the park's turn context, and the ask-user
 * binding naming this exact viewer/signal pair. Running the same function
 * both places is what keeps the radar from claiming a park the negotiator
 * would not count, or missing one it would.
 *
 * The viewer/recipient equality is also the privacy boundary: a pre-contact
 * park is one agent's private doubt about a counterparty who was never
 * contacted, and the binding's `recipientUserId` is the only user entitled to
 * see it (the same rule `projectOwnerScreenDecision` enforces for the PASSED
 * card). Since the predicate is given the viewer as its scope, a park bound to
 * anyone else cannot survive it.
 */
import { countOpenPreContactConsults, truncateAtBoundary, type PreContactConsultTaskRow } from '@indexnetwork/protocol';

/** Longest `whatFit` line the card carries; the rest is the DM's job. */
const WHAT_FIT_MAX_CHARS = 240;

/**
 * The radar's "asking you first" state for one opportunity. Everything here
 * is read off the park's own turn context — no message reads, no new columns.
 */
export interface AskingFirstRadarState {
  /**
   * The viewer's signal whose DM holds the question. The card deep-links to
   * `/i/:intentId`, the same address the question notification uses, because
   * the DM is the only surface that answers.
   */
  intentId: string;
  /** Closed consultation category from the park (`unresolved_owner_constraint`). */
  reason?: string;
  /** What the agent saw in this match, from the park's seed assessment. */
  whatFit?: string;
  /** When the park landed, ISO-8601. */
  askedAt?: string;
}

/**
 * The negotiation-task read path the projection needs: exactly
 * `ConversationDatabaseAdapter.getTasksForUser`, which is also where #1445's
 * cap reads its parks from. Declared structurally so the radar test can supply
 * rows without a database.
 */
export interface AskingFirstTaskReader {
  getTasksForUser(
    userId: string,
    options?: { state?: string },
  ): Promise<Array<PreContactConsultTaskRow & { updatedAt?: Date }>>;
}

function readRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readText(value: unknown): string | undefined {
  const text = typeof value === 'string' ? value.trim() : '';
  return text === '' ? undefined : text;
}

/**
 * Pure classification: the viewer's pre-contact parks, keyed by opportunity.
 *
 * Tasks that are not parks — anything not `input_required`, a mid-flight
 * consult (no stamp: the counterparty has been contacted, so the card would be
 * a lie), a park bound to the other side, a resumed or expired park — do not
 * appear, which is how a passed, negotiating, or pending opportunity stays
 * exactly what it was.
 *
 * When two parks somehow name one opportunity, the first wins: the tasks
 * arrive newest-first, and a card can only carry one question anyway.
 */
export function collectAskingFirstStates(
  tasks: ReadonlyArray<PreContactConsultTaskRow & { updatedAt?: Date }>,
  viewerUserId: string,
): Map<string, AskingFirstRadarState> {
  const states = new Map<string, AskingFirstRadarState>();
  if (!viewerUserId) return states;

  for (const task of tasks) {
    const turnContext = readRecord(task.metadata?.turnContext);
    const binding = readRecord(turnContext?.askUserBinding);
    const intentId = readText(binding?.recipientIntentId);
    const opportunityId = readText(binding?.opportunityId);
    if (!intentId || !opportunityId || states.has(opportunityId)) continue;

    // #1445's own predicate, over this one task: the stamp, the state, and the
    // recipient pair in a single check.
    if (countOpenPreContactConsults([task], { userId: viewerUserId, intentId }) !== 1) continue;

    const whatFit = readText(readRecord(turnContext?.seedAssessment)?.reasoning);
    states.set(opportunityId, {
      intentId,
      ...(readText(turnContext?.consultationPolicyReason)
        ? { reason: readText(turnContext?.consultationPolicyReason)! }
        : {}),
      ...(whatFit ? { whatFit: truncateAtBoundary(whatFit, WHAT_FIT_MAX_CHARS) } : {}),
      ...(task.updatedAt instanceof Date && !Number.isNaN(task.updatedAt.getTime())
        ? { askedAt: task.updatedAt.toISOString() }
        : {}),
    });
  }
  return states;
}

/**
 * Reads the viewer's open pre-contact parks. One indexed task query per radar
 * fetch, scoped to `input_required` — the same query #1445's cap runs.
 */
export async function readAskingFirstStates(
  reader: AskingFirstTaskReader,
  viewerUserId: string,
): Promise<Map<string, AskingFirstRadarState>> {
  const parked = await reader.getTasksForUser(viewerUserId, { state: 'input_required' });
  return collectAskingFirstStates(parked, viewerUserId);
}
