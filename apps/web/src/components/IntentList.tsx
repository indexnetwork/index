import { useMemo, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import { signalStatus, signalTitle } from "@/lib/signal-display";
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
        message="couldn't load your signals."
        action={onRetry ? { label: "try again", onClick: onRetry } : undefined}
      />
    );
  }

  if (sortedIntents.length === 0) {
    // Shelf mode: the "new signal" button sits directly under this line and is the CTA.
    return (
      <EmptyState
        align={shelf ? "start" : "center"}
        className={className}
        message={shelf ? "no signals yet. start one and your agent goes looking." : emptyMessage}
      />
    );
  }

  return (
    <div
      className={cn(shelf && "mac-scroll", className)}
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        overflowY: shelf ? "auto" : undefined,
        minHeight: 0,
        ...style,
      }}
    >
      {sortedIntents.map((intent) => {
        const summary = (intent.summary && intent.summary.trim().length > 0 ? intent.summary : intent.payload).trim();
        const status = (intent.status || "active").toLowerCase();
        const label = signalStatus(intent);
        const running = label === "live" || label === "negotiating";
        const pending = status === "active" ? (intent.waitingOpportunityCount ?? 0) : 0;
        return (
          <button
            key={intent.id}
            type="button"
            className="wb-shelf-row"
            style={{ opacity: status === "paused" ? 0.62 : 1 }}
            onClick={onIntentClick ? () => onIntentClick(intent) : undefined}
          >
            <span style={{ flex: 1, minWidth: 0, display: "grid", gap: 4, textAlign: "left" }}>
              <span style={{
                fontFamily: "var(--amiga-title)",
                fontSize: 15.5,
                fontWeight: 500,
                letterSpacing: -0.1,
                lineHeight: 1.2,
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }} title={summary}>
                {signalTitle(summary)}
              </span>
              <span style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                fontFamily: "var(--mac-mono)",
                fontSize: 10,
                color: "var(--ink-2)",
                letterSpacing: 1,
              }}>
                {running && <span className="wb-live" style={{ width: 6, height: 6 }} />}
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
