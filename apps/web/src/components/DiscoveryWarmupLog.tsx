/**
 * The radar's warmup card: a sweep and a terse activity log.
 *
 * It replaces a static checklist whose four rows were frozen for the whole run.
 * The point of the change is that the owner watches the agent work, so every
 * line here has to be something that actually happened at a time we can name —
 * see `@/lib/discovery-warmup-log` for the derivation and what it refuses to
 * invent.
 *
 * The sweep is decorative: every state reads correctly with the animation off
 * (`prefers-reduced-motion` stops it in `globals.css`).
 */
import { useMemo } from "react";

import type { DiscoveryProgress, DiscoveryProgressStatus } from "@/services/intents";
import { ACTIVE_DISCOVERY_STATUSES, DISCOVERY_STATUS_CHIP, WARMUP_PAUSED_HEADLINE, buildWarmupLog, formatLogClock, warmupHeadline } from "@/lib/discovery-warmup-log";
import { cn } from "@/lib/utils";

const STATUS_TONE: Record<DiscoveryProgressStatus, string> = {
  queued: "border-gray-200 bg-gray-100 text-gray-600",
  running: "border-gray-200 bg-gray-100 text-gray-600",
  retrying: "border-amber-200 bg-amber-50 text-amber-700",
  completed: "border-emerald-200 bg-emerald-50 text-emerald-700",
  failed: "border-amber-200 bg-amber-50 text-amber-700",
  blocked: "border-amber-200 bg-amber-50 text-amber-700",
  unknown: "border-gray-200 bg-gray-100 text-gray-500",
};

export default function DiscoveryWarmupLog({
  progress,
  communities,
}: {
  progress?: DiscoveryProgress;
  communities?: Array<{ id: string; title: string }>;
}) {
  const status = progress?.status ?? "unknown";
  const active = ACTIVE_DISCOVERY_STATUSES.has(status);
  // A loaded empty community list means no run can start, whatever the stored
  // row last said. An omitted list is still loading, not evidence of a block.
  const communityCount = communities?.length ?? 0;
  const paused = status === "blocked" || communities?.length === 0;
  const chipStatus: DiscoveryProgressStatus = paused ? "blocked" : status;
  const log = useMemo(() => buildWarmupLog({ progress }), [progress]);
  const headline = useMemo(
    () => (paused ? { ...WARMUP_PAUSED_HEADLINE } : warmupHeadline(progress, communityCount)),
    [paused, communityCount, progress],
  );

  return (
    <section
      className="rounded-lg border border-dashed border-gray-300 bg-gray-50/60 p-4"
      aria-label="Signal warmup activity"
      data-testid="discovery-warmup"
    >
      <div className="flex items-start gap-3">
        <span
          className={cn("radar-sweep", !active && "radar-sweep-idle")}
          data-testid="discovery-warmup-sweep"
          aria-hidden="true"
        />
        <div className="min-w-0 flex-1">
          <h4 className="text-sm font-semibold text-gray-900">{headline.title}</h4>
          <p className="mt-0.5 font-ibm-plex-mono text-[11px] tabular-nums text-gray-600">{headline.summary}</p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded-full border px-2 py-0.5 font-ibm-plex-mono text-[10px] font-semibold uppercase tracking-wide",
            STATUS_TONE[chipStatus],
          )}
          data-testid="discovery-warmup-status"
        >
          {DISCOVERY_STATUS_CHIP[chipStatus]}
        </span>
      </div>

      {log.length > 0 && (
        <ol
          className="mt-3 space-y-1.5 font-ibm-plex-mono text-[11px] tabular-nums text-gray-600"
          data-testid="discovery-warmup-log"
        >
          {log.map((entry) => (
            <li key={entry.id} className="flex items-start gap-2">
              <span className="shrink-0 text-gray-400">{formatLogClock(entry.at)}</span>
              <span
                aria-hidden="true"
                className={cn(
                  "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                  "bg-gray-400",
                  entry.current && "warmup-pulse",
                )}
              />
              <span className={cn("min-w-0 flex-1", entry.current && "text-gray-900")}>{entry.text}</span>
            </li>
          ))}
        </ol>
      )}

      {paused ? (
        <p className="mt-3 text-xs text-amber-700">
          Matching can’t begin until this signal is shared with an active community.
        </p>
      ) : active ? (
        <p className="mt-3 text-xs text-gray-500">
          You can leave this page — matching continues in the background.
        </p>
      ) : null}
    </section>
  );
}
