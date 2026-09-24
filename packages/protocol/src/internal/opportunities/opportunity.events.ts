/** Append-only opportunity facts. The row status is a projection of these. */
export type OpportunityEventType = 'opened' | 'agreed' | 'committed' | 'declined' | 'expired';

export interface OpportunityLogEvent {
  type: OpportunityEventType;
  /** Set only for `committed`. */
  actorUserId: string | null;
}

export type OpportunityProjectionStatus = 'negotiating' | 'pending' | 'accepted' | 'rejected' | 'expired';

export interface OpportunityProjection {
  status: OpportunityProjectionStatus;
  committedActorIds: string[];
}

const TERMINAL: ReadonlySet<OpportunityProjectionStatus> = new Set(['accepted', 'rejected', 'expired']);

interface FoldState extends OpportunityProjection {
  opened: boolean;
}

const EMPTY: FoldState = { status: 'negotiating', committedActorIds: [], opened: false };

function visible(state: FoldState): OpportunityProjection {
  return { status: state.status, committedActorIds: state.committedActorIds };
}

export type OpportunityAdmission =
  | { ok: true; projection: OpportunityProjection; introduction: boolean }
  | { ok: false; error: string };

/**
 * Fold an opportunity's event log into the status readers filter on.
 *
 * @param events - Log order, oldest first. The first event is `opened`.
 * @param actorIds - Distinct named humans on the opportunity.
 * @returns The projected status. A log that breaks the admission rules throws.
 */
export function projectOpportunity(events: OpportunityLogEvent[], actorIds: string[]): OpportunityProjection {
  return visible(events.reduce<FoldState>((projection, event) => {
    const next = applyEvent(projection, actorIds, event);
    if (!next.ok) throw new Error(next.error);
    return next.state;
  }, EMPTY));
}

/**
 * Decide whether one event may be appended, and what the row becomes.
 *
 * @param events - Events already stored, oldest first.
 * @param actorIds - Distinct named humans on the opportunity.
 * @param event - The event to append.
 * @returns The next projection, or why the event is illegal. `introduction` is
 *   true only when this commit is the one that completes the set.
 */
export function admitOpportunityEvent(
  events: OpportunityLogEvent[],
  actorIds: string[],
  event: OpportunityLogEvent,
): OpportunityAdmission {
  let state = EMPTY;
  for (const existing of events) {
    const step = applyEvent(state, actorIds, existing);
    if (!step.ok) return step;
    state = step.state;
  }
  const admitted = applyEvent(state, actorIds, event);
  if (!admitted.ok) return admitted;
  return { ok: true, introduction: admitted.introduction, projection: visible(admitted.state) };
}

function applyEvent(
  projection: FoldState,
  actorIds: string[],
  event: OpportunityLogEvent,
): { ok: true; state: FoldState; introduction: boolean } | { ok: false; error: string } {
  if (event.type === 'opened') {
    if (projection.opened) return { ok: false, error: 'This opportunity is already open.' };
    return { ok: true, introduction: false, state: { ...EMPTY, opened: true } };
  }
  if (!projection.opened) return { ok: false, error: 'This opportunity is not open.' };
  if (TERMINAL.has(projection.status)) {
    return { ok: false, error: 'This opportunity can no longer change.' };
  }
  if (event.type === 'agreed') {
    if (projection.status !== 'negotiating') return { ok: false, error: 'Agents have not agreed yet.' };
    return { ok: true, introduction: false, state: { ...projection, status: 'pending' } };
  }
  if (event.type === 'declined' || event.type === 'expired') {
    if (projection.status !== 'negotiating' && projection.status !== 'pending') {
      return { ok: false, error: 'This opportunity can no longer change.' };
    }
    return {
      ok: true,
      introduction: false,
      state: {
        opened: true,
        status: event.type === 'declined' ? 'rejected' : 'expired',
        committedActorIds: projection.committedActorIds,
      },
    };
  }
  if (projection.status !== 'pending') return { ok: false, error: 'Agents have not agreed yet.' };
  const actorUserId = event.actorUserId;
  if (!actorUserId || !actorIds.includes(actorUserId)) {
    return { ok: false, error: 'You are not part of this opportunity.' };
  }
  if (projection.committedActorIds.includes(actorUserId)) {
    return { ok: false, error: 'You have already acted on this opportunity.' };
  }
  const committedActorIds = [...projection.committedActorIds, actorUserId];
  const distinct = [...new Set(actorIds)];
  const complete = distinct.length > 0 && distinct.every((id) => committedActorIds.includes(id));
  return {
    ok: true,
    introduction: complete,
    state: {
      opened: true,
      status: complete ? 'accepted' : 'pending',
      committedActorIds,
    },
  };
}
