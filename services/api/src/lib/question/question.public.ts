import type { AdapterPersistedQuestion } from '../../adapters/questioner.adapter';

/**
 * Remove every server-only detection field before a question leaves REST.
 * The same public invariant is applied by MCP's lightweight projection.
 */
export function stripInternalDetection(question: AdapterPersistedQuestion): AdapterPersistedQuestion {
  const {
    pool: _pool,
    recovery: _recovery,
    purpose: _purpose,
    negotiation: _negotiation,
    strategy: _strategy,
    underspecificationType: _underspecificationType,
    pushRequestedAt: _pushRequestedAt,
    pushRecoveryAttemptedAt: _pushRecoveryAttemptedAt,
    pushRequestStatus: _pushRequestStatus,
    pushRequestReason: _pushRequestReason,
    pushRequestSuppressedAt: _pushRequestSuppressedAt,
    push: _push,
    pushedAt: _pushedAt,
    voidedReason: _voidedReason,
    sessionId: _sessionId,
    ...detection
  } = question.detection;
  const publicActors = question.actors.map(({ networkId: _networkId, ...actor }) => actor);
  const strippedActorNetwork = question.actors.some((actor) => actor.networkId !== undefined);
  if (
    !_pool
    && !_recovery
    && !_purpose
    && !_negotiation
    && !_strategy
    && _underspecificationType === undefined
    && !_pushRequestedAt
    && !_pushRecoveryAttemptedAt
    && !_pushRequestStatus
    && !_pushRequestReason
    && !_pushRequestSuppressedAt
    && !_push
    && !_pushedAt
    && !_voidedReason
    && !_sessionId
    && !strippedActorNetwork
  ) return question;
  return { ...question, detection, actors: publicActors };
}
