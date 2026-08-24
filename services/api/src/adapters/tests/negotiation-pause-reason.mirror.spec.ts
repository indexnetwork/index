import { describe, expect, it } from 'bun:test';
import { NEGOTIATION_PAUSE_REASONS as PROTOCOL_PAUSE_REASONS } from '@indexnetwork/protocol';

import { NEGOTIATION_PAUSE_REASONS } from '../conversation.database.adapter';

/**
 * Adapters may not import from `@indexnetwork/protocol`, so the pause-reason
 * union is copied there. A copy that silently loses a member is not a type
 * error anywhere: the value still flows at runtime, and every consumer
 * downstream renders it as whatever its own default branch says — which is
 * how a failed open reached the web as "the negotiator recommends a decision"
 * and how a `turn_cap` pause was dropped from a thread entirely.
 *
 * Specs may import the protocol, so the drift is pinned here instead.
 */
describe('the adapter mirror of the negotiation pause reasons', () => {
  it('holds exactly what the protocol defines', () => {
    expect([...NEGOTIATION_PAUSE_REASONS].sort()).toEqual([...PROTOCOL_PAUSE_REASONS].sort());
  });
});
