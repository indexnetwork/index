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
  /** Home's key for this person, so a decision made in the window lands on their row. */
  personKey?: string;
  name: string;
  userId?: string;
  avatar?: string | null;
  notOnIndex?: boolean;
  /** Every intent this person showed up in, best stage first, as the card had them. */
  entries?: Entry[];
  /** "chat" shows the conversation with this person instead of their match write-up. */
  view?: "chat";
}

/** What you decided about someone in "waiting on you", kept so their row stays where it was. */
export type Decision = "accepted" | "rejected";

export const AgentWindowContext = createContext<{
  open: boolean;
  setOpen: (open: boolean) => void;
  log: OpenLog | null;
  setLog: (log: OpenLog | null) => void;
  /** This visit's decisions, by person key. */
  decisions: Record<string, Decision>;
  /** Record a decision; `null` takes it back (the request failed). */
  decide: (personKey: string, decision: Decision | null) => void;
}>({
  open: false,
  setOpen: () => {},
  log: null,
  setLog: () => {},
  decisions: {},
  decide: () => {},
});

/**
 * The window beside Home: whether the agent window is open, and which
 * conversation log (if any) is showing in its place.
 */
export const useAgentWindow = () => useContext(AgentWindowContext);
