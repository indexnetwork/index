import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import type { PrivateKeyAccount } from 'viem/accounts';

import db from '../lib/drizzle/drizzle';
import { passportConfig } from '../schemas/database.schema';
import { encrypt, decrypt } from '../lib/crypto/crypto';
import { log } from '../lib/log';

const logger = log.service.from("passport.bootstrap");

const PASSPORT_API = 'https://api.passport.xyz';
const SIWE_DOMAIN = 'passport.xyz';

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

export interface PassportClient {
  walletAddress: string;
  getScore(address: string): Promise<PassportScore>;
  getStamps(address: string): Promise<PassportStamp[]>;
}

export interface PassportScore {
  address: string;
  score: string;
  passing_score: boolean;
  threshold: string;
  stamps: Record<string, string>;
}

export interface PassportStamp {
  provider: string;
  stamp: Record<string, any>;
}

async function authenticateWallet(account: PrivateKeyAccount): Promise<string> {
  const { nonce } = await fetch(`${PASSPORT_API}/account/nonce`).then(r => r.json()) as { nonce: string };
  const fields = {
    domain: SIWE_DOMAIN,
    address: account.address,
    statement: 'I authorize the passport scorer.',
    uri: `https://${SIWE_DOMAIN}`,
    version: '1',
    chainId: 1,
    nonce,
    issuedAt: new Date().toISOString(),
    expirationTime: new Date(Date.now() + 5 * 60_000).toISOString(),
  };
  const messageText = buildSiweMessage(fields);
  const signature = await account.signMessage({ message: messageText });

  const res = await fetch(`${PASSPORT_API}/ceramic-cache/authenticate/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ message: fields, signature }),
  });
  if (!res.ok) throw new Error(`Passport auth failed: ${res.status} ${await res.text()}`);
  return ((await res.json()) as { access: string }).access;
}

export async function bootstrapPassport(): Promise<PassportClient> {
  let walletAddress: string;
  let privateKey: `0x${string}`;

  const existing = await db.select().from(passportConfig).limit(1);
  if (existing.length > 0) {
    walletAddress = existing[0].walletAddress;
    privateKey = decrypt(existing[0].walletPrivateKey) as `0x${string}`;
    logger.info('Passport wallet loaded', { walletAddress });
  } else {
    logger.info('Bootstrapping Passport system wallet...');
    privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    walletAddress = account.address;

    await db.insert(passportConfig).values({
      id: 'default',
      walletAddress,
      walletPrivateKey: encrypt(privateKey),
    });
    logger.info('Passport wallet created', { walletAddress });
  }

  let cachedJwt: string | null = null;
  let jwtExpiry = 0;

  async function getJwt(): Promise<string> {
    if (cachedJwt && Date.now() < jwtExpiry) return cachedJwt;
    const account = privateKeyToAccount(privateKey);
    cachedJwt = await authenticateWallet(account);
    jwtExpiry = Date.now() + 6 * 24 * 60 * 60 * 1000; // 6 days (token lasts 7)
    return cachedJwt;
  }

  return {
    walletAddress,

    async getScore(address: string): Promise<PassportScore> {
      const jwt = await getJwt();
      const res = await fetch(`${PASSPORT_API}/ceramic-cache/score/${address}`, {
        headers: { Authorization: `Bearer ${jwt}` },
      });
      if (!res.ok) throw new Error(`Passport score failed: ${res.status}`);
      return res.json() as Promise<PassportScore>;
    },

    async getStamps(address: string): Promise<PassportStamp[]> {
      const res = await fetch(`${PASSPORT_API}/ceramic-cache/stamp?address=${address}`);
      if (!res.ok) throw new Error(`Passport stamps failed: ${res.status}`);
      const data = await res.json() as { stamps: PassportStamp[] };
      return data.stamps;
    },
  };
}
