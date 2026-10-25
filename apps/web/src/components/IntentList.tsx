import { useMemo, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { intentStatus, intentTitle } from "@/lib/intent-display";
import { QCount } from "@/components/workbench/Workbench";
import { EmptyState } from "@/components/ui/EmptyState";

interface BaseIntent {
  id: string;
  payload: string;
  summary?: string | null;
  createdAt: string;
  warming?: boolean;
  networks?: { id: string; title: string }[];
  waitingOpportunityCount?: number;
  status?: string;
}

interface IntentListProps<T extends BaseIntent> {
  intents: T[];
  isLoading?: boolean;
  /** Set when the list fetch failed; renders the error state instead of empty copy. */
  loadError?: boolean;
  onRetry?: () => void;
  emptyMessage?: string;
  onArchiveIntent?: (intent: T) => void;
  onRemoveIntent?: (intent: T) => void;
  onIntentClick?: (intent: T) => void;
  newIntentIds?: Set<string>;
  selectedIntentIds?: Set<string>;
  removingIntentIds?: Set<string>;
  className?: string;
  shelf?: boolean;
  style?: CSSProperties;
}

export default function IntentList<T extends BaseIntent>({
  intents,
  isLoading = false,
  loadError = false,
  onRetry,
  emptyMessage = "nothing here yet.",
  onIntentClick,
  className = "",
  shelf = false,
  style,
}: IntentListProps<T>) {
  const sortedIntents = useMemo(() => {
    const rank = (status?: string) => {
      const value = (status || "active").toLowerCase();
      if (value === "active") return 0;
      if (value === "idle") return 1;
      if (value === "paused") return 2;
      return 3;
    };
    return [...intents].sort((a, b) => {
      const diff = rank(a.status) - rank(b.status);
      if (diff !== 0) return diff;
      return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
    });
  }, [intents]);

  if (isLoading && sortedIntents.length === 0) {
    return <EmptyState tone="loading" align={shelf ? "start" : "center"} className={className} />;
  }

  if (loadError && sortedIntents.length === 0) {
    return (
      <EmptyState
        tone="error"
        align={shelf ? "start" : "center"}
        className={className}
        message="couldn't load your intents."
        action={onRetry ? { label: "try again", onClick: onRetry } : undefined}
      />
    );
  }

  if (sortedIntents.length === 0) {
    // Shelf mode: the "new intent" button sits directly under this line and is the CTA.
    return (
      <EmptyState
        align={shelf ? "start" : "center"}
        className={className}
        message={shelf ? "no intents yet. start one and your agent goes looking." : emptyMessage}
      />
    );
  }

  return (
    <div
      className={cn(shelf && "mac-scroll", className)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 0,
        overflowY: shelf ? "auto" : undefined,
        minHeight: 0,
        ...style,
      }}
    >
      {sortedIntents.map((intent) => {
        const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
        const status = (intent.status || "active").toLowerCase();
        const label = intentStatus(intent);
        const running = label === "live" || label === "agents in talks";
        const pending = status === "active" ? (intent.waitingOpportunityCount ?? 0) : 0;
        return (
          <button
            key={intent.id}
            type="button"
            className="wb-shelf-row"
            style={{ opacity: status === "paused" ? 0.62 : 1 }}
            onClick={onIntentClick ? () => onIntentClick(intent) : undefined}
          >
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 3, textAlign: "left" }}>
              <span style={{
                fontFamily: "var(--amiga-title)",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--ink)",
                lineHeight: 1.3,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }} title={summary}>
                {intentTitle(summary)}
              </span>
              <span style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--mac-sans)",
                fontSize: 12,
                color: "var(--ink-2)",
              }}>
                <span aria-hidden className={running ? "wb-live" : undefined} style={{ width: 6, height: 6, borderRadius: "50%", display: "inline-block", flex: "0 0 auto", background: running ? undefined : "#ccc" }} />
                {label}
              </span>
            </span>
            <QCount n={pending} />
          </button>
        );
      })}
    </div>
  );
}
