import { apiClient } from "@/lib/api";
import { parseSocial } from "@/lib/socials";

/** What POST /enrichment/enrich made of the public record. `profile` is null when nothing useful turned up. */
export interface PublicProfileLookup {
  enriched: boolean;
  profile: {
    name: string | null;
    intro: string | null;
    location: string | null;
    socials: Array<{ label: string; value: string }>;
    avatarUrl: string | null;
  } | null;
}

interface OnboardingUser {
  onboarding?: { profileConfirmedAt?: string | null; completedAt?: string | null } | null;
}

/**
 * First run, same steps and gates as the Mac app: confirm the name, look the
 * person up, review the profile (which confirms it), then the first signal
 * completes onboarding.
 */
export const onboardingService = {
  lookUp: (name: string) => apiClient.post<PublicProfileLookup>("/enrichment/enrich", { name }),
  confirmProfile: () => apiClient.post<{ profileConfirmedAt: string }>("/auth/onboarding/confirm-profile", {}),
  complete: (intentId?: string) => apiClient.post<{ completedAt: string }>("/auth/onboarding/complete", intentId ? { intentId } : {}),
};

/** The durable gate the Mac app uses: no confirmed profile means first run. */
export function needsOnboarding(user: unknown): boolean {
  if (!user) return false;
  return !(user as OnboardingUser).onboarding?.profileConfirmedAt;
}

/** Confirmed but not yet finished: the next signal created completes onboarding. */
export function awaitsFirstSignal(user: unknown): boolean {
  const onboarding = (user as OnboardingUser | null)?.onboarding;
  return !!onboarding?.profileConfirmedAt && !onboarding.completedAt;
}

const PLATFORM_LABELS = { twitter: "x", linkedin: "linkedin", github: "github", telegram: "telegram" } as const;

/**
 * The review form's starting point: the account record, with every blank the
 * lookup could fill filled in, and the name confirmed on the way in winning
 * over both. Platform socials become bare handles, as the settings fields hold them.
 */
export function assembleFirstRunProfile(
  account: { name?: string | null; intro?: string | null; location?: string | null; socials?: Array<{ label: string; value: string }> | null },
  lookup: PublicProfileLookup | null,
  confirmedName: string,
) {
  const found = lookup?.profile;
  const socials = (account.socials ?? []).map((s) => ({ label: s.label, value: s.value }));
  const has = (label: string) => socials.some((s) => s.label === label && s.value.trim());

  for (const social of found?.socials ?? []) {
    const label = social.label.toLowerCase();
    if (label in PLATFORM_LABELS) {
      if (has(label)) continue;
      const resolved = parseSocial({ label, value: social.value });
      const handle = resolved.platform === PLATFORM_LABELS[label as keyof typeof PLATFORM_LABELS] ? resolved.handle : social.value;
      if (handle) socials.push({ label, value: handle });
    }
  }
  const storedSites = socials.filter((s) => !(s.label in PLATFORM_LABELS));
  if (!storedSites.length) {
    for (const social of (found?.socials ?? []).filter((s) => !(s.label.toLowerCase() in PLATFORM_LABELS)).slice(0, 3)) {
      socials.push({ label: "custom", value: social.value });
    }
  }

  return {
    name: confirmedName || account.name || "",
    intro: account.intro || found?.intro || "",
    location: account.location || found?.location || "",
    socials,
  };
}

/** At first run an empty lookup is not a failure, but the review has to say so. */
export function lookupFoundNothing(lookup: PublicProfileLookup | null): boolean {
  const p = lookup?.profile;
  if (!p) return true;
  return !p.intro?.trim() && !p.location?.trim() && !p.socials.some((s) => s.value.trim());
}
