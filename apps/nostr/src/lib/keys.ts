/** Keys kept in this browser. The preview signs locally; NIP-07 extensions are a next step. */
import { generateKeypair, keypairFromSecret, secretToHex, type Keypair } from '@indexnetwork/nostr';

const STORAGE = 'index-nostr:key';
const PARTNER = 'index-nostr:partner-key';

function load(slot: string): Keypair {
  const stored = localStorage.getItem(slot);
  if (stored) {
    try {
      return keypairFromSecret(stored);
    } catch {
      localStorage.removeItem(slot);
    }
  }
  const fresh = generateKeypair();
  localStorage.setItem(slot, secretToHex(fresh.secretKey));
  return fresh;
}

export const loadKey = () => load(STORAGE);
export const loadPartnerKey = () => load(PARTNER);

/** Replace the key with an imported nsec or hex secret. Throws on bad input. */
export function importKey(secret: string): Keypair {
  const key = keypairFromSecret(secret);
  localStorage.setItem(STORAGE, secretToHex(key.secretKey));
  return key;
}

export function resetKeys(): void {
  for (const key of Object.keys(localStorage)) if (key.startsWith('index-nostr:')) localStorage.removeItem(key);
}
