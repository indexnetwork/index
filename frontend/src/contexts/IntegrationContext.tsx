'use client';

import React, { createContext, useContext, useState } from 'react';
import { Integration, IntegrationSource } from '@/types';

interface IntegrationContextType {
  integrations: Integration[];
  connectIntegration: (source: IntegrationSource) => Promise<void>;
  disconnectIntegration: (id: string) => void;
  syncIntegration: (id: string) => Promise<void>;
}

const IntegrationContext = createContext<IntegrationContextType | undefined>(undefined);

export function IntegrationProvider({ children }: { children: React.ReactNode }) {
  const [integrations, setIntegrations] = useState<Integration[]>([]);

  const connectIntegration = async (source: IntegrationSource) => {
    // Simulate OAuth flow
    const newIntegration: Integration = {
      id: Math.random().toString(36).substr(2, 9),
      source,
      name: source.charAt(0).toUpperCase() + source.slice(1),
      status: 'connected',
      lastSyncedAt: new Date().toISOString()
    };

    setIntegrations(prev => [...prev, newIntegration]);
  };

  const disconnectIntegration = (id: string) => {
    setIntegrations(prev => prev.filter(integration => integration.id !== id));
  };

  const syncIntegration = async (id: string) => {
    setIntegrations(prev => prev.map(integration => 
      integration.id === id 
        ? { ...integration, lastSyncedAt: new Date().toISOString() }
        : integration
    ));
  };

  return (
    <IntegrationContext.Provider value={{ 
      integrations, 
      connectIntegration, 
      disconnectIntegration,
      syncIntegration
    }}>
      {children}
    </IntegrationContext.Provider>
  );
}

export function useIntegrations() {
  const context = useContext(IntegrationContext);
  if (context === undefined) {
    throw new Error('useIntegrations must be used within an IntegrationProvider');
  }
  return context;
} 