import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import RotatingLine from "./RotatingLine";

describe("RotatingLine", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("shows one line at a time and wraps back to the first", () => {
    render(<RotatingLine lines={["one.", "two."]} />);
    expect(screen.getByText("one.")).toBeTruthy();
    expect(screen.queryByText("two.")).toBeNull();

    act(() => { vi.advanceTimersByTime(4500 + 300); });
    expect(screen.getByText("two.")).toBeTruthy();
    expect(screen.queryByText("one.")).toBeNull();

    act(() => { vi.advanceTimersByTime(4500 + 300); });
    expect(screen.getByText("one.")).toBeTruthy();
  });
});
