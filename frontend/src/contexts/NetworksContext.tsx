import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Network } from '@/lib/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworksV2 } from '@/services/v2/networks.service';
import { useNetworks as useNetworksApi } from '@/contexts/APIContext';

interface NetworksContextType {
  networks: Network[];
  loading: boolean;
  error: string | null;
  refreshNetworks: () => Promise<void>;
  addNetwork: (network: Network) => void;
  updateNetwork: (updatedNetwork: Network) => void;
  removeNetwork: (networkId: string) => void;
}

const NetworksContext = createContext<NetworksContextType | undefined>(undefined);

export function NetworksProvider({ children }: { children: ReactNode }) {
  const [networks, setNetworks] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const networksV2 = useNetworksV2();
  const networksApi = useNetworksApi();
  const { isAuthenticated } = useAuthContext();
  const hasFetchedRef = useRef(false);
  const hasDataRef = useRef(false);
  const pendingJoinProcessedRef = useRef(false);

  const refreshNetworks = useCallback(async () => {
    try {
      if (!hasDataRef.current) {
        setLoading(true);
      }
      setError(null);
      const response = await networksV2.getNetworks();
      setNetworks((response.data ?? []).filter(Boolean));
      hasFetchedRef.current = true;
      hasDataRef.current = true;
    } catch (err) {
      console.error('Error fetching networks:', err);
      setError('Failed to load networks');
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  }, [networksV2]);

  const addNetwork = useCallback((network: Network) => {
    setNetworks(prev => [network, ...prev]);
  }, []);

  const updateNetwork = useCallback((updatedNetwork: Network) => {
    setNetworks(prev => prev.map(n =>
      n.id === updatedNetwork.id ? updatedNetwork : n
    ));
  }, []);

  const removeNetwork = useCallback((networkId: string) => {
    setNetworks(prev => prev.filter(n => n.id !== networkId));
  }, []);

  // Initial load - only fetch once when authenticated
  useEffect(() => {
    if (isAuthenticated && !hasFetchedRef.current) {
      refreshNetworks();
    } else if (!isAuthenticated) {
      setNetworks([]);
      setLoading(false);
      setError(null);
      hasFetchedRef.current = false;
      hasDataRef.current = false;
      pendingJoinProcessedRef.current = false;
    }
  }, [isAuthenticated, refreshNetworks]);

  // Handle pending index join after authentication
  useEffect(() => {
    if (!isAuthenticated || pendingJoinProcessedRef.current) return;

    const pendingNetworkId = typeof window !== 'undefined'
      ? localStorage.getItem('pending_network_join')
      : null;

    if (!pendingNetworkId) return;

    pendingJoinProcessedRef.current = true;
    localStorage.removeItem('pending_network_join');

    networksApi.joinNetwork(pendingNetworkId)
      .then(() => refreshNetworks())
      .catch((err) => console.error('Failed to auto-join pending network:', err));
  }, [isAuthenticated, networksApi, refreshNetworks]);

  return (
    <NetworksContext.Provider value={{
      networks,
      loading,
      error,
      refreshNetworks,
      addNetwork,
      updateNetwork,
      removeNetwork
    }}>
      {children}
    </NetworksContext.Provider>
  );
}

export function useNetworksState() {
  const context = useContext(NetworksContext);
  if (context === undefined) {
    throw new Error('useNetworksState must be used within a NetworksProvider');
  }
  return context;
}
