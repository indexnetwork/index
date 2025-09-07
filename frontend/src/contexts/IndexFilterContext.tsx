'use client';

import { createContext, useContext, useState, useCallback, ReactNode } from 'react';

interface IndexFilterContextType {
  selectedIndexIds: string[];
  setSelectedIndexIds: (indexIds: string[]) => void;
}

const IndexFilterContext = createContext<IndexFilterContextType | undefined>(undefined);

export function IndexFilterProvider({ children }: { children: ReactNode }) {
  const [selectedIndexIds, setSelectedIndexIds] = useState<string[]>([]);

  const handleSetSelectedIndexIds = useCallback((indexIds: string[]) => {
    setSelectedIndexIds(indexIds);
  }, []);

  return (
    <IndexFilterContext.Provider value={{
      selectedIndexIds,
      setSelectedIndexIds: handleSetSelectedIndexIds
    }}>
      {children}
    </IndexFilterContext.Provider>
  );
}

export function useIndexFilter() {
  const context = useContext(IndexFilterContext);
  if (context === undefined) {
    throw new Error('useIndexFilter must be used within an IndexFilterProvider');
  }
  return context;
}


