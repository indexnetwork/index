import { describe, expect, it } from "vitest";

import { assembleFirstRunProfile, awaitsFirstSignal, lookupFoundNothing, needsOnboarding, type PublicProfileLookup } from "./onboarding";

const lookup: PublicProfileLookup = {
  enriched: true,
  profile: {
    name: "Ada L.",
    intro: "Works on the analytical engine.",
    location: "London",
    socials: [
      { label: "twitter", value: "https://x.com/ada" },
      { label: "github", value: "https://github.com/ada" },
      { label: "custom", value: "https://ada.dev" },
    ],
    avatarUrl: null,
  },
};

describe("onboarding gates", () => {
  it("sends a user without a confirmed profile through first run", () => {
    expect(needsOnboarding({ onboarding: {} })).toBe(true);
    expect(needsOnboarding({})).toBe(true);
    expect(needsOnboarding({ onboarding: { profileConfirmedAt: "2026-10-05T00:00:00Z" } })).toBe(false);
    expect(needsOnboarding(null)).toBe(false);
  });

  it("completes on the first signal only between confirming and finishing", () => {
    expect(awaitsFirstSignal({ onboarding: { profileConfirmedAt: "2026-10-05T00:00:00Z" } })).toBe(true);
    expect(awaitsFirstSignal({ onboarding: { profileConfirmedAt: "2026-10-05T00:00:00Z", completedAt: "2026-10-05T00:01:00Z" } })).toBe(false);
    expect(awaitsFirstSignal({ onboarding: {} })).toBe(false);
  });
});

describe("assembleFirstRunProfile", () => {
  it("fills blanks from the lookup and keeps the confirmed name", () => {
    const form = assembleFirstRunProfile({ name: "", intro: null, location: null, socials: [] }, lookup, "Ada Lovelace");
    expect(form.name).toBe("Ada Lovelace");
    expect(form.intro).toBe("Works on the analytical engine.");
    expect(form.location).toBe("London");
    expect(form.socials).toEqual([
      { label: "twitter", value: "ada" },
      { label: "github", value: "ada" },
      { label: "custom", value: "https://ada.dev" },
    ]);
  });

  it("never overwrites what the account already has", () => {
    const form = assembleFirstRunProfile(
      { name: "Ada", intro: "Mine.", location: "Paris", socials: [{ label: "twitter", value: "ada_real" }, { label: "custom", value: "https://mine.dev" }] },
      lookup,
      "",
    );
    expect(form).toMatchObject({ name: "Ada", intro: "Mine.", location: "Paris" });
    expect(form.socials).toEqual([
      { label: "twitter", value: "ada_real" },
      { label: "custom", value: "https://mine.dev" },
      { label: "github", value: "ada" },
    ]);
  });

  it("reports an empty lookup so the review can say so", () => {
    expect(lookupFoundNothing(null)).toBe(true);
    expect(lookupFoundNothing({ enriched: false, profile: null })).toBe(true);
    expect(lookupFoundNothing(lookup)).toBe(false);
  });
});
