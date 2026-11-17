import { describe, expect, test } from 'bun:test';
import { hexToBytes } from '@noble/hashes/utils.js';
import { finalizeEvent, type NostrEvent } from 'nostr-tools/pure';

import { createAuthTag, parseConditions, principalOf, verifyAttestation } from '../src/attestation.js';
import { generateKeypair } from '../src/keys.js';

// Vectors from Buzz docs/nips/NIP-OA.md.
const OWNER = '79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798';
const VECTOR_EVENT: NostrEvent = {
  id: 'd892a65e7677e0554ebb70ee16deeb6a0727dba46450fb4bc001291d7bff971b',
  pubkey: 'c6047f9441ed7d6d3045406e95c07cd85c778e4b8cef3ca7abac09b95c709ee5',
  created_at: 1713956400,
  kind: 1,
  tags: [['auth', OWNER, 'kind=1&created_at<1713957000', '8b7df2575caf0a108374f8471722b233c53f9ff827a8b0f91861966c3b9dd5cb2e189eae9f49d72187674c2f5bd244145e10ff86c9f257ffe65a1ee5f108b369']],
  content: 'owner-attested agent event',
  sig: '7fd38992b70b5e9e113644e51b4c8ee2227f3bdd402b1855f8786c0600394ab3ec2621742a7bad0b0000b93d4d1ae6e39525f286a3c1029f43f46c3359a6c76f',
};

describe('NIP-OA', () => {
  test('verifies the published signed-event vector', () => {
    expect(verifyAttestation(VECTOR_EVENT)).toEqual({ ok: true, owner: OWNER });
    expect(principalOf(VECTOR_EVENT)).toEqual({ principal: OWNER, agent: VECTOR_EVENT.pubkey });
  });

  test('reproduces the published auth signature', () => {
    const ownerSecret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000001');
    const tag = createAuthTag(ownerSecret, VECTOR_EVENT.pubkey, 'kind=1&created_at<1713957000');
    expect(tag[1]).toBe(OWNER);
    // BIP-340 signatures use aux randomness, so compare by verifying rather than byte-equality.
    const agentSecret = hexToBytes('0000000000000000000000000000000000000000000000000000000000000002');
    const event = finalizeEvent({ kind: 1, created_at: 1713956400, tags: [tag], content: 'x' }, agentSecret);
    expect(verifyAttestation(event)).toEqual({ ok: true, owner: OWNER });
  });

  test('rejects the published invalid vectors', () => {
    expect(parseConditions('kind=1&')).toBeNull();
    expect(parseConditions('kind=01')).toBeNull();
    const twoTags = { ...VECTOR_EVENT, tags: [VECTOR_EVENT.tags[0]!, VECTOR_EVENT.tags[0]!] };
    expect(verifyAttestation(twoTags)).toEqual({ ok: false, reason: 'multiple_auth_tags' });
    const short = { ...VECTOR_EVENT, tags: [VECTOR_EVENT.tags[0]!.slice(0, 3)] };
    expect(verifyAttestation(short)).toEqual({ ok: false, reason: 'malformed_tag' });
  });

  test('enforces conditions and ignores invalid tags for principal', () => {
    const owner = generateKeypair();
    const agent = generateKeypair();
    const tag = createAuthTag(owner.secretKey, agent.pubkey, 'kind=31641');
    const wrongKind = finalizeEvent({ kind: 1, created_at: 1, tags: [tag], content: '' }, agent.secretKey);
    expect(verifyAttestation(wrongKind)).toEqual({ ok: false, reason: 'conditions_not_met' });
    expect(principalOf(wrongKind)).toEqual({ principal: agent.pubkey, agent: null });
    const forged = createAuthTag(generateKeypair().secretKey, agent.pubkey, '');
    forged[1] = owner.pubkey;
    const forgedEvent = finalizeEvent({ kind: 1, created_at: 1, tags: [forged], content: '' }, agent.secretKey);
    expect(verifyAttestation(forgedEvent)).toEqual({ ok: false, reason: 'invalid_signature' });
  });
});
