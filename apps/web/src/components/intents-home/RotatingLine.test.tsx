import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RotatingLine from "./RotatingLine";

const LINES = ["one.", "two.", "three."];

describe("RotatingLine", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(0);
  });
  afterEach(() => vi.useRealTimers());

  it("shows one line at a time and wraps back to the first", () => {
    render(<RotatingLine lines={LINES} />);
    expect(screen.getByText("one.")).toBeTruthy();
    expect(screen.queryByText("two.")).toBeNull();

    act(() => { vi.advanceTimersByTime(4500); });
    expect(screen.getByText("two.")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4500); });
    expect(screen.getByText("three.")).toBeTruthy();

    act(() => { vi.advanceTimersByTime(4500); });
    expect(screen.getByText("one.")).toBeTruthy();
  });

  it("keeps rotating when it is mounted again", () => {
    const first = render(<RotatingLine lines={LINES} />);
    act(() => { vi.advanceTimersByTime(4500); });
    first.unmount();

    // A fresh mount picks up where the clock is, not back at the first line.
    render(<RotatingLine lines={LINES} />);
    expect(screen.getByText("two.")).toBeTruthy();
  });
});
