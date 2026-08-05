import { describe, expect, it } from 'bun:test';
import { validateNetworkMetadata } from '../network.validation';

describe('validateNetworkMetadata', () => {
  it('passes through arbitrary metadata unchanged', () => {
    const meta = { anything: 'goes', nested: { ok: true } };
    expect(validateNetworkMetadata(meta)).toEqual(meta);
  });

  it('defaults undefined metadata to an empty object', () => {
    expect(validateNetworkMetadata(undefined)).toEqual({});
  });
});
