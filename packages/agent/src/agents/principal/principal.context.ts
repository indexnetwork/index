import type { Decision, Intent, Opportunity, Profile } from "../shared/agent.context.js";

/** Fresh runner-assembled context and incremental callbacks for one intent wake. */
export interface WakeContext {
  profile: Profile;
  intent: Intent;
  /** Reconstructed entries, oldest first; bookkeeping is excluded from the model-facing transcript. */
  conversation: ConversationEntry[];
  opportunities: Opportunity[];
  /** Awaited so an instruction is persisted before its negotiation starts. */
  onBrief?: (actions: WakeAction[]) => void | Promise<void>;
  /** Persists one user-facing boundary for each discovery tool call. */
  onProgress?: (text: string) => void | Promise<void>;
  /** Reports newly opened opportunities for scheduling outside principal reasoning. */
  onOpened?: (opportunityIds: string[]) => void;
}

/** Fresh context for briefing one opportunity without sibling opportunities or callbacks. */
export interface BriefContext {
  profile: Profile;
  intent: Intent;
  conversation: ConversationEntry[];
  opportunity: Opportunity;
}

/** Reconstructed conversation entry; wire scope `match` becomes `opportunity` here. */
export interface ConversationEntry {
  kind: "user" | "message" | "question" | "answer" | "brief" | "decision" | "stall" | "expire" | "progress";
  text: string;
  scope?: "intent" | "opportunity";
  counterpart?: string;
  opportunity?: string;
  questionId?: string;
  options?: string[];
}

export type WakeAction =
  | { type: "brief"; opportunityId: string; brief: string }
  | { type: "decision"; opportunityId: string; decision: Decision }
  | { type: "ask"; scope: "intent" | "opportunity"; opportunityId?: string; question: string; options: string[] }
  | { type: "note"; text: string }
  | { type: "progress"; text: string }
  | { type: "expire"; questionId: string };

export interface WakeResult {
  /** Empty is valid silence; incrementally published instructions remain in this list. */
  actions: WakeAction[];
}

export function profileFacts(profile: Profile): Pick<Profile, "name" | "intro" | "location" | "timezone"> | null {
  if (!profile.profileConfirmed) return null;
  return { name: profile.name, intro: profile.intro, location: profile.location, timezone: profile.timezone };
}

export function principalConversation(conversation: ConversationEntry[]): ConversationEntry[] {
  return conversation.filter((entry) => entry.kind !== "brief" && entry.kind !== "decision" && entry.kind !== "stall");
}

export function openQuestions(conversation: ConversationEntry[]): Map<string, string> {
  const open = new Map<string, string>();
  for (const entry of conversation) {
    if (!entry.questionId) continue;
    if (entry.kind === "question") open.set(entry.questionId, entry.text);
    else if (entry.kind === "answer" || entry.kind === "expire") open.delete(entry.questionId);
  }
  return open;
}
