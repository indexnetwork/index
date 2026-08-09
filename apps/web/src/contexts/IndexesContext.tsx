import { createContext, useContext, ReactNode, useState, useEffect, useCallback, useRef } from 'react';
import { Network } from '@/lib/types';
import { useAuthContext } from '@/contexts/AuthContext';
import { useIndexesV2 } from '@/services/v2/networks.service';
import { log } from '@/lib/logger';

const logger = log.context.from('IndexesContext');

interface NetworksContextType {
  indexes: Network[];
  loading: boolean;
  error: string | null;
  refreshIndexes: () => Promise<void>;
  addIndex: (network: Network) => void;
  updateIndex: (updatedNetwork: Network) => void;
  removeIndex: (networkId: string) => void;
}

const NetworksContext = createContext<NetworksContextType | undefined>(undefined);

export function NetworksProvider({ children }: { children: ReactNode }) {
  const [indexes, setIndexes] = useState<Network[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const indexesV2 = useIndexesV2();
  const { isAuthenticated } = useAuthContext();
  const hasFetchedRef = useRef(false);
  const hasDataRef = useRef(false);

  const refreshIndexes = useCallback(async () => {
    try {
      if (!hasDataRef.current) {
        setLoading(true);
      }
      setError(null);
      const response = await indexesV2.getIndexes();
      setIndexes((response.data ?? []).filter(Boolean));
      hasFetchedRef.current = true;
      hasDataRef.current = true;
    } catch (err) {
      logger.error('Error fetching networks', { error: err });
      setError('Failed to load networks');
      setIndexes([]);
    } finally {
      setLoading(false);
    }
  }, [indexesV2]);

  const addIndex = useCallback((network: Network) => {
    setIndexes(prev => [network, ...prev]);
  }, []);

  const updateIndex = useCallback((updatedNetwork: Network) => {
    setIndexes(prev => prev.map(n =>
      n.id === updatedNetwork.id ? updatedNetwork : n
    ));
  }, []);

  const removeIndex = useCallback((networkId: string) => {
    setIndexes(prev => prev.filter(n => n.id !== networkId));
  }, []);

  // Initial load - only fetch once when authenticated
  useEffect(() => {
    if (isAuthenticated && !hasFetchedRef.current) {
      refreshIndexes();
    } else if (!isAuthenticated) {
      setIndexes([]);
      setLoading(false);
      setError(null);
      hasFetchedRef.current = false;
      hasDataRef.current = false;
    }
  }, [isAuthenticated, refreshIndexes]);

  return (
    <NetworksContext.Provider value={{
      indexes,
      loading,
      error,
      refreshIndexes,
      addIndex,
      updateIndex,
      removeIndex
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
