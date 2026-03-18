import { useState, useCallback, useRef } from 'react';

import type { BackupPayload } from '@/lib/xmtp';

type ApiClient = {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
};

export type XmtpKeyState =
  | { status: 'loading' }
  | { status: 'ready'; payload: BackupPayload }
  | { status: 'error'; message: string };

/**
 * Manages XMTP key retrieval from the server.
 * Fetches the server-managed wallet key — no passphrase required.
 */
export function useXmtpKeyManager(api: ApiClient) {
  const [state, setState] = useState<XmtpKeyState>({ status: 'loading' });
  const initializingRef = useRef(false);

  /**
   * Initialize: fetch wallet key from server.
   * Call this after authentication is confirmed.
   */
  const initialize = useCallback(async () => {
    if (initializingRef.current) return;
    initializingRef.current = true;
    setState({ status: 'loading' });
    try {
      const result = await api.get<{ walletPrivateKey: string; walletAddress: string }>(
        '/xmtp/keys/wallet',
      );
      // Generate a client-side dbEncryptionKey (32 random bytes, base64)
      const dbKeyBytes = crypto.getRandomValues(new Uint8Array(32));
      const dbEncryptionKey = btoa(String.fromCharCode(...dbKeyBytes));

      const payload: BackupPayload = {
        version: 1,
        walletPrivateKey: result.walletPrivateKey,
        dbEncryptionKey,
        walletAddress: result.walletAddress,
      };

      setState({ status: 'ready', payload });
      initializingRef.current = false;
    } catch (err: unknown) {
      // 404 means wallet doesn't exist yet — stay loading (ensureWallet will create it)
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        // Wallet will be created on next auth cycle; retry after a short delay
        setTimeout(() => {
          setState(prev => prev.status === 'loading' ? prev : { status: 'loading' });
        }, 2000);
        return;
      }
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to fetch wallet key' });
      initializingRef.current = false;
    }
  }, [api]);

  /**
   * Clear local state (for logout).
   */
  const logout = useCallback(async () => {
    setState({ status: 'loading' });
  }, []);

  return {
    state,
    initialize,
    logout,
  };
}
