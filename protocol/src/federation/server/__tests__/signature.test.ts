import { describe, it, expect } from 'bun:test';
import { generateKeyPair, signRequest, verifyRequest } from '../signature';

describe('HTTP Signatures', () => {
  it('generates a key pair', async () => {
    const keys = await generateKeyPair();
    expect(keys.publicKeyPem).toContain('BEGIN PUBLIC KEY');
    expect(keys.privateKeyPem).toContain('BEGIN PRIVATE KEY');
  });

  it('signs and verifies a request', async () => {
    const keys = await generateKeyPair();
    const url = 'https://node-b.com/api/federation/indexes/123/intents';
    const method = 'POST';
    const body = JSON.stringify({ actor: 'https://node-a.com/users/alice', payload: 'test' });

    const headers = signRequest({ method, url, body, privateKeyPem: keys.privateKeyPem, keyId: 'https://node-a.com#main-key' });

    expect(headers['Signature']).toBeDefined();
    expect(headers['Digest']).toBeDefined();

    const valid = verifyRequest({
      method,
      url,
      headers,
      body,
      publicKeyPem: keys.publicKeyPem,
    });
    expect(valid).toBe(true);
  });

  it('rejects tampered body', async () => {
    const keys = await generateKeyPair();
    const url = 'https://node-b.com/api/federation/indexes/123/intents';
    const method = 'POST';
    const body = JSON.stringify({ payload: 'original' });

    const headers = signRequest({ method, url, body, privateKeyPem: keys.privateKeyPem, keyId: 'https://node-a.com#main-key' });

    const valid = verifyRequest({
      method,
      url,
      headers,
      body: JSON.stringify({ payload: 'tampered' }),
      publicKeyPem: keys.publicKeyPem,
    });
    expect(valid).toBe(false);
  });
});
