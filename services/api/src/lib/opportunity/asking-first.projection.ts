/**
 * "Asking you first" — the radar's projection of a pre-contact consultation.
 *
 * RETIRED by the negotiation-graph rewrite (#1494, docs/plans/2026-08-23-
 * personal-agent-and-negotiation-graphs.md). The turn-0 third verdict
 * (#1445) this module projected depended on a negotiation task being able to
 * sit `input_required` before any contact, stamped `preContactConsult` on a
 * park's turn context. Under the new `working | paused | completed`
 * lifecycle there is no `input_required` state and no turn-context park to
 * read: a negotiation that cannot proceed without the principal pauses
 * `needs_principal` instead, and nothing analogous to the pre-contact stamp
 * exists yet. `countOpenPreContactConsults` and `PreContactConsultTaskRow`
 * are gone from the protocol package accordingly.
 *
 * There is currently no replacement signal to project this state from, so
 * this module always reports no pre-contact consults — state the break: the
 * radar no longer distinguishes a pre-contact "asking you first" card from
 * an ordinary in-flight negotiation. Reintroducing that distinction is a
 * question for the AgentGraph step of the rewrite (IS-A's `needs_principal`
 * handling), not this one.
 */

/**
 * The radar's "asking you first" state for one opportunity. Kept as the
 * shape callers (`OpportunityService.decorateWithAskingFirst`) still
 * annotate cards with; nothing currently produces one.
 */
export interface AskingFirstRadarState {
  intentId: string;
  reason?: string;
  whatFit?: string;
  askedAt?: string;
}

/**
 * The negotiation-task read path the projection used to need. Declared
 * structurally so `ConversationDatabaseAdapter.getTasksForUser` still
 * satisfies it; unused by the retired body below.
 */
export interface AskingFirstTaskReader {
  getTasksForUser(
    userId: string,
    options?: { state?: string },
  ): Promise<Array<{ id: string; metadata: Record<string, unknown> | null; updatedAt?: Date }>>;
}

/**
 * Pure classification: the viewer's pre-contact parks, keyed by opportunity.
 *
 * Always empty (see file header): there is no `input_required` pre-contact
 * park under the new `working | paused | completed` lifecycle to classify.
 */
export function collectAskingFirstStates(
  _tasks: ReadonlyArray<{ id: string; metadata: Record<string, unknown> | null; updatedAt?: Date }>,
  _viewerUserId: string,
): Map<string, AskingFirstRadarState> {
  return new Map();
}

/**
 * Reads the viewer's open pre-contact parks. Always empty (see file header).
 */
export async function readAskingFirstStates(
  _reader: AskingFirstTaskReader,
  _viewerUserId: string,
): Promise<Map<string, AskingFirstRadarState>> {
  return new Map();
}
