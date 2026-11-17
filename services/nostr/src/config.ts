import { keypairFromSecret, generateKeypair, secretToHex, type Keypair } from '@indexnetwork/nostr';
import { z } from 'zod';

const schema = z.object({
  PORT: z.coerce.number().int().positive().default(3000),
  DATA_DIR: z.string().default('./data'),
  /** The public relay URL clients connect to, e.g. wss://relay.example.com. Used to check NIP-42 AUTH. */
  PUBLIC_URL: z.string().optional(),
  RELAY_NAME: z.string().default('Index relay (preview)'),
  RELAY_SECRET_KEY: z.string().optional(),
  HOST_SECRET_KEY: z.string().optional(),
  NODE_ENV: z.string().default('development'),
  /** `lexical` runs the preview stand-in matcher; `off` waits for an external discovery service. */
  DISCOVERY: z.enum(['lexical', 'off']).default('lexical'),
  DISCOVERY_THRESHOLD: z.coerce.number().min(0).max(1).default(0.2),
  BUZZ_RELAY_URL: z.string().optional(),
  /** The Buzz channel (UUID) whose members define the bridged community. */
  BUZZ_CHANNEL_ID: z.string().optional(),
  /** The Index network the Buzz channel's members mirror into. */
  BUZZ_NETWORK_ID: z.string().default('buzz'),
  /** The Buzz relay's signing key. Fetched from its NIP-11 document when unset. */
  BUZZ_RELAY_PUBKEY: z.string().optional(),
});

export interface Config {
  port: number;
  dataDir: string;
  publicUrl: string | null;
  relayName: string;
  relayKey: Keypair;
  hostKey: Keypair;
  discovery: 'lexical' | 'off';
  discoveryThreshold: number;
  buzz: { relayUrl: string; channelId: string; networkId: string; relayPubkey: string | null } | null;
}

function key(name: string, value: string | undefined, production: boolean): Keypair {
  if (value) return keypairFromSecret(value);
  if (production) throw new Error(`${name} is required in production`);
  const generated = generateKeypair();
  console.warn(`[config] ${name} not set; using a throwaway key for this run (${secretToHex(generated.secretKey).slice(0, 6)}…)`);
  return generated;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const value = schema.parse(env);
  const production = value.NODE_ENV === 'production';
  const buzz = value.BUZZ_RELAY_URL && value.BUZZ_CHANNEL_ID
    ? { relayUrl: value.BUZZ_RELAY_URL, channelId: value.BUZZ_CHANNEL_ID, networkId: value.BUZZ_NETWORK_ID, relayPubkey: value.BUZZ_RELAY_PUBKEY ?? null }
    : null;
  return {
    port: value.PORT,
    dataDir: value.DATA_DIR,
    publicUrl: value.PUBLIC_URL ?? null,
    relayName: value.RELAY_NAME,
    relayKey: key('RELAY_SECRET_KEY', value.RELAY_SECRET_KEY, production),
    hostKey: key('HOST_SECRET_KEY', value.HOST_SECRET_KEY, production),
    discovery: value.DISCOVERY,
    discoveryThreshold: value.DISCOVERY_THRESHOLD,
    buzz,
  };
}
