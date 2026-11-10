import { describe, expect, it } from "vitest";

import { formatRadarAge, radarActivityAt, radarActivityMs, radarStatusLabel } from "./radar-buckets";

const NOW = Date.parse("2026-11-04T12:00:00Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MIN = 60 * 1000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe("formatRadarAge", () => {
  it("steps from minutes to hours, days and weeks", () => {
    expect(formatRadarAge(ago(20 * 1000), NOW)).toBe("now");
    expect(formatRadarAge(ago(12 * MIN), NOW)).toBe("12m");
    expect(formatRadarAge(ago(3 * HOUR), NOW)).toBe("3h");
    expect(formatRadarAge(ago(2 * DAY), NOW)).toBe("2d");
    expect(formatRadarAge(ago(15 * DAY), NOW)).toBe("2w");
  });

  it("shows a date from four weeks on, with the year only when it differs", () => {
    expect(formatRadarAge("2026-10-01T12:00:00Z", NOW)).toBe("Oct 1");
    expect(formatRadarAge("2025-10-01T12:00:00Z", NOW)).toBe("Oct 1, 2025");
  });

  it("returns null for a missing or bad time and clamps future times to now", () => {
    expect(formatRadarAge(undefined, NOW)).toBeNull();
    expect(formatRadarAge("not a date", NOW)).toBeNull();
    expect(formatRadarAge(new Date(NOW + HOUR).toISOString(), NOW)).toBe("now");
  });
});

describe("radarActivityAt", () => {
  it("prefers the last change and falls back to creation", () => {
    expect(radarActivityAt({ createdAt: "a", updatedAt: "b" })).toBe("b");
    expect(radarActivityAt({ createdAt: "a" })).toBe("a");
    expect(radarActivityMs({})).toBe(0);
  });
});

describe("radarStatusLabel", () => {
  it("names each stage, and splits closed into not a fit and missed", () => {
    expect(radarStatusLabel("awaiting you", "pending")).toBe("awaiting you");
    expect(radarStatusLabel("negotiating", "negotiating")).toBe("in progress");
    expect(radarStatusLabel("accepted", "pending")).toBe("accepted");
    expect(radarStatusLabel("accepted", "accepted")).toBe("accepted");
    expect(radarStatusLabel("closed", "rejected")).toBe("not a fit");
    expect(radarStatusLabel("closed", "expired")).toBe("missed");
  });
});
