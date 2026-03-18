import { useState, useCallback, useRef } from 'react';

type ApiClient = {
  get: <T>(endpoint: string) => Promise<T>;
  post: <T>(endpoint: string, data?: unknown) => Promise<T>;
};

export type XmtpKeyState =
  | { status: 'loading' }
  | { status: 'ready'; walletAddress: string }
  | { status: 'error'; message: string };

/**
 * Manages XMTP identity retrieval from the server.
 * Only fetches the public wallet address — private key never leaves the server.
 */
export function useXmtpKeyManager(api: ApiClient) {
  const [state, setState] = useState<XmtpKeyState>({ status: 'loading' });
  const initializingRef = useRef(false);

  /**
   * Initialize: fetch wallet address from server.
   * Call this after authentication is confirmed.
   */
  const initialize = useCallback(async () => {
    if (initializingRef.current) return;
    initializingRef.current = true;
    setState({ status: 'loading' });
    try {
      const result = await api.get<{ walletAddress: string }>('/xmtp/identity');
      setState({ status: 'ready', walletAddress: result.walletAddress });
      initializingRef.current = false;
    } catch (err: unknown) {
      // 404 means wallet doesn't exist yet — stay loading (ensureWallet will create it)
      if (err && typeof err === 'object' && 'status' in err && (err as { status: number }).status === 404) {
        initializingRef.current = false;
        setTimeout(() => {
          initializingRef.current = false;
          setState(prev => prev.status === 'loading' ? prev : { status: 'loading' });
        }, 2000);
        return;
      }
      setState({ status: 'error', message: err instanceof Error ? err.message : 'Failed to fetch wallet identity' });
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
