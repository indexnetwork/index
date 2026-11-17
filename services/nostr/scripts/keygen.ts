/** Print fresh relay and host keys for a new deployment. */
import { generateKeypair, npub, secretToHex } from '@indexnetwork/nostr';

for (const name of ['RELAY_SECRET_KEY', 'HOST_SECRET_KEY']) {
  const key = generateKeypair();
  console.log(`${name}=${secretToHex(key.secretKey)}  # ${npub(key.pubkey)}`);
}
