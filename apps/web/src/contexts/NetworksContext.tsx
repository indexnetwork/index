import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Network } from '@/lib/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { useNetworkService } from '@/services/networks';
import { log } from '@/lib/logger';

const logger = log.context.from('NetworksContext');

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
  const networkService = useNetworkService();
  const { isAuthenticated } = useAuthContext();
  const hasFetchedRef = useRef(false);
  const hasDataRef = useRef(false);

  const refreshNetworks = useCallback(async () => {
    try {
      if (!hasDataRef.current) {
        setLoading(true);
      }
      setError(null);
      const response = await networkService.getNetworks();
      setNetworks((response.data ?? []).filter(Boolean));
      hasFetchedRef.current = true;
      hasDataRef.current = true;
    } catch (err) {
      logger.error('Error fetching networks', { error: err });
      setError('Failed to load networks');
      setNetworks([]);
    } finally {
      setLoading(false);
    }
  }, [networkService]);

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
    }
  }, [isAuthenticated, refreshNetworks]);

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
