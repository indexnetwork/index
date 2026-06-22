import { describe, test, expect } from 'bun:test';
import { config } from 'dotenv';
config({ path: '.env.test', override: true });

import { signConnectToken, verifyConnectToken } from '../../services/connect-token.service';

describe('connect-token service', () => {
  test('sign and verify round-trip', async () => {
    const token = await signConnectToken('user-123', 'opp-456');
    expect(typeof token).toBe('string');

    const payload = await verifyConnectToken(token);
    expect(payload.sub).toBe('user-123');
    expect(payload.opp).toBe('opp-456');
  });

  test('verify rejects tampered token', async () => {
    const token = await signConnectToken('user-123', 'opp-456');
    const tampered = token.slice(0, -5) + 'XXXXX';
    await expect(verifyConnectToken(tampered)).rejects.toThrow();
  });

  test('verify rejects expired token', async () => {
    const { SignJWT } = await import('jose');
    const key = new TextEncoder().encode(process.env.CONNECT_JWT_SECRET || 'dev-connect-secret');
    const token = await new SignJWT({ opp: 'opp-456' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject('user-123')
      .setIssuer('index-network')
      .setIssuedAt(Math.floor(Date.now() / 1000) - 200000)
      .setExpirationTime(Math.floor(Date.now() / 1000) - 100000)
      .sign(key);

    await expect(verifyConnectToken(token)).rejects.toThrow();
  });
});
