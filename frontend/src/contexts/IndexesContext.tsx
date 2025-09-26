'use client';

import { createContext, useContext, ReactNode, useState, useEffect, useCallback } from 'react';
import { Index } from '@/lib/types';
import { useIndexes as useIndexesService } from '@/contexts/APIContext';

interface IndexesContextType {
  indexes: Index[];
  loading: boolean;
  error: string | null;
  refreshIndexes: () => Promise<void>;
  addIndex: (index: Index) => void;
  updateIndex: (updatedIndex: Index) => void;
  removeIndex: (indexId: string) => void;
}

const IndexesContext = createContext<IndexesContextType | undefined>(undefined);

export function IndexesProvider({ children }: { children: ReactNode }) {
  const [indexes, setIndexes] = useState<Index[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const indexesService = useIndexesService();

  const refreshIndexes = useCallback(async () => {
    try {
      setLoading(true);
      setError(null);
      const response = await indexesService.getIndexes(1, 100);
      setIndexes(response.indexes || []);
    } catch (err) {
      console.error('Error fetching indexes:', err);
      setError('Failed to load indexes');
      setIndexes([]);
    } finally {
      setLoading(false);
    }
  }, [indexesService]);

  const addIndex = useCallback((index: Index) => {
    setIndexes(prev => [index, ...prev]);
  }, []);

  const updateIndex = useCallback((updatedIndex: Index) => {
    setIndexes(prev => prev.map(index => 
      index.id === updatedIndex.id ? updatedIndex : index
    ));
  }, []);

  const removeIndex = useCallback((indexId: string) => {
    setIndexes(prev => prev.filter(index => index.id !== indexId));
  }, []);

  // Initial load
  useEffect(() => {
    refreshIndexes();
  }, [refreshIndexes]);

  return (
    <IndexesContext.Provider value={{
      indexes,
      loading,
      error,
      refreshIndexes,
      addIndex,
      updateIndex,
      removeIndex
    }}>
      {children}
    </IndexesContext.Provider>
  );
}

export function useIndexesState() {
  const context = useContext(IndexesContext);
  if (context === undefined) {
    throw new Error('useIndexesState must be used within an IndexesProvider');
  }
  return context;
}
