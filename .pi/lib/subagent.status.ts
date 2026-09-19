import { randomUUID } from "node:crypto";

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

type ActiveSubagent = { agent: string; startedAt: number };

export type SubagentSummary =
  | { kind: "idle" }
  | { kind: "active"; entries: ActiveSubagent[]; omitted: number }
  | { kind: "unavailable" };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isCount(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function readSummary(fleet: unknown): SubagentSummary {
  if (!isRecord(fleet) || fleet.version !== 1 || !isCount(fleet.totalActive) || !isCount(fleet.omitted) || !Array.isArray(fleet.entries)) {
    return { kind: "unavailable" };
  }

  const entries: ActiveSubagent[] = [];
  for (const entry of fleet.entries) {
    if (!isRecord(entry) || typeof entry.agent !== "string" || !isCount(entry.startedAt)) {
      return { kind: "unavailable" };
    }
    entries.push({ agent: entry.agent, startedAt: entry.startedAt });
  }

  if (fleet.totalActive === 0) return { kind: "idle" };
  return { kind: "active", entries, omitted: fleet.omitted };
}

/**
 * Observe current-session work through pi-subagents' public event-bus RPC.
 * A capability probe keeps the row optional when pi-subagents is not installed.
 *
 * @param pi - The owning extension API; only read-only ping/status requests are sent.
 * @param onChange - Request a footer redraw when a visible summary changes.
 * @returns The latest summary and an idempotent disposer for listeners and timers.
 */
export function watchSubagentSummary(pi: ExtensionAPI, onChange: () => void) {
  let summary: SubagentSummary = { kind: "idle" };
  let disposed = false;
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let cancelRequest: (() => void) | undefined;

  function publish(next: SubagentSummary) {
    const wasVisible = summary.kind !== "idle";
    summary = next;
    if (wasVisible || next.kind !== "idle") onChange();
  }

  function scheduleRefresh() {
    refreshTimer = setTimeout(() => request("status"), 1000);
    refreshTimer.unref();
  }

  function request(method: "ping" | "status") {
    if (disposed || cancelRequest) return;
    clearTimeout(refreshTimer);
    const requestId = randomUUID();
    const unsubscribe = pi.events.on(`subagents:rpc:v1:reply:${requestId}`, (raw) => {
      if (!isRecord(raw) || raw.requestId !== requestId) return;
      cancelRequest?.();
      if (disposed) return;

      const data = raw.version === 1 && raw.success === true && isRecord(raw.data) ? raw.data : undefined;
      if (method === "ping") {
        const capabilities = data?.capabilities;
        if (isRecord(capabilities) && isRecord(capabilities.fleetStatus) && capabilities.fleetStatus.version === 1) {
          request("status");
        }
        return;
      }

      publish(readSummary(data?.fleet));
      scheduleRefresh();
    });

    const deadline = setTimeout(() => {
      cancelRequest?.();
      if (method === "status") {
        publish({ kind: "unavailable" });
        scheduleRefresh();
      }
    }, 3000);
    deadline.unref();
    cancelRequest = () => {
      unsubscribe();
      clearTimeout(deadline);
      cancelRequest = undefined;
    };

    pi.events.emit("subagents:rpc:v1:request", {
      version: 1,
      requestId,
      method,
      source: { extension: "index-status-bar" },
    });
  }

  const unsubscribeReady = pi.events.on("subagents:rpc:v1:ready", () => request("ping"));
  request("ping");

  return {
    getSummary: () => summary,
    dispose() {
      disposed = true;
      cancelRequest?.();
      clearTimeout(refreshTimer);
      unsubscribeReady();
    },
  };
}
