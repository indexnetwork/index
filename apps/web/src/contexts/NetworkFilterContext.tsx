import { createContext, useContext, useState, type ReactNode } from 'react';

interface NetworkFilterContextType {
  selectedNetworkIds: string[];
  setSelectedNetworkIds: (networkIds: string[]) => void;
}

const NetworkFilterContext = createContext<NetworkFilterContextType | undefined>(undefined);

export function NetworkFilterProvider({ children }: { children: ReactNode }) {
  const [selectedNetworkIds, setSelectedNetworkIds] = useState<string[]>([]);

  return (
    <NetworkFilterContext.Provider value={{
      selectedNetworkIds,
      setSelectedNetworkIds,
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
