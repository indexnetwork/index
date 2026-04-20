import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';

interface NetworkFilterContextType {
  selectedNetworkIds: string[];
  setSelectedNetworkIds: (networkIds: string[]) => void;
}

const NetworkFilterContext = createContext<NetworkFilterContextType | undefined>(undefined);

export function NetworkFilterProvider({ children }: { children: ReactNode }) {
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);

  const handleSetSelectedNetworkIds = useCallback((networkIds: string[]) => {
    setSelectedNetworkIds(networkIds);
  }, []);

  return (
    <NetworkFilterContext.Provider value={{
      selectedNetworkIds,
      setSelectedNetworkIds: handleSetSelectedNetworkIds,
    }}>
      {children}
    </NetworkFilterContext.Provider>
  );
}

export function useNetworkFilter() {
  const context = useContext(NetworkFilterContext);
  if (context === undefined) {
    throw new Error('useNetworkFilter must be used within a NetworkFilterProvider');
  }
  return context;
}
