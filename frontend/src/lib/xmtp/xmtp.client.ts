import { Client, IdentifierKind, LogLevel, type Signer, type XmtpEnv } from '@xmtp/browser-sdk';
import { secp256k1 } from '@noble/curves/secp256k1';
import { keccak_256 } from '@noble/hashes/sha3';

/**
 * Backup blob structure containing wallet credentials for XMTP client creation.
 */
export interface BackupPayload {
  version: 1;
  walletPrivateKey: string;
  dbEncryptionKey: string;
  walletAddress: string;
}

function hexToBytes(hex: string): Uint8Array {
  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.substring(i, i + 2), 16);
  }
  return arr;
}

/**
 * Create an XMTP Signer from a raw private key hex string.
 * Derives the Ethereum address via secp256k1 public key + keccak256.
 */
export function createSignerFromPrivateKey(privateKeyHex: string): Signer {
  const keyBytes = hexToBytes(privateKeyHex.replace(/^0x/, ''));
  const publicKey = secp256k1.getPublicKey(keyBytes, false);
  const addressBytes = keccak_256(publicKey.slice(1)).slice(-20);
  const address = '0x' + Array.from(addressBytes, b => b.toString(16).padStart(2, '0')).join('');

  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: address.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const prefix = `\x19Ethereum Signed Message:\n${message.length}`;
      const hash = keccak_256(new TextEncoder().encode(prefix + message));
      const sig = secp256k1.sign(hash, keyBytes);
      return new Uint8Array([...sig.toCompactRawBytes(), sig.recovery + 27]);
    },
  };
}

/**
 * Create an XMTP browser client from a decrypted backup payload.
 * Browser SDK uses unencrypted OPFS/IndexedDB — dbEncryptionKey is not passed.
 */
export async function createBrowserClient(
  payload: BackupPayload,
  env: XmtpEnv,
): Promise<Client> {
  const signer = createSignerFromPrivateKey(payload.walletPrivateKey);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Client.create(signer, {
    env,
    loggingLevel: LogLevel.Off,
    disableDeviceSync: true,
    dbPath: `xmtp-${env}-v2`,
  } as any) as Promise<Client>;
}
