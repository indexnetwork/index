import React, { createContext, useContext, useState, useCallback } from 'react';

interface AIChatSessionsContextType {
  sessionsVersion: number;
  refetchSessions: () => void;
}

const AIChatSessionsContext = createContext<AIChatSessionsContextType | null>(null);

export function AIChatSessionsProvider({ children }: { children: React.ReactNode }) {
  const [sessionsVersion, setSessionsVersion] = useState(0);

  const refetchSessions = useCallback(() => {
    setSessionsVersion((v) => v + 1);
  }, []);

  return (
    <AIChatSessionsContext.Provider value={{ sessionsVersion, refetchSessions }}>
      {children}
    </AIChatSessionsContext.Provider>
  );
}

export function useAIChatSessions() {
  const context = useContext(AIChatSessionsContext);
  if (!context) {
    throw new Error('useAIChatSessions must be used within AIChatSessionsProvider');
  }
  return context;
}
