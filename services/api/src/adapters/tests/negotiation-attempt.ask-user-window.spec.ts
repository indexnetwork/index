/**
 * The ask-user answer window is defined twice on purpose: once in the
 * protocol, once in the API's attempt adapter, because adapters may not import
 * @indexnetwork/protocol (eslint boundaries). It used to be read twice from
 * NEGOTIATION_ASK_USER_WINDOW_MS with two independent parsers and two copies of
 * the 24 h default, which could drift silently. This pins them together.
 */
import { describe, expect, it } from 'bun:test';
import { ASK_USER_WINDOW_MS as PROTOCOL_ASK_USER_WINDOW_MS } from '@indexnetwork/protocol';

import { ASK_USER_WINDOW_MS } from '../negotiation-attempt.atomic';

describe('ask-user answer window', () => {
  it('matches the protocol definition', () => {
    expect(ASK_USER_WINDOW_MS).toBe(PROTOCOL_ASK_USER_WINDOW_MS);
  });

  it('is 24 hours', () => {
    expect(ASK_USER_WINDOW_MS).toBe(24 * 60 * 60 * 1000);
  });
});
