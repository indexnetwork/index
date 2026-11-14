import { createContext, useContext } from "react";

import type { Entry } from "@/components/intents-home/stages";

export const AGENT_OPEN_KEY = "index.home.agentOpen";

/** Whether this viewer left the agent window open last time. Closed by default. */
export function readAgentOpen(): boolean {
  try { return localStorage.getItem(AGENT_OPEN_KEY) === "1"; } catch { return false; }
}

/** One match opened beside Home from a "waiting on you" or "in progress" card. */
export interface OpenLog {
  opportunityId: string;
  intentId: string;
  name: string;
  userId?: string;
  avatar?: string | null;
  notOnIndex?: boolean;
  /** Every intent this person showed up in, best stage first, as the card had them. */
  entries?: Entry[];
}

export const AgentWindowContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  log: OpenLog | null;
  setLog: (log: OpenLog | null) => void;
}>({
  open: false,
  setOpen: () => {},
  log: null,
  setLog: () => {},
});

/**
 * The window beside Home: whether the agent window is open, and which
 * conversation log (if any) is showing in its place.
 */
export const useAgentWindow = () => useContext(AgentWindowContext);
