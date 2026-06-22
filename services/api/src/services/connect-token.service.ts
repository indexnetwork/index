import { SignJWT, jwtVerify } from 'jose';

const SECRET_KEY = new TextEncoder().encode(process.env.CONNECT_JWT_SECRET || 'dev-connect-secret');

if (!process.env.CONNECT_JWT_SECRET && process.env.NODE_ENV === 'production') {
  throw new Error('CONNECT_JWT_SECRET must be set in production');
}

const ISSUER = 'index-network';
const TTL_SECONDS = 48 * 60 * 60; // 48 hours

export interface ConnectTokenPayload {
  sub: string; // userId
  opp: string; // opportunityId
}

/**
 * Mint a short-lived JWT for the connect redirect endpoint.
 */
export async function signConnectToken(userId: string, opportunityId: string): Promise<string> {
  return new SignJWT({ opp: opportunityId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${TTL_SECONDS}s`)
    .sign(SECRET_KEY);
}

/**
 * Verify a connect token and extract the payload.
 * Throws on invalid/expired tokens.
 */
export async function verifyConnectToken(token: string): Promise<ConnectTokenPayload> {
  const { payload } = await jwtVerify(token, SECRET_KEY, { issuer: ISSUER });
  if (!payload.sub || typeof payload.opp !== 'string') {
    throw new Error('Malformed connect token');
  }
  return { sub: payload.sub, opp: payload.opp };
}
