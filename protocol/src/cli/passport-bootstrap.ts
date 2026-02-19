#!/usr/bin/env bun
/**
 * Passport SIWE auth test. Generates a wallet, authenticates via
 * ceramic-cache, and queries the score. No DB required.
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const API = 'https://api.passport.xyz';

function buildSiweMessage(f: Record<string, any>): string {
  const lines = [
    `${f.domain} wants you to sign in with your Ethereum account:`,
    f.address, '', f.statement, '',
    `URI: ${f.uri}`, `Version: ${f.version}`, `Chain ID: ${f.chainId}`,
    `Nonce: ${f.nonce}`, `Issued At: ${f.issuedAt}`,
  ];
  if (f.expirationTime) lines.push(`Expiration Time: ${f.expirationTime}`);
  return lines.join('\n');
}

async function main() {
  const account = privateKeyToAccount(generatePrivateKey());
  console.log('Wallet:', account.address);

  const { nonce } = await fetch(`${API}/account/nonce`).then(r => r.json()) as { nonce: string };
  const fields = {
    domain: 'passport.xyz',
    address: account.address,
    statement: 'I authorize the passport scorer.',
    uri: 'https://passport.xyz',
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const signature = await account.signMessage({ message: buildSiweMessage(fields) });

  const res = await fetch(`${API}/ceramic-cache/authenticate/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: fields, signature }),
  });
  if (!res.ok) throw new Error(`Auth failed: ${res.status} ${await res.text()}`);

  const { access } = await res.json() as { access: string };
  console.log('Authenticated. JWT:', access.substring(0, 40) + '...');

  const score = await fetch(`${API}/ceramic-cache/score/${account.address}`, {
    headers: { Authorization: `Bearer ${access}` },
  }).then(r => r.json()) as any;

  console.log('Score:', score.score, '(passing:', score.passing_score + ', threshold:', score.threshold + ')');
}

main().catch(err => { console.error(err); process.exit(1); });
