import { useEffect, type RefObject } from "react";

import type { RadarBucket } from "@/lib/radar-buckets";
import type { RadarCardItem } from "@/services/opportunities";

export interface HomeIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  status?: string;
  warming?: boolean;
}

export type Stage = "awaiting" | "chat" | "talks" | "closed";
export type Filter = "matches" | "in progress" | "closed";

export const STAGE_OF: Record<Exclude<RadarBucket, "all">, Stage> = {
  "awaiting you": "awaiting",
  accepted: "chat",
  negotiating: "talks",
  closed: "closed",
};
export const STAGE_META: Record<Stage, { label: string; dot: string }> = {
  awaiting: { label: "awaiting you", dot: "var(--ih-accent)" },
  talks: { label: "in talks", dot: "var(--ih-live)" },
  chat: { label: "chat open", dot: "var(--ih-chat)" },
  closed: { label: "closed", dot: "var(--ih-closed)" },
};
export const RANK: Record<Stage, number> = { awaiting: 0, chat: 1, talks: 2, closed: 3 };
export const FILTERS: Array<{ value: Filter; stages: Stage[] }> = [
  { value: "matches", stages: ["awaiting"] },
  { value: "in progress", stages: ["talks", "chat"] },
  { value: "closed", stages: ["closed"] },
];
export const filterOf = (stage: Stage): Filter => FILTERS.find((f) => f.stages.includes(stage))!.value;

export interface Entry {
  intentId: string;
  item: RadarCardItem;
  stage: Stage;
}

export const personKey = (item: RadarCardItem) => item.userId || item.peer?.userId || `name:${item.name || item.peer?.name}`;

/** The agent face's palette. An intent keeps one colour, so its tag reads the same in the rail and on rows. */
const INTENT_COLORS = ["#0B5FA5", "#2E8B7A", "#E8C84A", "#7B62B8", "#C9518B", "#F26B0F"];
export function intentColor(intentId: string) {
  let h = 0;
  for (let i = 0; i < intentId.length; i++) h = (h * 31 + intentId.charCodeAt(i)) >>> 0;
  return INTENT_COLORS[h % INTENT_COLORS.length];
}

export function intentRank(status?: string) {
  const value = (status || "active").toLowerCase();
  if (value === "active") return 0;
  if (value === "paused") return 2;
  return 1;
}

/** Close a popover on an outside press or Escape. */
export function useDismiss(open: boolean, ref: RefObject<HTMLElement | null>, close: () => void) {
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.preventDefault();
      close();
    };
    document.addEventListener("mousedown", onDown, true);
    document.addEventListener("keydown", onKey, true);
    return () => {
      document.removeEventListener("mousedown", onDown, true);
      document.removeEventListener("keydown", onKey, true);
    };
  }, [open, ref, close]);
}
