#!/usr/bin/env bun
/**
 * Passport SIWE login smoke test.
 * Tests two auth paths against the live Passport API:
 *   1. /account/verify        (developer portal dashboard login)
 *   2. /ceramic-cache/authenticate/v2  (app-level SIWE auth)
 *
 * Run: bun ./src/cli/passport-smoke-test.ts
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

async function siweAuth(account: ReturnType<typeof privateKeyToAccount>, domain: string) {
  const { nonce } = await fetch(`${API}/account/nonce`).then(r => r.json()) as { nonce: string };
  const fields = {
    domain,
    address: account.address,
    statement: 'I authorize the passport scorer.',
    uri: `https://${domain}`,
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const sig = await account.signMessage({ message: buildSiweMessage(fields) });
  return { fields, sig };
}

const pk = generatePrivateKey();
const account = privateKeyToAccount(pk);
console.log(`Wallet: ${account.address}\n`);

// --- Test 1: Dashboard login (/account/verify) ---
console.log('--- /account/verify (dashboard login) ---');
const { fields: f1, sig: s1 } = await siweAuth(account, 'developer.passport.xyz');
const r1 = await fetch(`${API}/account/verify`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: f1, signature: s1 }),
});
console.log(`Status: ${r1.status}`);
console.log(`Body:   ${await r1.text()}\n`);

// --- Test 2: Ceramic-cache auth (/ceramic-cache/authenticate/v2) ---
console.log('--- /ceramic-cache/authenticate/v2 (app auth) ---');
const { fields: f2, sig: s2 } = await siweAuth(account, 'passport.xyz');
const r2 = await fetch(`${API}/ceramic-cache/authenticate/v2`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: f2, signature: s2 }),
});
console.log(`Status: ${r2.status}`);
const body2 = await r2.json() as { access?: string };
if (body2.access) {
  console.log(`JWT:    ${body2.access.substring(0, 40)}...`);

  // Use the JWT to query score
  const scoreRes = await fetch(`${API}/ceramic-cache/score/${account.address}`, {
    headers: { Authorization: `Bearer ${body2.access}` },
  });
  const score = await scoreRes.json() as any;
  console.log(`\nScore:  ${score.score} (passing: ${score.passing_score}, threshold: ${score.threshold})`);
  console.log(`Stamps: ${Object.keys(score.stamps || {}).length}`);
} else {
  console.log(`Body:   ${JSON.stringify(body2)}`);
}
