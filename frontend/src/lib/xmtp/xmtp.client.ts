import { Client, IdentifierKind, LogLevel, type Signer, type XmtpEnv } from '@xmtp/browser-sdk';

type ApiClient = {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
};

/**
 * Create an XMTP Signer that delegates signing to the server.
 * The private key never leaves the server — the client sends the challenge
 * message and receives the signature bytes back.
 */
export function createRemoteSigner(walletAddress: string, api: ApiClient): Signer {
  return {
    type: 'EOA' as const,
    getIdentifier: () => ({
      identifier: walletAddress.toLowerCase(),
      identifierKind: IdentifierKind.Ethereum,
    }),
    signMessage: async (message: string) => {
      const { signature } = await api.post<{ signature: number[] }>('/xmtp/sign', { message });
      return new Uint8Array(signature);
    },
  };
}

/**
 * Create an XMTP browser client using server-side signing.
 * The server holds the private key and signs identity challenges on behalf of the client.
 */
export async function createBrowserClient(
  walletAddress: string,
  api: ApiClient,
  env: XmtpEnv,
): Promise<Client> {
  const signer = createRemoteSigner(walletAddress, api);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return Client.create(signer, {
    env,
    loggingLevel: LogLevel.Off,
    disableDeviceSync: true,
    dbPath: `xmtp-${env}-v2`,
  } as any) as Promise<Client>;
}
