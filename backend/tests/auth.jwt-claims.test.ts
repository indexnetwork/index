import { describe, it, expect } from 'bun:test';
import {
  generateKeyPair,
  SignJWT,
  createLocalJWKSet,
  exportJWK,
  jwtVerify,
  errors as joseErrors,
} from 'jose';

import { BASE_URL, JWT_AUDIENCE } from '../src/lib/betterauth/betterauth';

async function makeTestJWKS() {
  const { privateKey, publicKey } = await generateKeyPair('RS256');
  const jwk = await exportJWK(publicKey);
  const JWKS = createLocalJWKSet({ keys: [{ ...jwk, kid: 'test-kid', use: 'sig', alg: 'RS256' }] });
  return { privateKey, JWKS };
}

async function signToken(
  privateKey: CryptoKey,
  claims: { iss?: string; aud?: string | string[] },
) {
  let builder = new SignJWT({ id: 'user-123', email: 'test@example.com' })
    .setProtectedHeader({ alg: 'RS256', kid: 'test-kid' })
    .setExpirationTime('1h');
  if (claims.iss !== undefined) builder = builder.setIssuer(claims.iss);
  if (claims.aud !== undefined) builder = builder.setAudience(claims.aud);
  return builder.sign(privateKey);
}

describe('jwtVerify claim validation', () => {
  it('accepts a token with correct iss and aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL, aud: JWT_AUDIENCE });
    const { payload } = await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE });
    expect(payload.id).toBe('user-123');
  });

  it('rejects a token missing aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL });
    let err: unknown;
    try { await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token with wrong aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: BASE_URL, aud: `${JWT_AUDIENCE}-wrong` });
    let err: unknown;
    try { await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token with wrong iss', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, { iss: `${BASE_URL}-wrong`, aud: JWT_AUDIENCE });
    let err: unknown;
    try { await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });

  it('rejects a token missing both iss and aud', async () => {
    const { privateKey, JWKS } = await makeTestJWKS();
    const token = await signToken(privateKey, {});
    let err: unknown;
    try { await jwtVerify(token, JWKS, { issuer: BASE_URL, audience: JWT_AUDIENCE }); } catch (e) { err = e; }
    expect(err).toBeInstanceOf(joseErrors.JWTClaimValidationFailed);
  });
});
