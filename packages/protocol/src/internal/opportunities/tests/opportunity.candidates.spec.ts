import { describe, expect, it } from 'bun:test';
import { pairKeyOf } from '../opportunity.candidates.js';

describe('pairKeyOf', () => {
  it('is order-independent in the intent pair', () => {
    expect(pairKeyOf('net-1', 'intent-b', 'intent-a'))
      .toBe(pairKeyOf('net-1', 'intent-a', 'intent-b'));
  });

  it('separates the same intent pair in different networks', () => {
    expect(pairKeyOf('net-1', 'intent-a', 'intent-b'))
      .not.toBe(pairKeyOf('net-2', 'intent-a', 'intent-b'));
  });

  it('does not collide when an id contains the separator', () => {
    expect(pairKeyOf('net-1', 'a:b', 'c'))
      .not.toBe(pairKeyOf('net-1', 'a', 'b:c'));
  });
});
