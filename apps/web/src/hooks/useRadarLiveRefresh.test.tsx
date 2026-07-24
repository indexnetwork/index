import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { RADAR_REFRESH_INTERVAL_MS, useRadarLiveRefresh } from "./useRadarLiveRefresh";

afterEach(() => vi.useRealTimers());

describe("useRadarLiveRefresh", () => {
  it("refreshes on a matching scoped SSE revision and on the lifecycle timer", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { rerender } = renderHook(
      ({ revision }) => useRadarLiveRefresh({
        intentId: "intent-a",
        activityRevision: revision,
        onRefresh: refresh,
      }),
      { initialProps: { revision: "conversation:one" } },
    );
    rerender({ revision: "conversation:two" });
    expect(refresh).toHaveBeenCalledTimes(1);
    act(() => vi.advanceTimersByTime(RADAR_REFRESH_INTERVAL_MS));
    expect(refresh).toHaveBeenCalledTimes(2);
  });

  it("resets stale event state and cleans the previous timer on intent navigation", () => {
    vi.useFakeTimers();
    const refresh = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ intentId, revision }) => useRadarLiveRefresh({
        intentId,
        activityRevision: revision,
        onRefresh: refresh,
      }),
      { initialProps: { intentId: "intent-a", revision: "a:one" } },
    );
    rerender({ intentId: "intent-b", revision: "b:one" });
    expect(refresh).not.toHaveBeenCalled();
    unmount();
    act(() => vi.advanceTimersByTime(RADAR_REFRESH_INTERVAL_MS * 2));
    expect(refresh).not.toHaveBeenCalled();
  });
});
