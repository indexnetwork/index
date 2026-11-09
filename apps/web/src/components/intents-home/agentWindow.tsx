import { useCallback, useMemo, useState, type ReactNode } from "react";

import { AGENT_OPEN_KEY, AgentWindowContext, readAgentOpen, type OpenLog } from "@/components/intents-home/agentWindowContext";

/** Keeps the agent window's open state for the desktop shell (remembered per viewer) and the open log. */
export function AgentWindowProvider({ children }: { children: ReactNode }) {
  const [open, setOpenState] = useState(readAgentOpen);
  const setOpen = useCallback((next: boolean) => {
    setOpenState(next);
    try { localStorage.setItem(AGENT_OPEN_KEY, next ? "1" : "0"); } catch { /* a per-viewer convenience only */ }
  }, []);
  // A conversation log opened from Home sits where the agent window goes, until closed.
  const [log, setLog] = useState<OpenLog | null>(null);
  const value = useMemo(() => ({ open, setOpen, log, setLog }), [open, setOpen, log]);
  return <AgentWindowContext.Provider value={value}>{children}</AgentWindowContext.Provider>;
}
