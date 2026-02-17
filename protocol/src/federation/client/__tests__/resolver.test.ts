import { describe, it, expect } from 'bun:test';
import { Resolver } from '../resolver';

describe('Resolver', () => {
  const resolver = new Resolver('https://my-node.com');

  it('identifies local URLs', () => {
    expect(resolver.isLocal('https://my-node.com/users/abc')).toBe(true);
    expect(resolver.isLocal('https://my-node.com/indexes/xyz')).toBe(true);
  });

  it('identifies remote URLs', () => {
    expect(resolver.isLocal('https://other-node.com/users/abc')).toBe(false);
  });

  it('extracts node base URL from entity URL', () => {
    expect(resolver.nodeBaseUrl('https://node-b.com/indexes/xyz')).toBe('https://node-b.com');
  });

  it('extracts resource path from entity URL', () => {
    expect(resolver.resourcePath('https://node-b.com/indexes/xyz')).toBe('/indexes/xyz');
  });
});
